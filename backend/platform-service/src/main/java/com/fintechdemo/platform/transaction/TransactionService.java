package com.fintechdemo.platform.transaction;

import com.fintechdemo.platform.account.Account;
import com.fintechdemo.platform.account.AccountClosureGuard;
import com.fintechdemo.platform.account.AccountRepository;
import com.fintechdemo.platform.audit.AuditService;
import com.fintechdemo.platform.common.ApiException;
import com.fintechdemo.platform.common.MoneyPolicy;
import com.fintechdemo.platform.common.PageResponse;
import com.fintechdemo.platform.common.PageableSupport;
import com.fintechdemo.platform.customer.Customer;
import com.fintechdemo.platform.customer.CustomerRepository;
import com.fintechdemo.platform.ops.PlatformMetrics;
import com.fintechdemo.platform.security.AccessPolicy;
import com.fintechdemo.platform.security.AuthenticatedUser;
import com.fintechdemo.platform.transaction.SupportRepositories.AttemptRepository;
import com.fintechdemo.platform.transaction.SupportRepositories.IdempotencyRepository;
import com.fintechdemo.platform.transaction.TransactionDtos.AttemptResponse;
import com.fintechdemo.platform.transaction.TransactionDtos.SubmitResult;
import com.fintechdemo.platform.transaction.TransactionDtos.SubmitTransactionRequest;
import com.fintechdemo.platform.transaction.TransactionDtos.TransactionResponse;
import com.fintechdemo.platform.transaction.TransactionValidator.AccountSnapshot;
import jakarta.persistence.criteria.Predicate;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Transaction submission, review, cancellation and queries.
 * <p>
 * Submission is idempotent: {@code (principal, Idempotency-Key)} is UNIQUE in the database. The winner of a race
 * commits the transaction row and the idempotency row atomically; the loser's whole transaction rolls back on the
 * unique violation and it replays the winner's result. Same key with a different payload is rejected (422).
 */
@Service
public class TransactionService implements AccountClosureGuard {

    static final Set<String> SORTABLE = Set.of("createdAt", "amount", "status", "reference", "completedAt");
    private static final Pattern KEY_FORMAT = Pattern.compile("^[A-Za-z0-9._:-]{8,80}$");

    private final TransactionRepository transactions;
    private final AccountRepository accounts;
    private final CustomerRepository customers;
    private final IdempotencyRepository idempotency;
    private final AttemptRepository attempts;
    private final TransactionValidator validator;
    private final OutboxService outbox;
    private final AuditService audit;
    private final AccessPolicy policy;
    private final PlatformMetrics metrics;
    private final TransactionProperties props;
    private final TransactionTemplate tt;
    private final TransactionTemplate readTt;
    private final Clock clock;

    public TransactionService(TransactionRepository transactions, AccountRepository accounts, CustomerRepository customers,
                              IdempotencyRepository idempotency, AttemptRepository attempts, TransactionValidator validator,
                              OutboxService outbox, AuditService audit, AccessPolicy policy,
                              PlatformMetrics metrics, TransactionProperties props, TransactionTemplate transactionTemplate,
                              TransactionTemplate readOnlyTransactionTemplate, Clock clock) {
        this.transactions = transactions;
        this.accounts = accounts;
        this.customers = customers;
        this.idempotency = idempotency;
        this.attempts = attempts;
        this.validator = validator;
        this.outbox = outbox;
        this.audit = audit;
        this.policy = policy;
        this.metrics = metrics;
        this.props = props;
        this.tt = transactionTemplate;
        this.readTt = readOnlyTransactionTemplate;
        this.clock = clock;
    }

    // ------------------------------------------------------------------ submit

