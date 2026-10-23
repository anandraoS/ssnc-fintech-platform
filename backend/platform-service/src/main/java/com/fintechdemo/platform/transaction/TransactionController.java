package com.fintechdemo.platform.transaction;

import com.fintechdemo.platform.audit.AuditEvent;
import com.fintechdemo.platform.audit.AuditEventRepository;
import com.fintechdemo.platform.common.ApiError;
import com.fintechdemo.platform.common.ErrorResponses;
import com.fintechdemo.platform.common.PageResponse;
import com.fintechdemo.platform.security.AuthenticatedUser;
import com.fintechdemo.platform.transaction.TransactionDtos.ApproveRequest;
import com.fintechdemo.platform.transaction.TransactionDtos.AttemptResponse;
import com.fintechdemo.platform.transaction.TransactionDtos.RejectRequest;
import com.fintechdemo.platform.transaction.TransactionDtos.SubmitResult;
import com.fintechdemo.platform.transaction.TransactionDtos.SubmitTransactionRequest;
import com.fintechdemo.platform.transaction.TransactionDtos.TransactionResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.math.BigDecimal;
import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
@Tag(name = "Transactions")
public class TransactionController {

    private final TransactionService service;
    private final AuditEventRepository auditEvents;

    public TransactionController(TransactionService service, AuditEventRepository auditEvents) {
        this.service = service;
        this.auditEvents = auditEvents;
    }

    @Operation(summary = "Submit a transaction",
            description = "Idempotent: repeat the same request with the same Idempotency-Key to get the original result "
                    + "(header Idempotent-Replayed: true). 202 = accepted for processing, 422 = rejected by business rules.")
    @PostMapping("/transactions")
    @PreAuthorize("hasAnyRole('CUSTOMER','OPERATIONS_ANALYST','ADMIN')")
    public ResponseEntity<?> submit(@Valid @RequestBody SubmitTransactionRequest request,
                                    @Parameter(description = "Unique key per logical request (8-80 chars)", required = true)
                                    @RequestHeader("Idempotency-Key") String idempotencyKey,
                                    AuthenticatedUser user) {
        SubmitResult result = service.submit(request, idempotencyKey, user);
        TransactionResponse tx = result.transaction();
        ResponseEntity.BodyBuilder builder = tx.status() == TransactionStatus.REJECTED
                ? ResponseEntity.unprocessableEntity()
                : ResponseEntity.accepted().location(URI.create("/api/v1/transactions/" + tx.id()));
        if (result.replayed()) {
            builder.header("Idempotent-Replayed", "true");
        }
        if (tx.status() == TransactionStatus.REJECTED) {
            ApiError error = ErrorResponses.build(HttpStatus.UNPROCESSABLE_ENTITY, "TRANSACTION_REJECTED",
                    "The transaction was rejected by business rules", "/api/v1/transactions", null,
                    Map.of("transactionId", tx.id(), "reference", tx.reference(), "status", tx.status(),
                            "failureCode", String.valueOf(tx.failureCode()), "failureDetail", String.valueOf(tx.failureDetail())));
            return builder.body(error);
        }
        return builder.body(tx);
    }

    @GetMapping("/transactions")
    public PageResponse<TransactionResponse> search(
            @RequestParam(required = false) List<TransactionStatus> status,
            @RequestParam(required = false) TransactionType type,
            @RequestParam(required = false) UUID accountId,
            @RequestParam(required = false) String reference,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to,
            @RequestParam(required = false) BigDecimal minAmount,
            @RequestParam(required = false) BigDecimal maxAmount,
            @RequestParam(required = false) String currency,
            Pageable pageable, AuthenticatedUser user) {
        return service.search(new TransactionService.SearchCriteria(status, type, accountId, reference, from, to,
                minAmount, maxAmount, currency), pageable, user);
    }

    @GetMapping("/transactions/{id}")
    public TransactionResponse get(@PathVariable UUID id, AuthenticatedUser user) {
        return service.get(id, user);
    }

    @GetMapping("/transactions/{id}/attempts")
    @PreAuthorize("hasAnyRole('SUPPORT_AGENT','OPERATIONS_ANALYST','ADMIN')")
    public List<AttemptResponse> attempts(@PathVariable UUID id, AuthenticatedUser user) {
        return service.attempts(id, user);
    }

    @GetMapping("/transactions/{id}/audit")
    @PreAuthorize("hasAnyRole('SUPPORT_AGENT','OPERATIONS_ANALYST','ADMIN')")
    public List<AuditView> audit(@PathVariable UUID id, AuthenticatedUser user) {
        service.get(id, user); // visibility check
        return auditEvents.findByEntityTypeAndEntityId("TRANSACTION", id.toString(),
                        PageRequest.of(0, 200, Sort.by("id").ascending())).map(AuditView::of).getContent();
    }

    @PostMapping("/transactions/{id}/cancel")
    public TransactionResponse cancel(@PathVariable UUID id, AuthenticatedUser user) {
        return service.cancel(id, user);
    }

    @PostMapping("/transactions/{id}/approve")
    @PreAuthorize("hasAnyRole('OPERATIONS_ANALYST','ADMIN')")
    public TransactionResponse approve(@PathVariable UUID id, @RequestBody(required = false) @Valid ApproveRequest request,
                                       AuthenticatedUser user) {
        return service.approve(id, user);
    }

    @PostMapping("/transactions/{id}/reject")
    @PreAuthorize("hasAnyRole('OPERATIONS_ANALYST','ADMIN')")
    public TransactionResponse reject(@PathVariable UUID id, @Valid @RequestBody RejectRequest request, AuthenticatedUser user) {
        return service.reject(id, request.reason(), user);
    }

    @GetMapping("/accounts/{accountId}/transactions")
    public PageResponse<TransactionResponse> accountHistory(@PathVariable UUID accountId, Pageable pageable,
                                                            AuthenticatedUser user) {
        return service.accountHistory(accountId, pageable, user);
    }

    public record AuditView(Long id, Instant occurredAt, String actor, String actorRoles, String action, String entityType,
                            String entityId, String correlationId, String details) {
        public static AuditView of(AuditEvent e) {
            return new AuditView(e.getId(), e.getOccurredAt(), e.getActor(), e.getActorRoles(), e.getAction(),
                    e.getEntityType(), e.getEntityId(), e.getCorrelationId(), e.getDetails());
        }
    }
}
