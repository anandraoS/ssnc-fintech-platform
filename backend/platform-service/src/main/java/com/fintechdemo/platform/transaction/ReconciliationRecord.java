package com.fintechdemo.platform.transaction;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

/** Tracks a transaction whose external outcome is uncertain until it is resolved automatically or by an operator. */
@Entity
@Table(name = "reconciliation_records")
public class ReconciliationRecord {

    public enum Status {OPEN, RESOLVED}

    public enum Resolution {CONFIRMED_EXECUTED, CONFIRMED_NOT_EXECUTED}

    @Id
    private UUID id;

    @Column(name = "transaction_id", nullable = false, updatable = false)
    private UUID transactionId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 12)
    private Status status;

    @Column(name = "reason_code", nullable = false, updatable = false, length = 50)
    private String reasonCode;

    @Column(length = 500)
    private String detail;

    @Column(name = "opened_at", nullable = false, updatable = false)
    private Instant openedAt;

    @Column(name = "resolved_at")
    private Instant resolvedAt;

    @Column(name = "resolved_by", length = 100)
    private String resolvedBy;

    @Enumerated(EnumType.STRING)
    @Column(length = 30)
    private Resolution resolution;

    @Column(name = "resolution_note", length = 500)
    private String resolutionNote;

    @Version
    private Long version;

    protected ReconciliationRecord() {
    }

    public ReconciliationRecord(UUID transactionId, String reasonCode, String detail, Instant now) {
        this.id = UUID.randomUUID();
        this.transactionId = transactionId;
        this.status = Status.OPEN;
        this.reasonCode = reasonCode;
        this.detail = detail != null && detail.length() > 500 ? detail.substring(0, 500) : detail;
        this.openedAt = now;
    }

    public void resolve(Resolution resolution, String by, String note, Instant now) {
        this.status = Status.RESOLVED;
        this.resolution = resolution;
        this.resolvedBy = by;
        this.resolutionNote = note != null && note.length() > 500 ? note.substring(0, 500) : note;
        this.resolvedAt = now;
    }

    public UUID getId() {
        return id;
    }

    public UUID getTransactionId() {
        return transactionId;
    }

    public Status getStatus() {
        return status;
    }

    public String getReasonCode() {
        return reasonCode;
    }

    public String getDetail() {
        return detail;
    }

    public Instant getOpenedAt() {
        return openedAt;
    }

    public Instant getResolvedAt() {
        return resolvedAt;
    }

    public String getResolvedBy() {
        return resolvedBy;
    }

    public Resolution getResolution() {
        return resolution;
    }

    public String getResolutionNote() {
        return resolutionNote;
    }
}