    public SubmitResult submit(SubmitTransactionRequest request, String idempotencyKey, AuthenticatedUser actor) {
        if (idempotencyKey == null || !KEY_FORMAT.matcher(idempotencyKey).matches()) {
            throw ApiException.badRequest("IDEMPOTENCY_KEY_INVALID",
                    "Idempotency-Key must be 8-80 characters of letters, digits, '.', '_', ':' or '-'");
        }
        String hash = fingerprint(request);
        Optional<IdempotencyRecord> existing = readTt.execute(s -> idempotency.find(actor.subject(), idempotencyKey));
        if (existing != null && existing.isPresent()) {
            return replay(existing.get(), hash);
        }
        try {
            return tt.execute(s -> create(request, idempotencyKey, hash, actor));
        } catch (DataIntegrityViolationException lostRace) {
            // Another request with the same key committed first. Only a UNIQUE(principal,key) violation is replayable.
            Optional<IdempotencyRecord> winner = readTt.execute(s -> idempotency.find(actor.subject(), idempotencyKey));
            if (winner != null && winner.isPresent()) {
                return replay(winner.get(), hash);
            }
            throw lostRace;
        }
    }

    private SubmitResult replay(IdempotencyRecord record, String hash) {
        if (!record.getRequestHash().equals(hash)) {
            throw ApiException.unprocessable("IDEMPOTENCY_KEY_REUSED",
                    "This Idempotency-Key was already used with a different request payload");
        }
        FinancialTransaction tx = readTt.execute(s -> transactions.findById(record.getTransactionId()).orElseThrow());
        return new SubmitResult(toResponse(tx), true);
    }

    private SubmitResult create(SubmitTransactionRequest req, String key, String hash, AuthenticatedUser actor) {
        Instant now = Instant.now(clock);
        Account source = req.sourceAccountId() == null ? null : loadForSubmit(req.sourceAccountId(), actor);
        Account target = req.targetAccountId() == null ? null : loadForSubmit(req.targetAccountId(), actor);
        if (!policy.canSubmit(actor, req.type(), source == null ? null : source.getCustomerId(),
                target == null ? null : target.getCustomerId())) {
            audit.recordIndependent(actor, "TRANSACTION_SUBMIT_DENIED", "ACCOUNT",
                    String.valueOf(source != null ? source.getId() : target.getId()), "type=" + req.type());
            throw ApiException.forbidden("TRANSACTION_NOT_PERMITTED", "You are not permitted to submit this transaction");
        }

        BigDecimal amount = MoneyPolicy.toStorage(req.amount());
        FinancialTransaction tx = new FinancialTransaction(UUID.randomUUID(), newReference(), req.type(),
                source == null ? null : source.getId(), target == null ? null : target.getId(), amount, req.currency(),
                req.memo(), actor.subject(), now);
        transactions.saveAndFlush(tx); // INSERT as RECEIVED, then move through the state machine inside this transaction
        idempotency.saveAndFlush(new IdempotencyRecord(actor.subject(), key, hash, tx.getId(), now));
        audit.record(actor, "TRANSACTION_SUBMITTED", "TRANSACTION", tx.getId(),
                "type=" + tx.getType() + ", amount=" + req.amount().toPlainString() + " " + req.currency()
                        + ", ref=" + tx.getReference());

        BigDecimal withdrawn = BigDecimal.ZERO;
        if (source != null && req.type() == TransactionType.WITHDRAWAL) {
            withdrawn = transactions.sumWithdrawnSince(source.getId(), now.minus(Duration.ofHours(24)),
                    LedgerService.LIMIT_COUNTING, tx.getId());
        }
        TransactionValidator.Result result = validator.validate(new TransactionValidator.Context(req.type(), req.amount(),
                req.currency(), snapshot(source), snapshot(target), withdrawn, props.maxAmount(), props.reviewThreshold()));

        switch (result.outcome()) {
            case REJECT -> {
                tx.recordFailure(result.primaryCode(), result.describe());
                tx.transitionTo(TransactionStatus.REJECTED, now);
                audit.record(actor, "TRANSACTION_REJECTED", "TRANSACTION", tx.getId(), result.describe());
            }
            case REVIEW -> {
                tx.transitionTo(TransactionStatus.PENDING_REVIEW, now);
                audit.record(actor, "TRANSACTION_PENDING_REVIEW", "TRANSACTION", tx.getId(), "amount at/above review threshold");
            }
            case ACCEPT -> {
                tx.transitionTo(TransactionStatus.VALIDATED, now);
                outbox.enqueue(OutboxService.TRANSACTION_VALIDATED, tx.getId(), "{\"reference\":\"" + tx.getReference() + "\"}");
                audit.record(actor, "TRANSACTION_VALIDATED", "TRANSACTION", tx.getId(), null);
            }
        }
        transactions.saveAndFlush(tx);
        metrics.submitted(tx.getType(), tx.getStatus().name());
        return new SubmitResult(toResponse(tx), false);
    }

