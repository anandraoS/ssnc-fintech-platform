package com.fintechdemo.platform.ops;

import com.fintechdemo.platform.common.PageResponse;
import com.fintechdemo.platform.ops.OpsDtos.AuditRow;
import com.fintechdemo.platform.ops.OpsDtos.DrainResult;
import com.fintechdemo.platform.ops.OpsDtos.IntegrityIssue;
import com.fintechdemo.platform.ops.OpsDtos.LedgerRow;
import com.fintechdemo.platform.ops.OpsDtos.OutboxRow;
import com.fintechdemo.platform.ops.OpsDtos.PlatformHealth;
import com.fintechdemo.platform.ops.OpsDtos.Summary;
import com.fintechdemo.platform.security.AuthenticatedUser;
import com.fintechdemo.platform.transaction.OutboxDispatcher;
import com.fintechdemo.platform.transaction.OutboxEvent;
import com.fintechdemo.platform.transaction.ReconciliationRecord;
import com.fintechdemo.platform.transaction.ReconciliationService;
import com.fintechdemo.platform.transaction.ReconciliationService.ReconciliationView;
import com.fintechdemo.platform.transaction.TransactionMaintenance;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Operational and administrative endpoints (staff only). */
@RestController
@RequestMapping("/api/v1/ops")
@PreAuthorize("hasAnyRole('SUPPORT_AGENT','OPERATIONS_ANALYST','ADMIN')")
@Tag(name = "Operations")
public class OpsController {

    public record ResolveRequest(@NotNull ReconciliationRecord.Resolution resolution, @Size(max = 500) String note) {
    }

    private final OpsService ops;
    private final ReconciliationService reconciliation;
    private final OutboxDispatcher dispatcher;
    private final TransactionMaintenance maintenance;

    public OpsController(OpsService ops, ReconciliationService reconciliation, OutboxDispatcher dispatcher,
                         TransactionMaintenance maintenance) {
        this.ops = ops;
        this.reconciliation = reconciliation;
        this.dispatcher = dispatcher;
        this.maintenance = maintenance;
    }

    @GetMapping("/summary")
    public Summary summary() {
        return ops.summary();
    }

    @GetMapping("/health")
    public PlatformHealth health() {
        return ops.health();
    }

    @GetMapping("/audit-events")
    public PageResponse<AuditRow> auditEvents(@RequestParam(required = false) String action,
                                              @RequestParam(required = false) String entityType,
                                              @RequestParam(required = false) String entityId,
                                              @RequestParam(required = false) String actor,
                                              @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
                                              @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
                                              Pageable pageable) {
        return ops.auditEvents(action, entityType, entityId, actor, from, to, pageable);
    }

    @GetMapping("/reconciliations")
    public PageResponse<ReconciliationView> reconciliations(@RequestParam(required = false) ReconciliationRecord.Status status,
                                                            Pageable pageable) {
        return reconciliation.list(status, pageable);
    }

    @PostMapping("/reconciliations/{id}/resolve")
    @PreAuthorize("hasAnyRole('OPERATIONS_ANALYST','ADMIN')")
    public ReconciliationView resolve(@PathVariable UUID id, @Valid @RequestBody ResolveRequest request, AuthenticatedUser user) {
        return reconciliation.resolve(id, request.resolution(), request.note(), user);
    }

    @GetMapping("/ledger-integrity")
    @PreAuthorize("hasAnyRole('OPERATIONS_ANALYST','ADMIN')")
    public List<IntegrityIssue> ledgerIntegrity() {
        return ops.ledgerIntegrity();
    }

    @GetMapping("/accounts/{accountId}/ledger")
    public PageResponse<LedgerRow> ledger(@PathVariable UUID accountId, Pageable pageable, AuthenticatedUser user) {
        return ops.accountLedger(accountId, pageable, user);
    }

    @GetMapping("/outbox")
    @PreAuthorize("hasRole('ADMIN')")
    public PageResponse<OutboxRow> outbox(@RequestParam(required = false) OutboxEvent.Status status, Pageable pageable) {
        return ops.outbox(status, pageable);
    }

    @PostMapping("/outbox/{id}/requeue")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<Void> requeue(@PathVariable UUID id, AuthenticatedUser user) {
        dispatcher.requeue(id, user);
        return ResponseEntity.noContent().build();
    }

    /** Runs one synchronous pass of the background loops (used by operators and by the end-to-end tests). */
    @PostMapping("/processing/drain")
    @PreAuthorize("hasRole('ADMIN')")
    public DrainResult drain() {
        int dispatched = 0;
        for (int i = 0; i < 20; i++) {
            int n = dispatcher.drain();
            if (n == 0) {
                break;
            }
            dispatched += n;
        }
        return new DrainResult(dispatched, reconciliation.autoReconcile(), maintenance.recoverStuckProcessing());
    }
}
