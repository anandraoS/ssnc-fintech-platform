package com.fintechdemo.platform.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

/** Append-only audit record. No setters: once written it is never modified (PostgreSQL trigger enforces this). */
@Entity
@Table(name = "audit_events")
public class AuditEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "occurred_at", nullable = false, updatable = false)
    private Instant occurredAt;

    @Column(nullable = false, updatable = false, length = 100)
    private String actor;

    @Column(name = "actor_roles", updatable = false, length = 200)
    private String actorRoles;

    @Column(nullable = false, updatable = false, length = 60)
    private String action;

    @Column(name = "entity_type", nullable = false, updatable = false, length = 30)
    private String entityType;

    @Column(name = "entity_id", nullable = false, updatable = false, length = 64)
    private String entityId;

    @Column(name = "correlation_id", updatable = false, length = 64)
    private String correlationId;

    @Column(updatable = false, length = 2000)
    private String details;

    protected AuditEvent() {
    }

    public AuditEvent(Instant occurredAt, String actor, String actorRoles, String action, String entityType,
                      String entityId, String correlationId, String details) {
        this.occurredAt = occurredAt;
        this.actor = actor;
        this.actorRoles = actorRoles;
        this.action = action;
        this.entityType = entityType;
        this.entityId = entityId;
        this.correlationId = correlationId;
        this.details = details;
    }

    public Long getId() {
        return id;
    }

    public Instant getOccurredAt() {
        return occurredAt;
    }

    public String getActor() {
        return actor;
    }

    public String getActorRoles() {
        return actorRoles;
    }

    public String getAction() {
        return action;
    }

    public String getEntityType() {
        return entityType;
    }

    public String getEntityId() {
        return entityId;
    }

    public String getCorrelationId() {
        return correlationId;
    }

    public String getDetails() {
        return details;
    }
}