    private Account loadForSubmit(UUID accountId, AuthenticatedUser actor) {
        Account a = accounts.findById(accountId)
                .orElseThrow(() -> ApiException.notFound("ACCOUNT_NOT_FOUND", "Account not found"));
        if (!policy.canViewAccount(actor, a.getCustomerId())) {
            audit.recordIndependent(actor, "ACCESS_DENIED", "ACCOUNT", accountId, "object-level authorization failed (submit)");
            throw ApiException.notFound("ACCOUNT_NOT_FOUND", "Account not found");
        }
        return a;
    }

    private AccountSnapshot snapshot(Account a) {
        if (a == null) {
            return null;
        }
        Customer owner = customers.findById(a.getCustomerId()).orElseThrow();
        return new AccountSnapshot(a.getId(), a.getStatus(), owner.getStatus(), a.getCurrency(), a.availableBalance(),
                a.getDailyWithdrawalLimit());
    }

    // ------------------------------------------------------------------ review / cancel

    @Transactional
    public TransactionResponse approve(UUID id, AuthenticatedUser actor) {
        FinancialTransaction tx = load(id);
        requireReviewer(tx, actor);
        tx.review(actor.subject());
        tx.transitionTo(TransactionStatus.VALIDATED, Instant.now(clock)); // 409 unless PENDING_REVIEW
        transactions.saveAndFlush(tx);
        outbox.enqueue(OutboxService.TRANSACTION_VALIDATED, tx.getId(), "{\"reference\":\"" + tx.getReference() + "\"}");
        audit.record(actor, "TRANSACTION_APPROVED", "TRANSACTION", id, "approved by independent reviewer");
        return toResponse(tx);
    }

    @Transactional
    public TransactionResponse reject(UUID id, String reason, AuthenticatedUser actor) {
        FinancialTransaction tx = load(id);
        requireReviewer(tx, actor);
        if (tx.getStatus() != TransactionStatus.PENDING_REVIEW) {
            throw ApiException.conflict("INVALID_STATE_TRANSITION", "Only a transaction pending review can be rejected");
        }
        tx.review(actor.subject());
        tx.recordFailure("REVIEW_REJECTED", reason);
        tx.transitionTo(TransactionStatus.REJECTED, Instant.now(clock));
        transactions.saveAndFlush(tx);
        audit.record(actor, "TRANSACTION_REJECTED", "TRANSACTION", id, "review rejected: " + reason);
        return toResponse(tx);
    }

