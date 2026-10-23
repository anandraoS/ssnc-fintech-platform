package com.fintechdemo.platform.transaction;

import com.fintechdemo.platform.audit.AuditService;
import com.fintechdemo.platform.clearing.ClearingClient;
import com.fintechdemo.platform.clearing.ClearingClient.ClearingResult;
import com.fintechdemo.platform.common.ApiException;
import com.fintechdemo.platform.common.PageResponse;
import com.fintechdemo.platform.ops.PlatformMetrics;
import com.fintechdemo.platform.security.AccessPolicy;
import com.fintechdemo.platform.security.AuthenticatedUser;
import com.fintechdemo.platform.transaction.ReconciliationRecord.Resolution;
import com.fintechdemo.platform.transaction.SupportRepositories.ReconciliationRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Resolves transactions whose external outcome is uncertain. Automatic path: ask the clearing network what happened
 * (a lookup is a read, so it is safe to repeat). Manual path: an operator, subject to maker-checker, decides.
 * Funds were reserved BEFORE the external call, so an unresolved record never exposes the customer to loss.
 */
@Service
public class ReconciliationService {

    private static final Logger log = LoggerFactory.getLogger(ReconciliationService.class);
    private static final AuthenticatedUser RECONCILER = AuthenticatedUser.system("reconciler");

    private final ReconciliationRepository records;
    private final TransactionRepository transactions;
    private final LedgerService ledger;
    private final ClearingClient clearing;
    private final AuditService audit;
    private final AccessPolicy policy;
    private final PlatformMetrics metrics;
    private final ProcessingProperties props;
    private final TransactionTemplate tt;
    private final TransactionTemplate readTt;
    private final Clock clock;

    public ReconciliationService(ReconciliationRepository records, TransactionRepository transactions, LedgerService ledger,
                                 ClearingClient clearing, AuditService audit, AccessPolicy policy, PlatformMetrics metrics,
                                 ProcessingProperties props, TransactionTemplate transactionTemplate,
                                 TransactionTemplate readOnlyTransactionTemplate, Clock clock) {
        this.records = records;
        this.transactions = transactions;
        this.ledger = ledger;
        this.clearing = clearing;
        this.audit = audit;
        this.policy = policy;
        this.metrics = metrics;
        this.props = props;
        this.tt = transactionTemplate;
        this.readTt = readOnlyTransactionTemplate;
        this.clock = clock;
    }

    /** Opens a record for the transaction unless one is already open. Joins the caller's transaction. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void open(FinancialTransaction tx, String reasonCode, String detail) {
        if (records.findFirstByTransactionIdAndStatus(tx.getId(), ReconciliationRecord.Status.OPEN).isPresent()) {
            return;
        }
        records.save(new ReconciliationRecord(tx.getId(), reasonCode, detail, Instant.now(clock)));
        audit.record(AuthenticatedUser.system("processor"), "RECONCILIATION_OPENED", "TRANSACTION", tx.getId(),
                "reason=" + reasonCode);
    }

    @Transactional(readOnly = true)
    public PageResponse<ReconciliationView> list(ReconciliationRecord.Status status, Pageable pageable) {
        Pageable page = PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), Sort.by("openedAt").ascending());
        return PageResponse.of(records.findByStatus(status == null ? ReconciliationRecord.Status.OPEN : status, page),
                ReconciliationView::of);
    }

    /** Manual resolution by an operator. */
    @Transactional
    public ReconciliationView resolve(UUID recordId, Resolution resolution, String note, AuthenticatedUser actor) {
        ReconciliationRecord record = records.findById(recordId)
                .orElseThrow(() -> ApiException.notFound("RECONCILIATION_NOT_FOUND", "Reconciliation record not found"));
        FinancialTransaction tx = transactions.findById(record.getTransactionId())
                .orElseThrow(() -> ApiException.notFound("TRANSACTION_NOT_FOUND", "Transaction not found"));
        if (!policy.canReview(actor, tx.getSubmittedBy())) {
            throw ApiException.forbidden("MAKER_CHECKER_VIOLATION", "You cannot resolve a transaction you submitted");
        }
        apply(record, tx, resolution, actor.subject(), note, actor);
        return ReconciliationView.of(record);
    }

