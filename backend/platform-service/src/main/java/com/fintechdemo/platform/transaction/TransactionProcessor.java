package com.fintechdemo.platform.transaction;

import com.fintechdemo.platform.audit.AuditService;
import com.fintechdemo.platform.clearing.ClearingClient;
import com.fintechdemo.platform.clearing.ClearingClient.ClearingRequest;
import com.fintechdemo.platform.clearing.ClearingClient.ClearingResult;
import com.fintechdemo.platform.common.ApiException;
import com.fintechdemo.platform.ops.PlatformMetrics;
import com.fintechdemo.platform.security.AuthenticatedUser;
import com.fintechdemo.platform.transaction.SupportRepositories.AttemptRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Executes a VALIDATED transaction. Transaction boundaries are explicit (TransactionTemplate) because the external
 * clearing call must happen OUTSIDE any database transaction - holding row locks and a pooled connection across a
 * network call is how pools get exhausted:
 * <pre>
 *  Tx1: VALIDATED -> PROCESSING and (deposit/transfer) apply ledger + COMPLETED; (withdrawal) reserve funds
 *  ----  external call (withdrawal only), no DB transaction open  ----
 *  Tx2: finish: COMPLETED | refund + FAILED | RECONCILIATION_REQUIRED
 * </pre>
 * The method is idempotent: the outbox delivers at-least-once, and a second delivery sees a status other than
 * VALIDATED and returns without doing anything.
 */
@Service
public class TransactionProcessor {

    private static final Logger log = LoggerFactory.getLogger(TransactionProcessor.class);
    private static final AuthenticatedUser SYSTEM = AuthenticatedUser.system("processor");

    private record Started(boolean needsClearing, String reference, BigDecimal amount, String currency) {
        static final Started NOTHING_TO_DO = new Started(false, null, null, null);
    }

    private final TransactionRepository transactions;
    private final LedgerService ledger;
    private final ClearingClient clearing;
    private final AttemptRepository attempts;
    private final ReconciliationService reconciliation;
    private final AuditService audit;
    private final PlatformMetrics metrics;
    private final TransactionTemplate tt;
    private final Clock clock;

    public TransactionProcessor(TransactionRepository transactions, LedgerService ledger, ClearingClient clearing,
                                AttemptRepository attempts, ReconciliationService reconciliation, AuditService audit,
                                PlatformMetrics metrics, TransactionTemplate transactionTemplate, Clock clock) {
        this.transactions = transactions;
        this.ledger = ledger;
        this.clearing = clearing;
        this.attempts = attempts;
        this.reconciliation = reconciliation;
        this.audit = audit;
        this.metrics = metrics;
        this.tt = transactionTemplate;
        this.clock = clock;
    }

    public void process(UUID transactionId) {
        Started started;
        try {
            started = tt.execute(s -> begin(transactionId));
        } catch (ApiException businessFailure) {
            // Tx1 rolled back completely (nothing half-applied); record the failure in a fresh transaction.
            // Technical failures (lock timeout, DB down, optimistic conflict) are NOT caught: they propagate so the
            // outbox retries with backoff instead of wrongly failing a customer's transaction.
            failBeforeApply(transactionId, businessFailure);
            return;
        }
        if (started == null || !started.needsClearing()) {
            return;
        }
        ClearingResult result = clearing.authorize(new ClearingRequest(started.reference(), started.amount(), started.currency()));
        tt.executeWithoutResult(s -> finishWithdrawal(transactionId, result));
    }

    private Started begin(UUID id) {
        FinancialTransaction tx = transactions.findById(id).orElse(null);
        if (tx == null || tx.getStatus() != TransactionStatus.VALIDATED) {
            log.info("Skipping transaction {}: nothing to process (status={})", id, tx == null ? "missing" : tx.getStatus());
            return Started.NOTHING_TO_DO;
        }
        Instant now = Instant.now(clock);
        tx.transitionTo(TransactionStatus.PROCESSING, now);
        audit.record(SYSTEM, "TRANSACTION_PROCESSING", "TRANSACTION", id, "type=" + tx.getType());
        switch (tx.getType()) {
            case DEPOSIT -> {
                ledger.applyDeposit(tx);
                complete(tx, "LEDGER", "applied", now);
                return Started.NOTHING_TO_DO;
            }
            case TRANSFER -> {
                ledger.applyTransfer(tx);
                complete(tx, "LEDGER", "applied", now);
                return Started.NOTHING_TO_DO;
            }
            default -> {
                ledger.reserveWithdrawal(tx);
                transactions.save(tx);
                recordAttempt(tx, "RESERVE_FUNDS", "RESERVED", "funds reserved before external authorization", now);
                return new Started(true, tx.getReference(), tx.getAmount(), tx.getCurrency());
            }
        }
    }

