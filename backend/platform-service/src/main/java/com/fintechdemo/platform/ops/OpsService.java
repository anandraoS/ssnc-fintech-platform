package com.fintechdemo.platform.ops;

import com.fintechdemo.platform.account.AccountRepository;
import com.fintechdemo.platform.account.AccountService;
import com.fintechdemo.platform.audit.AuditEvent;
import com.fintechdemo.platform.audit.AuditEventRepository;
import com.fintechdemo.platform.clearing.ClearingClient;
import com.fintechdemo.platform.common.MoneyPolicy;
import com.fintechdemo.platform.common.PageResponse;
import com.fintechdemo.platform.common.PageableSupport;
import com.fintechdemo.platform.ops.OpsDtos.AuditRow;
import com.fintechdemo.platform.ops.OpsDtos.ComponentHealth;
import com.fintechdemo.platform.ops.OpsDtos.CurrencyBalance;
import com.fintechdemo.platform.ops.OpsDtos.HttpStats;
import com.fintechdemo.platform.ops.OpsDtos.IntegrityIssue;
import com.fintechdemo.platform.ops.OpsDtos.LatencyStats;
import com.fintechdemo.platform.ops.OpsDtos.LedgerRow;
import com.fintechdemo.platform.ops.OpsDtos.OutboxRow;
import com.fintechdemo.platform.ops.OpsDtos.PlatformHealth;
import com.fintechdemo.platform.ops.OpsDtos.Summary;
import com.fintechdemo.platform.ops.OpsDtos.VolumeRow;
import com.fintechdemo.platform.security.AuthenticatedUser;
import com.fintechdemo.platform.transaction.FinancialTransaction;
import com.fintechdemo.platform.transaction.OutboxEvent;
import com.fintechdemo.platform.transaction.ReconciliationRecord;
import com.fintechdemo.platform.transaction.SupportRepositories.LedgerRepository;
import com.fintechdemo.platform.transaction.SupportRepositories.OutboxRepository;
import com.fintechdemo.platform.transaction.SupportRepositories.ReconciliationRepository;
import com.fintechdemo.platform.transaction.TransactionRepository;
import com.fintechdemo.platform.transaction.TransactionStatus;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.persistence.criteria.Predicate;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read models for the operations dashboard plus platform health and integrity checks. */
@Service
@Transactional(readOnly = true)
public class OpsService {

    private static final Set<String> AUDIT_SORTABLE = Set.of("occurredAt", "action", "actor", "entityType");

    private final TransactionRepository transactions;
    private final AccountRepository accounts;
    private final ReconciliationRepository reconciliation;
    private final OutboxRepository outbox;
    private final LedgerRepository ledger;
    private final AuditEventRepository audit;
    private final AccountService accountService;
    private final ClearingClient clearing;
    private final JdbcTemplate jdbc;
    private final MeterRegistry meters;
    private final Clock clock;

    public OpsService(TransactionRepository transactions, AccountRepository accounts, ReconciliationRepository reconciliation,
                      OutboxRepository outbox, LedgerRepository ledger, AuditEventRepository audit,
                      AccountService accountService, ClearingClient clearing, JdbcTemplate jdbc, MeterRegistry meters,
                      Clock clock) {
        this.transactions = transactions;
        this.accounts = accounts;
        this.reconciliation = reconciliation;
        this.outbox = outbox;
        this.ledger = ledger;
        this.audit = audit;
        this.accountService = accountService;
        this.clearing = clearing;
        this.jdbc = jdbc;
        this.meters = meters;
        this.clock = clock;
    }

    public Summary summary() {
        Instant now = Instant.now(clock);
        Instant since = now.minus(Duration.ofHours(24));

        Map<String, Long> byStatus = new LinkedHashMap<>();
        for (TransactionStatus s : TransactionStatus.values()) {
            byStatus.put(s.name(), 0L);
        }
        transactions.countByStatus().forEach(r -> byStatus.put(r.getStatus().name(), r.getTotal()));

        List<VolumeRow> volume = transactions.completedVolumeSince(since).stream()
                .map(r -> new VolumeRow(r.getType().name(), r.getCurrency(), r.getTotal(),
                        MoneyPolicy.toDisplay(r.getVolume(), r.getCurrency()))).toList();
        long completed = transactions.countSince(since, TransactionStatus.COMPLETED);
        long failed = transactions.countSince(since, TransactionStatus.FAILED);
        double failureRate = completed + failed == 0 ? 0.0 : (double) failed / (completed + failed);

        Map<String, Long> accountsByStatus = new LinkedHashMap<>();
        accounts.countByStatus().forEach(r -> accountsByStatus.put(r.getStatus().name(), r.getTotal()));
        List<CurrencyBalance> balances = accounts.totalBalanceByCurrency().stream()
                .map(r -> new CurrencyBalance(r.getCurrency(), MoneyPolicy.toDisplay(r.getTotal(), r.getCurrency()))).toList();

        return new Summary(now, byStatus, volume, completed, failed, byStatus.get("PENDING_REVIEW"),
                byStatus.get("RECONCILIATION_REQUIRED"), reconciliation.countByStatus(ReconciliationRecord.Status.OPEN),
                failureRate, latency(), httpStats(), accountsByStatus, balances);
    }

    private LatencyStats latency() {
        List<Long> millis = new ArrayList<>(transactions.recentlyCompleted(PageRequest.of(0, 500)).stream()
                .map((FinancialTransaction t) -> Duration.between(t.getCreatedAt(), t.getCompletedAt()).toMillis()).sorted().toList());
        if (millis.isEmpty()) {
            return new LatencyStats(0, 0, 0, 0, 0);
        }
        double avg = millis.stream().mapToLong(Long::longValue).average().orElse(0);
        return new LatencyStats(millis.size(), avg, percentile(millis, 50), percentile(millis, 95), percentile(millis, 99));
    }

