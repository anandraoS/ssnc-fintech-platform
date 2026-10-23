package com.fintechdemo.platform.transaction;

import com.fintechdemo.platform.audit.AuditService;
import com.fintechdemo.platform.ops.PlatformMetrics;
import com.fintechdemo.platform.security.AuthenticatedUser;
import com.fintechdemo.platform.transaction.SupportRepositories.IdempotencyRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Housekeeping: recover stuck PROCESSING transactions and purge expired idempotency records. */
@Service
public class TransactionMaintenance {

    private static final AuthenticatedUser SYSTEM = AuthenticatedUser.system("maintenance");

    private final TransactionRepository transactions;
    private final IdempotencyRepository idempotency;
    private final ReconciliationService reconciliation;
    private final AuditService audit;
    private final PlatformMetrics metrics;
    private final ProcessingProperties processing;
    private final TransactionProperties transactionProps;
    private final TransactionTemplate tt;
    private final Clock clock;

    public TransactionMaintenance(TransactionRepository transactions, IdempotencyRepository idempotency,
                                  ReconciliationService reconciliation, AuditService audit, PlatformMetrics metrics,
                                  ProcessingProperties processing, TransactionProperties transactionProps,
                                  TransactionTemplate transactionTemplate, Clock clock) {
        this.transactions = transactions;
        this.idempotency = idempotency;
        this.reconciliation = reconciliation;
        this.audit = audit;
        this.metrics = metrics;
        this.processing = processing;
        this.transactionProps = transactionProps;
        this.tt = transactionTemplate;
        this.clock = clock;
    }

    /**
     * A transaction that has been PROCESSING for too long (e.g. the app crashed between the funds reservation and the
     * outcome) is moved to RECONCILIATION_REQUIRED; the reserved funds stay held until the outcome is established.
     */
    public int recoverStuckProcessing() {
        Instant cutoff = Instant.now(clock).minus(processing.stuckAfter());
        List<FinancialTransaction> stuck = tt.execute(s -> transactions.findByStatusAndUpdatedAtBefore(
                TransactionStatus.PROCESSING, cutoff, PageRequest.of(0, 50)));
        int recovered = 0;
        for (FinancialTransaction candidate : stuck == null ? List.<FinancialTransaction>of() : stuck) {
            Boolean moved = tt.execute(s -> {
                FinancialTransaction tx = transactions.findById(candidate.getId()).orElse(null);
                if (tx == null || tx.getStatus() != TransactionStatus.PROCESSING) {
                    return false;
                }
                tx.recordFailure("PROCESSING_TIMEOUT", "No outcome recorded within " + processing.stuckAfter());
                tx.transitionTo(TransactionStatus.RECONCILIATION_REQUIRED, Instant.now(clock));
                transactions.save(tx);
                reconciliation.open(tx, "PROCESSING_TIMEOUT", "stuck in PROCESSING");
                audit.record(SYSTEM, "TRANSACTION_RECONCILIATION_REQUIRED", "TRANSACTION", tx.getId(), "reason=PROCESSING_TIMEOUT");
                return true;
            });
            if (Boolean.TRUE.equals(moved)) {
                recovered++;
            }
        }
        return recovered;
    }

    public int purgeExpiredIdempotencyRecords() {
        Instant cutoff = Instant.now(clock).minus(transactionProps.idempotencyRetention());
        Integer deleted = tt.execute(s -> idempotency.deleteOlderThan(cutoff));
        return deleted == null ? 0 : deleted;
    }

    public Duration stuckAfter() {
        return processing.stuckAfter();
    }
}
