package com.fintechdemo.platform.transaction;

import com.fintechdemo.platform.common.ApiException;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * A money-movement request and its lifecycle. State changes only through {@link #transitionTo}; the {@code version}
 * column makes competing transitions (cancel vs. process, double approval) fail instead of silently overwriting.
 */
@Entity
@Table(name = "transactions")
public class FinancialTransaction {

    @Id
    private UUID id;

    @Column(nullable = false, updatable = false, length = 30)
    private String reference;

    @Enumerated(EnumType.STRING)
    @Column(name = "transaction_type", nullable = false, updatable = false, length = 20)
    private TransactionType type;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private TransactionStatus status;

    @Column(name = "source_account_id", updatable = false)
    private UUID sourceAccountId;

    @Column(name = "target_account_id", updatable = false)
    private UUID targetAccountId;

    @Column(nullable = false, updatable = false, precision = 19, scale = 4)
    private BigDecimal amount;

    @Column(nullable = false, updatable = false, length = 3)
    private String currency;

    @Column(updatable = false, length = 140)
    private String memo;

    @Column(name = "submitted_by", nullable = false, updatable = false, length = 100)
    private String submittedBy;

    @Column(name = "reviewed_by", length = 100)
    private String reviewedBy;

    @Column(name = "failure_code", length = 50)
    private String failureCode;

    @Column(name = "failure_detail", length = 500)
    private String failureDetail;

    @Column(name = "funds_reserved", nullable = false)
    private boolean fundsReserved;

    @Version
    private Long version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    protected FinancialTransaction() {
    }

    public FinancialTransaction(UUID id, String reference, TransactionType type, UUID sourceAccountId,
                                UUID targetAccountId, BigDecimal amount, String currency, String memo,
                                String submittedBy, Instant now) {
        this.id = id;
        this.reference = reference;
        this.type = type;
        this.status = TransactionStatus.RECEIVED;
        this.sourceAccountId = sourceAccountId;
        this.targetAccountId = targetAccountId;
        this.amount = amount;
        this.currency = currency;
        this.memo = memo;
        this.submittedBy = submittedBy;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void transitionTo(TransactionStatus next, Instant now) {
        if (!status.canTransitionTo(next)) {
            throw ApiException.conflict("INVALID_STATE_TRANSITION",
                    "Transaction cannot move from " + status + " to " + next)
                    .with("from", status.name()).with("to", next.name());
        }
        this.status = next;
        this.updatedAt = now;
        if (next.isTerminal()) {
            this.completedAt = now;
        }
    }

    public void recordFailure(String code, String detail) {
        this.failureCode = code;
        this.failureDetail = detail != null && detail.length() > 500 ? detail.substring(0, 500) : detail;
    }

    public void clearFailure() {
        this.failureCode = null;
        this.failureDetail = null;
    }

    public void markFundsReserved(boolean reserved) {
        this.fundsReserved = reserved;
    }

    public void review(String reviewer) {
        this.reviewedBy = reviewer;
    }

    public UUID getId() {
        return id;
    }

    public String getReference() {
        return reference;
    }

    public TransactionType getType() {
        return type;
    }

    public TransactionStatus getStatus() {
        return status;
    }

    public UUID getSourceAccountId() {
        return sourceAccountId;
    }

    public UUID getTargetAccountId() {
        return targetAccountId;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public String getCurrency() {
        return currency;
    }

    public String getMemo() {
        return memo;
    }

    public String getSubmittedBy() {
        return submittedBy;
    }

    public String getReviewedBy() {
        return reviewedBy;
    }

    public String getFailureCode() {
        return failureCode;
    }

    public String getFailureDetail() {
        return failureDetail;
    }

    public boolean isFundsReserved() {
        return fundsReserved;
    }

    /** Wrapper type on purpose: Spring Data decides new-vs-existing from a null version (see ADR-005 notes). */
    public Long getVersion() {
        return version;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public Instant getCompletedAt() {
        return completedAt;
    }
}