    /** Scheduled path. Lookups happen OUTSIDE any database transaction; each resolution is its own short transaction. */
    public int autoReconcile() {
        record Candidate(UUID recordId, String reference, Instant openedAt) {
        }
        List<Candidate> candidates = readTt.execute(s -> records
                .findByStatusOrderByOpenedAtAsc(ReconciliationRecord.Status.OPEN, PageRequest.of(0, 50)).stream()
                .map(r -> new Candidate(r.getId(), transactions.findById(r.getTransactionId()).orElseThrow().getReference(),
                        r.getOpenedAt()))
                .toList());
        int resolved = 0;
        for (Candidate c : candidates == null ? List.<Candidate>of() : candidates) {
            ClearingResult result = clearing.lookup(c.reference());
            Resolution decision = switch (result) {
                case ClearingResult.Authorized a -> Resolution.CONFIRMED_EXECUTED;
                case ClearingResult.Declined d -> Resolution.CONFIRMED_NOT_EXECUTED;
                case ClearingResult.NotFound n -> Duration.between(c.openedAt(), Instant.now(clock)).compareTo(props.reconcileGrace()) >= 0
                        ? Resolution.CONFIRMED_NOT_EXECUTED : null;
                default -> null;
            };
            if (decision == null) {
                continue;
            }
            try {
                tt.executeWithoutResult(s -> {
                    ReconciliationRecord record = records.findById(c.recordId()).orElseThrow();
                    if (record.getStatus() != ReconciliationRecord.Status.OPEN) {
                        return;
                    }
                    FinancialTransaction tx = transactions.findById(record.getTransactionId()).orElseThrow();
                    apply(record, tx, decision, RECONCILER.subject(), "automatic: clearing lookup " + result.getClass().getSimpleName(),
                            RECONCILER);
                });
                resolved++;
            } catch (OptimisticLockingFailureException e) {
                log.info("Reconciliation record {} was resolved concurrently", c.recordId());
            } catch (ApiException e) {
                log.warn("Automatic reconciliation of {} skipped: {}", c.recordId(), e.getCode());
            }
        }
        return resolved;
    }

    private void apply(ReconciliationRecord record, FinancialTransaction tx, Resolution resolution, String by, String note,
                       AuthenticatedUser actor) {
        if (record.getStatus() != ReconciliationRecord.Status.OPEN) {
            throw ApiException.conflict("ALREADY_RESOLVED", "This reconciliation record is already resolved");
        }
        if (tx.getStatus() != TransactionStatus.RECONCILIATION_REQUIRED) {
            throw ApiException.conflict("INVALID_STATE", "Transaction is not awaiting reconciliation");
        }
        Instant now = Instant.now(clock);
        if (resolution == Resolution.CONFIRMED_EXECUTED) {
            tx.clearFailure();
            tx.transitionTo(TransactionStatus.COMPLETED, now);
        } else {
            ledger.reverseWithdrawal(tx);
            tx.recordFailure("RECONCILED_NOT_EXECUTED", "External execution was not confirmed; funds returned");
            tx.transitionTo(TransactionStatus.FAILED, now);
        }
        transactions.save(tx);
        record.resolve(resolution, by, note, now);
        records.save(record);
        audit.record(actor, "RECONCILIATION_RESOLVED", "TRANSACTION", tx.getId(), "resolution=" + resolution);
        metrics.finished(tx.getType(), tx.getStatus(), Duration.between(tx.getCreatedAt(), now));
    }

    public record ReconciliationView(UUID id, UUID transactionId, String status, String reasonCode, String detail,
                                     Instant openedAt, Instant resolvedAt, String resolvedBy, String resolution,
                                     String resolutionNote) {
        static ReconciliationView of(ReconciliationRecord r) {
            return new ReconciliationView(r.getId(), r.getTransactionId(), r.getStatus().name(), r.getReasonCode(),
                    r.getDetail(), r.getOpenedAt(), r.getResolvedAt(), r.getResolvedBy(),
                    r.getResolution() == null ? null : r.getResolution().name(), r.getResolutionNote());
        }
    }
}