    @Transactional
    public TransactionResponse cancel(UUID id, AuthenticatedUser actor) {
        FinancialTransaction tx = load(id);
        UUID srcOwner = ownerOf(tx.getSourceAccountId());
        UUID tgtOwner = ownerOf(tx.getTargetAccountId());
        if (!policy.canViewTransaction(actor, srcOwner, tgtOwner)) {
            audit.recordIndependent(actor, "ACCESS_DENIED", "TRANSACTION", id, "object-level authorization failed (cancel)");
            throw notFound();
        }
        if (!policy.canCancel(actor, tx.getSubmittedBy(), srcOwner, tgtOwner)) {
            throw ApiException.forbidden("CANCEL_NOT_PERMITTED", "You are not permitted to cancel this transaction");
        }
        if (!tx.getStatus().isCancellable()) {
            throw ApiException.conflict("INVALID_STATE_TRANSITION",
                    "A " + tx.getStatus() + " transaction can no longer be cancelled");
        }
        tx.transitionTo(TransactionStatus.CANCELLED, Instant.now(clock));
        transactions.saveAndFlush(tx); // @Version: a concurrent PROCESSING transition makes exactly one of the two lose
        audit.record(actor, "TRANSACTION_CANCELLED", "TRANSACTION", id, null);
        return toResponse(tx);
    }

    private void requireReviewer(FinancialTransaction tx, AuthenticatedUser actor) {
        if (!policy.canReview(actor, tx.getSubmittedBy())) {
            audit.recordIndependent(actor, "REVIEW_DENIED", "TRANSACTION", tx.getId(), "maker-checker violation or insufficient role");
            throw ApiException.forbidden("MAKER_CHECKER_VIOLATION",
                    "Approval requires a different operator than the one who submitted the transaction");
        }
    }

    // ------------------------------------------------------------------ queries

    @Transactional(readOnly = true)
    public TransactionResponse get(UUID id, AuthenticatedUser actor) {
        return toResponse(requireVisible(id, actor));
    }

    @Transactional(readOnly = true)
    public List<AttemptResponse> attempts(UUID id, AuthenticatedUser actor) {
        requireVisible(id, actor);
        return attempts.findByTransactionIdOrderByAttemptNoAsc(id).stream()
                .map(a -> new AttemptResponse(a.getAttemptNo(), a.getStage(), a.getOutcome(), a.getDetail(),
                        a.getStartedAt(), a.getFinishedAt())).toList();
    }

    public record SearchCriteria(List<TransactionStatus> statuses, TransactionType type, UUID accountId, String reference,
                                 Instant from, Instant to, BigDecimal minAmount, BigDecimal maxAmount, String currency) {
    }

    @Transactional(readOnly = true)
    public PageResponse<TransactionResponse> search(SearchCriteria c, Pageable pageable, AuthenticatedUser actor) {
        List<UUID> scope = null; // null => staff, no ownership restriction
        if (!actor.isStaff()) {
            scope = actor.customerId() == null ? List.of() : accounts.findIdsByCustomerId(actor.customerId());
            if (c.accountId() != null && !scope.contains(c.accountId())) {
                audit.recordIndependent(actor, "ACCESS_DENIED", "ACCOUNT", c.accountId(), "transaction search outside own accounts");
                throw ApiException.notFound("ACCOUNT_NOT_FOUND", "Account not found");
            }
            if (scope.isEmpty()) {
                return new PageResponse<>(List.of(), pageable.getPageNumber(), pageable.getPageSize(), 0, 0);
            }
        }
        return run(c, scope, pageable);
    }

    /** History of one account; account visibility (object-level authorization) is checked first. */
    @Transactional(readOnly = true)
    public PageResponse<TransactionResponse> accountHistory(UUID accountId, Pageable pageable, AuthenticatedUser actor) {
        loadForSubmit(accountId, actor); // object-level authorization (404 + audit when not visible)
        return run(new SearchCriteria(null, null, accountId, null, null, null, null, null, null), null, pageable);
    }

