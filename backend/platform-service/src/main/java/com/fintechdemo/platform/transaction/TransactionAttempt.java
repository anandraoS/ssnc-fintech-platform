package com.fintechdemo.platform.transaction;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** One processing attempt (stage + outcome) - the investigation trail for failed or uncertain transactions. */
@Entity
@Table(name = "transaction_attempts")
public class TransactionAttempt {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "transaction_id", nullable = false, updatable = false)
    private UUID transactionId;

    @Column(name = "attempt_no", nullable = false, updatable = false)
    private int attemptNo;

    @Column(nullable = false, updatable = false, length = 30)
    private String stage;

    @Column(nullable = false, length = 30)
    private String outcome;

    @Column(length = 500)
    private String detail;

    @Column(name = "started_at", nullable = false, updatable = false)
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    protected TransactionAttempt() {
    }

    public TransactionAttempt(UUID transactionId, int attemptNo, String stage, String outcome, String detail,
                              Instant startedAt, Instant finishedAt) {
        this.transactionId = transactionId;
        this.attemptNo = attemptNo;
        this.stage = stage;
        this.outcome = outcome;
        this.detail = detail != null && detail.length() > 500 ? detail.substring(0, 500) : detail;
        this.startedAt = startedAt;
        this.finishedAt = finishedAt;
    }

    public Long getId() {
        return id;
    }

    public UUID getTransactionId() {
        return transactionId;
    }

    public int getAttemptNo() {
        return attemptNo;
    }

    public String getStage() {
        return stage;
    }

    public String getOutcome() {
        return outcome;
    }

    public String getDetail() {
        return detail;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public Instant getFinishedAt() {
        return finishedAt;
    }
}
