package com.fintechdemo.platform.ops;

import com.fasterxml.jackson.annotation.JsonFormat;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Operational dashboard and administration contracts. */
public final class OpsDtos {

    private OpsDtos() {
    }

    public record VolumeRow(String type, String currency, long count,
                            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal volume) {
    }

    public record CurrencyBalance(String currency, @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal total) {
    }

    public record LatencyStats(long sampleSize, double averageMs, long p50Ms, long p95Ms, long p99Ms) {
    }

    public record HttpStats(long totalRequests, long serverErrors, double errorRate) {
    }

    public record Summary(
            Instant generatedAt,
            Map<String, Long> transactionsByStatus,
            List<VolumeRow> completedVolumeLast24h,
            long completedLast24h,
            long failedLast24h,
            long pendingReview,
            long reconciliationRequired,
            long openReconciliationRecords,
            double transactionFailureRateLast24h,
            LatencyStats processingLatency,
            HttpStats http,
            Map<String, Long> accountsByStatus,
            List<CurrencyBalance> totalBalances) {
    }

    public record ComponentHealth(String name, String status, String detail) {
    }

    public record PlatformHealth(String status, Instant checkedAt, List<ComponentHealth> components) {
    }

    public record AuditPage(List<AuditRow> items, int page, int size, long totalElements, int totalPages) {
    }

    public record AuditRow(Long id, Instant occurredAt, String actor, String actorRoles, String action, String entityType,
                           String entityId, String correlationId, String details) {
    }

    public record IntegrityIssue(UUID accountId, String accountNumber,
                                 @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal balance,
                                 @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal ledgerSum) {
    }

    public record LedgerRow(Long id, UUID transactionId, String entryType,
                            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal amount,
                            @JsonFormat(shape = JsonFormat.Shape.STRING) BigDecimal balanceAfter, Instant createdAt) {
    }

    public record OutboxRow(UUID id, UUID aggregateId, String eventType, String status, int attempts, String lastError,
                            Instant createdAt, Instant availableAt) {
    }

    public record DrainResult(int dispatched, int reconciled, int recoveredStuck) {
    }
}