    private PageResponse<TransactionResponse> run(SearchCriteria c, List<UUID> scope, Pageable pageable) {
        Pageable page = PageableSupport.restrictSort(pageable, SORTABLE, Sort.by(Sort.Direction.DESC, "createdAt"));
        Specification<FinancialTransaction> spec = (root, query, cb) -> {
            List<Predicate> p = new ArrayList<>();
            if (scope != null) {
                p.add(cb.or(root.get("sourceAccountId").in(scope), root.get("targetAccountId").in(scope)));
            }
            if (c.accountId() != null) {
                p.add(cb.or(cb.equal(root.get("sourceAccountId"), c.accountId()), cb.equal(root.get("targetAccountId"), c.accountId())));
            }
            if (c.statuses() != null && !c.statuses().isEmpty()) {
                p.add(root.get("status").in(c.statuses()));
            }
            if (c.type() != null) {
                p.add(cb.equal(root.get("type"), c.type()));
            }
            if (c.reference() != null && !c.reference().isBlank()) {
                p.add(cb.equal(root.get("reference"), c.reference().trim().toUpperCase(Locale.ROOT)));
            }
            if (c.from() != null) {
                p.add(cb.greaterThanOrEqualTo(root.get("createdAt"), c.from()));
            }
            if (c.to() != null) {
                p.add(cb.lessThan(root.get("createdAt"), c.to()));
            }
            if (c.minAmount() != null) {
                p.add(cb.greaterThanOrEqualTo(root.get("amount"), c.minAmount()));
            }
            if (c.maxAmount() != null) {
                p.add(cb.lessThanOrEqualTo(root.get("amount"), c.maxAmount()));
            }
            if (c.currency() != null && !c.currency().isBlank()) {
                p.add(cb.equal(root.get("currency"), c.currency().trim().toUpperCase(Locale.ROOT)));
            }
            return cb.and(p.toArray(new Predicate[0]));
        };
        return PageResponse.of(transactions.findAll(spec, page), TransactionService::toResponse);
    }

    @Override
    @Transactional(readOnly = true)
    public boolean hasInFlightTransactions(UUID accountId) {
        return transactions.existsInFlight(accountId, TransactionStatus.inFlight());
    }

    // ------------------------------------------------------------------ helpers

    private FinancialTransaction load(UUID id) {
        return transactions.findById(id).orElseThrow(TransactionService::notFound);
    }

    private FinancialTransaction requireVisible(UUID id, AuthenticatedUser actor) {
        FinancialTransaction tx = load(id);
        if (!policy.canViewTransaction(actor, ownerOf(tx.getSourceAccountId()), ownerOf(tx.getTargetAccountId()))) {
            audit.recordIndependent(actor, "ACCESS_DENIED", "TRANSACTION", id, "object-level authorization failed");
            throw notFound();
        }
        return tx;
    }

    private UUID ownerOf(UUID accountId) {
        return accountId == null ? null : accounts.findById(accountId).map(Account::getCustomerId).orElse(null);
    }

    private static ApiException notFound() {
        return ApiException.notFound("TRANSACTION_NOT_FOUND", "Transaction not found");
    }

    private static String newReference() {
        return "TXN-" + UUID.randomUUID().toString().replace("-", "").substring(0, 12).toUpperCase(Locale.ROOT);
    }

    /** SHA-256 over the canonical request, so equal payloads match and any difference is detected. */
    static String fingerprint(SubmitTransactionRequest r) {
        String canonical = String.join("|", String.valueOf(r.type()), String.valueOf(r.sourceAccountId()),
                String.valueOf(r.targetAccountId()), r.amount().stripTrailingZeros().toPlainString(), r.currency(),
                r.memo() == null ? "" : r.memo());
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    public static TransactionResponse toResponse(FinancialTransaction t) {
        String c = t.getCurrency();
        return new TransactionResponse(t.getId(), t.getReference(), t.getType(), t.getStatus(), t.getSourceAccountId(),
                t.getTargetAccountId(), MoneyPolicy.toDisplay(t.getAmount(), c), c, t.getMemo(), t.getSubmittedBy(),
                t.getReviewedBy(), t.getFailureCode(), t.getFailureDetail(), t.getVersion(), t.getCreatedAt(),
                t.getUpdatedAt(), t.getCompletedAt());
    }

}