    private void complete(FinancialTransaction tx, String stage, String detail, Instant startedAt) {
        Instant now = Instant.now(clock);
        tx.transitionTo(TransactionStatus.COMPLETED, now);
        transactions.save(tx);
        recordAttempt(tx, stage, "SUCCESS", detail, startedAt);
        audit.record(SYSTEM, "TRANSACTION_COMPLETED", "TRANSACTION", tx.getId(), null);
        metrics.finished(tx.getType(), TransactionStatus.COMPLETED, Duration.between(tx.getCreatedAt(), now));
    }

    private void failBeforeApply(UUID id, ApiException failure) {
        tt.executeWithoutResult(s -> {
            FinancialTransaction tx = transactions.findById(id).orElse(null);
            if (tx == null || tx.getStatus() != TransactionStatus.VALIDATED) {
                return;
            }
            Instant now = Instant.now(clock);
            tx.transitionTo(TransactionStatus.PROCESSING, now);
            tx.recordFailure(failure.getCode(), failure.getMessage());
            tx.transitionTo(TransactionStatus.FAILED, now);
            transactions.save(tx);
            recordAttempt(tx, "LEDGER", "FAILED", failure.getCode() + ": " + failure.getMessage(), now);
            audit.record(SYSTEM, "TRANSACTION_FAILED", "TRANSACTION", id, "code=" + failure.getCode());
            metrics.finished(tx.getType(), TransactionStatus.FAILED, Duration.between(tx.getCreatedAt(), now));
        });
    }

    private void finishWithdrawal(UUID id, ClearingResult result) {
        FinancialTransaction tx = transactions.findById(id).orElseThrow();
        if (tx.getStatus() != TransactionStatus.PROCESSING) {
            return; // already moved on (e.g. stuck-transaction recovery) - never overwrite a decided outcome
        }
        Instant now = Instant.now(clock);
        switch (result) {
            case ClearingResult.Authorized a -> {
                tx.clearFailure();
                complete(tx, "CLEARING", "authorization " + a.authorizationId(), now);
            }
            case ClearingResult.Declined d -> refundAndFail(tx, "CLEARING_DECLINED", d.reasonCode(), now);
            case ClearingResult.NotSent n -> refundAndFail(tx, "CLEARING_UNAVAILABLE", n.detail(), now);
            case ClearingResult.Unknown u -> uncertain(tx, u.detail(), now);
            case ClearingResult.NotFound n -> uncertain(tx, "unexpected NotFound from authorize", now);
        }
    }

    private void refundAndFail(FinancialTransaction tx, String code, String detail, Instant startedAt) {
        Instant now = Instant.now(clock);
        ledger.reverseWithdrawal(tx);
        tx.recordFailure(code, detail);
        tx.transitionTo(TransactionStatus.FAILED, now);
        transactions.save(tx);
        recordAttempt(tx, "CLEARING", "FAILED", code + ": " + detail, startedAt);
        audit.record(SYSTEM, "TRANSACTION_FAILED", "TRANSACTION", tx.getId(), "code=" + code + ", funds returned");
        metrics.finished(tx.getType(), TransactionStatus.FAILED, Duration.between(tx.getCreatedAt(), now));
    }

    private void uncertain(FinancialTransaction tx, String detail, Instant startedAt) {
        Instant now = Instant.now(clock);
        tx.recordFailure("CLEARING_OUTCOME_UNKNOWN", detail);
        tx.transitionTo(TransactionStatus.RECONCILIATION_REQUIRED, now);
        transactions.save(tx);
        reconciliation.open(tx, "CLEARING_OUTCOME_UNKNOWN", detail);
        recordAttempt(tx, "CLEARING", "UNKNOWN", detail, startedAt);
        audit.record(SYSTEM, "TRANSACTION_RECONCILIATION_REQUIRED", "TRANSACTION", tx.getId(),
                "external outcome unknown; funds remain reserved");
    }

    private void recordAttempt(FinancialTransaction tx, String stage, String outcome, String detail, Instant startedAt) {
        int next = attempts.countByTransactionId(tx.getId()) + 1;
        attempts.save(new TransactionAttempt(tx.getId(), next, stage, outcome, detail, startedAt, Instant.now(clock)));
    }
}
