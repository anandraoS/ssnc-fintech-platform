package com.fintechdemo.platform.account;

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
 * Investment account. Balance mutations go through {@link #debit}/{@link #credit} only, which enforce the invariants;
 * callers MUST hold the row lock (see AccountRepository#lockById) when they mutate a balance.
 * {@code version} is an additional optimistic-lock guard for every path that does not take the pessimistic lock.
 */
@Entity
@Table(name = "accounts")
public class Account {

    @Id
    private UUID id;

    @Column(name = "account_number", nullable = false, updatable = false, length = 20)
    private String accountNumber;

    @Column(name = "customer_id", nullable = false, updatable = false)
    private UUID customerId;

    @Enumerated(EnumType.STRING)
    @Column(name = "account_type", nullable = false, updatable = false, length = 20)
    private AccountType accountType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 24)
    private AccountStatus status;

    @Column(name = "status_reason", length = 255)
    private String statusReason;

    @Column(nullable = false, updatable = false, length = 3)
    private String currency;

    @Column(nullable = false, precision = 19, scale = 4)
    private BigDecimal balance;

    @Column(name = "minimum_balance", nullable = false, precision = 19, scale = 4)
    private BigDecimal minimumBalance;

    @Column(name = "daily_withdrawal_limit", nullable = false, precision = 19, scale = 4)
    private BigDecimal dailyWithdrawalLimit;

    @Version
    private Long version;

    @Column(name = "opened_at", nullable = false, updatable = false)
    private Instant openedAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Account() {
    }

    public Account(UUID id, String accountNumber, UUID customerId, AccountType type, String currency,
                   BigDecimal dailyWithdrawalLimit, Instant now) {
        this.id = id;
        this.accountNumber = accountNumber;
        this.customerId = customerId;
        this.accountType = type;
        this.currency = currency;
        this.status = AccountStatus.PENDING_ACTIVATION;
        this.balance = BigDecimal.ZERO.setScale(4);
        this.minimumBalance = type.minimumBalance().setScale(4);
        this.dailyWithdrawalLimit = dailyWithdrawalLimit.setScale(4);
        this.openedAt = now;
        this.updatedAt = now;
    }

    public BigDecimal availableBalance() {
        return balance.subtract(minimumBalance).max(BigDecimal.ZERO);
    }

    public boolean isActive() {
        return status == AccountStatus.ACTIVE;
    }

    /** Removes funds. Throws if it would breach the minimum balance. Caller holds the row lock. */
    public void debit(BigDecimal amount, Instant now) {
        if (balance.subtract(amount).compareTo(minimumBalance) < 0) {
            throw ApiException.unprocessable("INSUFFICIENT_FUNDS", "Available balance is insufficient");
        }
        balance = balance.subtract(amount);
        updatedAt = now;
    }

    public void credit(BigDecimal amount, Instant now) {
        balance = balance.add(amount);
        updatedAt = now;
    }

    public void transitionTo(AccountStatus next, String reason, Instant now) {
        if (!status.canTransitionTo(next)) {
            throw ApiException.conflict("INVALID_STATE_TRANSITION",
                    "Account cannot move from " + status + " to " + next);
        }
        this.status = next;
        this.statusReason = reason;
        this.updatedAt = now;
    }

    public UUID getId() {
        return id;
    }

    public String getAccountNumber() {
        return accountNumber;
    }

    public UUID getCustomerId() {
        return customerId;
    }

    public AccountType getAccountType() {
        return accountType;
    }

    public AccountStatus getStatus() {
        return status;
    }

    public String getStatusReason() {
        return statusReason;
    }

    public String getCurrency() {
        return currency;
    }

    public BigDecimal getBalance() {
        return balance;
    }

    public BigDecimal getMinimumBalance() {
        return minimumBalance;
    }

    public BigDecimal getDailyWithdrawalLimit() {
        return dailyWithdrawalLimit;
    }

    /** Wrapper type on purpose: Spring Data decides new-vs-existing from a null version (see ADR-005 notes). */
    public Long getVersion() {
        return version;
    }

    public Instant getOpenedAt() {
        return openedAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
