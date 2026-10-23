package com.fintechdemo.platform.transaction;

import com.fintechdemo.platform.account.AccountStatus;
import com.fintechdemo.platform.common.MoneyPolicy;
import com.fintechdemo.platform.customer.CustomerStatus;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Pure business-rule validation (no I/O): everything it needs arrives in {@link Context}, so each rule is a
 * one-line unit test. The result is ADVISORY at submit time - balances can change before processing - so the
 * authoritative balance, status and limit checks are repeated under row locks in {@code LedgerService}.
 */
@Component
public class TransactionValidator {

    public record AccountSnapshot(UUID id, AccountStatus status, CustomerStatus ownerStatus, String currency,
                                  BigDecimal availableBalance, BigDecimal dailyWithdrawalLimit) {
    }

    public record Context(TransactionType type, BigDecimal amount, String currency, AccountSnapshot source,
                          AccountSnapshot target, BigDecimal withdrawnInWindow, BigDecimal maxAmount,
                          BigDecimal reviewThreshold) {
    }

    public record Violation(String code, String message) {
    }

    public enum Outcome {ACCEPT, REVIEW, REJECT}

    public record Result(Outcome outcome, List<Violation> violations) {
        public String primaryCode() {
            return violations.isEmpty() ? null : violations.get(0).code();
        }

        public String describe() {
            return String.join("; ", violations.stream().map(v -> v.code() + ": " + v.message()).toList());
        }
    }

    public Result validate(Context c) {
        List<Violation> v = new ArrayList<>();

        if (!MoneyPolicy.isSupported(c.currency())) {
            v.add(new Violation("UNSUPPORTED_CURRENCY", "Currency is not supported"));
        }
        if (c.amount().signum() <= 0) {
            v.add(new Violation("AMOUNT_NOT_POSITIVE", "Amount must be greater than zero"));
        } else {
            if (MoneyPolicy.isSupported(c.currency()) && !MoneyPolicy.hasValidPrecision(c.amount(), c.currency())) {
                v.add(new Violation("AMOUNT_PRECISION", "Amount has more decimal places than the currency allows"));
            }
            if (c.amount().compareTo(c.maxAmount()) > 0) {
                v.add(new Violation("AMOUNT_EXCEEDS_MAXIMUM", "Amount exceeds the per-transaction maximum"));
            }
        }

        switch (c.type()) {
            case DEPOSIT -> checkTarget(c, v);
            case WITHDRAWAL -> checkSource(c, v);
            case TRANSFER -> {
                if (c.source() != null && c.target() != null && c.source().id().equals(c.target().id())) {
                    v.add(new Violation("SAME_ACCOUNT_TRANSFER", "Source and target accounts must differ"));
                }
                checkSource(c, v);
                checkTarget(c, v);
            }
        }

        if (!v.isEmpty()) {
            return new Result(Outcome.REJECT, List.copyOf(v));
        }
        if (c.amount().compareTo(c.reviewThreshold()) >= 0) {
            return new Result(Outcome.REVIEW, List.of(new Violation("REVIEW_REQUIRED",
                    "Amount at or above the review threshold requires an independent operator approval")));
        }
        return new Result(Outcome.ACCEPT, List.of());
    }

    private void checkSource(Context c, List<Violation> v) {
        AccountSnapshot s = c.source();
        if (s.status() != AccountStatus.ACTIVE) {
            v.add(new Violation("SOURCE_ACCOUNT_NOT_ACTIVE", "Source account is " + s.status()));
        }
        if (s.ownerStatus() != CustomerStatus.ACTIVE) {
            v.add(new Violation("CUSTOMER_NOT_ACTIVE", "The owning customer is " + s.ownerStatus()));
        }
        if (!s.currency().equals(c.currency())) {
            v.add(new Violation("CURRENCY_MISMATCH", "Transaction currency differs from the source account currency"));
        }
        if (c.amount().signum() > 0 && c.amount().compareTo(s.availableBalance()) > 0) {
            v.add(new Violation("INSUFFICIENT_FUNDS", "Available balance is insufficient"));
        }
        if (c.type() == TransactionType.WITHDRAWAL && c.amount().signum() > 0
                && DailyLimitPolicy.wouldExceed(s.dailyWithdrawalLimit(), c.withdrawnInWindow(), c.amount())) {
            v.add(new Violation("DAILY_LIMIT_EXCEEDED", "The daily withdrawal limit for this account would be exceeded"));
        }
    }

    private void checkTarget(Context c, List<Violation> v) {
        AccountSnapshot t = c.target();
        if (t.status() != AccountStatus.ACTIVE) {
            v.add(new Violation("TARGET_ACCOUNT_NOT_ACTIVE", "Target account is " + t.status()));
        }
        if (t.ownerStatus() != CustomerStatus.ACTIVE) {
            v.add(new Violation("CUSTOMER_NOT_ACTIVE", "The owning customer is " + t.ownerStatus()));
        }
        if (!t.currency().equals(c.currency())) {
            v.add(new Violation("CURRENCY_MISMATCH", "Transaction currency differs from the target account currency"));
        }
    }
}
