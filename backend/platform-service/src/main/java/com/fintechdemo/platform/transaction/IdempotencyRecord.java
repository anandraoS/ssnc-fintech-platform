package com.fintechdemo.platform.transaction;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** Maps (principal, Idempotency-Key) to the transaction it created. UNIQUE(principal, key) arbitrates races. */
@Entity
@Table(name = "idempotency_records")
public class IdempotencyRecord {

    @Id
    private UUID id;

    @Column(nullable = false, updatable = false, length = 100)
    private String principal;

    @Column(name = "idempotency_key", nullable = false, updatable = false, length = 80)
    private String key;

    @Column(name = "request_hash", nullable = false, updatable = false, length = 64)
    private String requestHash;

    @Column(name = "transaction_id", nullable = false, updatable = false)
    private UUID transactionId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected IdempotencyRecord() {
    }

    public IdempotencyRecord(String principal, String key, String requestHash, UUID transactionId, Instant createdAt) {
        this.id = UUID.randomUUID();
        this.principal = principal;
        this.key = key;
        this.requestHash = requestHash;
        this.transactionId = transactionId;
        this.createdAt = createdAt;
    }

    public String getPrincipal() {
        return principal;
    }

    public String getKey() {
        return key;
    }

    public String getRequestHash() {
        return requestHash;
    }

    public UUID getTransactionId() {
        return transactionId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
