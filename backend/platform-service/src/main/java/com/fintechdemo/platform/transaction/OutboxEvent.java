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

/**
 * Transactional-outbox row. Written in the same DB transaction as the state change it announces, so the event can
 * never be lost or announced for a rolled-back change. Delivery is at-least-once: consumers must be idempotent.
 * Status DEAD is the dead-letter state (needs an operator: inspect, then requeue).
 */
@Entity
@Table(name = "outbox_events")
public class OutboxEvent {

    public enum Status {NEW, DISPATCHED, DEAD}

    @Id
    private UUID id;

    @Column(name = "aggregate_type", nullable = false, updatable = false, length = 30)
    private String aggregateType;

    @Column(name = "aggregate_id", nullable = false, updatable = false)
    private UUID aggregateId;

    @Column(name = "event_type", nullable = false, updatable = false, length = 50)
    private String eventType;

    @Column(updatable = false, length = 2000)
    private String payload;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 12)
    private Status status;

    @Column(nullable = false)
    private int attempts;

    @Column(name = "last_error", length = 500)
    private String lastError;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "available_at", nullable = false)
    private Instant availableAt;

    @Column(name = "dispatched_at")
    private Instant dispatchedAt;

    @Version
    private Long version;

    protected OutboxEvent() {
    }

    public OutboxEvent(String aggregateType, UUID aggregateId, String eventType, String payload, Instant now) {
        this.id = UUID.randomUUID();
        this.aggregateType = aggregateType;
        this.aggregateId = aggregateId;
        this.eventType = eventType;
        this.payload = payload;
        this.status = Status.NEW;
        this.createdAt = now;
        this.availableAt = now;
    }

    /** Leases the event: bumps attempts and hides it until {@code leaseUntil}. A concurrent claimer loses on @Version. */
    public void lease(Instant leaseUntil) {
        this.attempts++;
        this.availableAt = leaseUntil;
    }

    public void markDispatched(Instant now) {
        this.status = Status.DISPATCHED;
        this.dispatchedAt = now;
        this.lastError = null;
    }

    public void scheduleRetry(Instant at, String error) {
        this.availableAt = at;
        this.lastError = truncate(error);
    }

    public void markDead(String error, Instant now) {
        this.status = Status.DEAD;
        this.lastError = truncate(error);
        this.availableAt = now;
    }

    public void requeue(Instant now) {
        this.status = Status.NEW;
        this.attempts = 0;
        this.availableAt = now;
    }

    private static String truncate(String s) {
        return s != null && s.length() > 500 ? s.substring(0, 500) : s;
    }

    public UUID getId() {
        return id;
    }

    public String getAggregateType() {
        return aggregateType;
    }

    public UUID getAggregateId() {
        return aggregateId;
    }

    public String getEventType() {
        return eventType;
    }

    public String getPayload() {
        return payload;
    }

    public Status getStatus() {
        return status;
    }

    public int getAttempts() {
        return attempts;
    }

    public String getLastError() {
        return lastError;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getAvailableAt() {
        return availableAt;
    }

    public Instant getDispatchedAt() {
        return dispatchedAt;
    }
}