    /** Nearest-rank percentile on a sorted list. */
    static long percentile(List<Long> sorted, int p) {
        int rank = (int) Math.ceil(p / 100.0 * sorted.size());
        return sorted.get(Math.max(0, Math.min(sorted.size() - 1, rank - 1)));
    }

    private HttpStats httpStats() {
        long total = 0;
        long errors = 0;
        for (Timer t : meters.find("http.server.requests").timers()) {
            long count = t.count();
            total += count;
            String status = t.getId().getTag("status");
            if (status != null && status.startsWith("5")) {
                errors += count;
            }
        }
        return new HttpStats(total, errors, total == 0 ? 0.0 : (double) errors / total);
    }

    public PlatformHealth health() {
        List<ComponentHealth> components = new ArrayList<>();
        components.add(databaseHealth());
        boolean clearingUp = clearing.isHealthy();
        String circuit = clearing.circuitState();
        boolean circuitOk = "CLOSED".equals(circuit) || "NOT_APPLICABLE".equals(circuit);
        components.add(new ComponentHealth("clearing-network", clearingUp && circuitOk ? "UP" : "DEGRADED",
                "reachable=" + clearingUp + ", circuit=" + circuit));
        long backlog = outbox.countByStatus(OutboxEvent.Status.NEW);
        long dead = outbox.countByStatus(OutboxEvent.Status.DEAD);
        components.add(new ComponentHealth("outbox", dead > 0 || backlog > 100 ? "DEGRADED" : "UP",
                "pending=" + backlog + ", dead-lettered=" + dead));
        long open = reconciliation.countByStatus(ReconciliationRecord.Status.OPEN);
        components.add(new ComponentHealth("reconciliation", open > 0 ? "ATTENTION" : "UP", "open records=" + open));

        String overall = components.stream().anyMatch(c -> "DOWN".equals(c.status())) ? "DOWN"
                : components.stream().anyMatch(c -> "DEGRADED".equals(c.status())) ? "DEGRADED" : "UP";
        return new PlatformHealth(overall, Instant.now(clock), components);
    }

    private ComponentHealth databaseHealth() {
        try {
            long started = System.nanoTime();
            jdbc.queryForObject("select 1", Integer.class);
            return new ComponentHealth("database", "UP", "round trip " + (System.nanoTime() - started) / 1_000_000 + " ms");
        } catch (RuntimeException e) {
            return new ComponentHealth("database", "DOWN", e.getClass().getSimpleName());
        }
    }

    public PageResponse<AuditRow> auditEvents(String action, String entityType, String entityId, String actor, Instant from,
                                              Instant to, Pageable pageable) {
        Pageable page = PageableSupport.restrictSort(pageable, AUDIT_SORTABLE, Sort.by(Sort.Direction.DESC, "occurredAt"));
        Specification<AuditEvent> spec = (root, query, cb) -> {
            List<Predicate> p = new ArrayList<>();
            if (action != null && !action.isBlank()) {
                p.add(cb.equal(root.get("action"), action));
            }
            if (entityType != null && !entityType.isBlank()) {
                p.add(cb.equal(root.get("entityType"), entityType));
            }
            if (entityId != null && !entityId.isBlank()) {
                p.add(cb.equal(root.get("entityId"), entityId));
            }
            if (actor != null && !actor.isBlank()) {
                p.add(cb.equal(root.get("actor"), actor));
            }
            if (from != null) {
                p.add(cb.greaterThanOrEqualTo(root.get("occurredAt"), from));
            }
            if (to != null) {
                p.add(cb.lessThan(root.get("occurredAt"), to));
            }
            return cb.and(p.toArray(new Predicate[0]));
        };
        return PageResponse.of(audit.findAll(spec, page), e -> new AuditRow(e.getId(), e.getOccurredAt(), e.getActor(),
                e.getActorRoles(), e.getAction(), e.getEntityType(), e.getEntityId(), e.getCorrelationId(), e.getDetails()));
    }

    /** Accounts whose stored balance differs from the sum of their ledger entries. Must always be empty. */
    public List<IntegrityIssue> ledgerIntegrity() {
        return ledger.findIntegrityViolations().stream()
                .map(r -> new IntegrityIssue(r.getAccountId(), r.getAccountNumber(), r.getBalance(), r.getLedgerSum())).toList();
    }

    public PageResponse<LedgerRow> accountLedger(UUID accountId, Pageable pageable, AuthenticatedUser actor) {
        accountService.requireVisible(accountId, actor);
        Pageable page = PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), Sort.by(Sort.Direction.DESC, "id"));
        return PageResponse.of(ledger.findByAccountId(accountId, page), e -> new LedgerRow(e.getId(), e.getTransactionId(),
                e.getEntryType().name(), e.getAmount(), e.getBalanceAfter(), e.getCreatedAt()));
    }

    public PageResponse<OutboxRow> outbox(OutboxEvent.Status status, Pageable pageable) {
        Pageable page = PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), Sort.by(Sort.Direction.ASC, "createdAt"));
        return PageResponse.of(outbox.findByStatus(status == null ? OutboxEvent.Status.DEAD : status, page),
                e -> new OutboxRow(e.getId(), e.getAggregateId(), e.getEventType(), e.getStatus().name(), e.getAttempts(),
                        e.getLastError(), e.getCreatedAt(), e.getAvailableAt()));
    }
}
