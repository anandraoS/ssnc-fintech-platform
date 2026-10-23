package com.fintechdemo.platform.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import com.fintechdemo.platform.account.AccountStatus;
import com.fintechdemo.platform.customer.CustomerStatus;
import com.fintechdemo.platform.transaction.TransactionValidator.AccountSnapshot;
import com.fintechdemo.platform.transaction.TransactionValidator.Context;
import com.fintechdemo.platform.transaction.TransactionValidator.Outcome;
import com.fintechdemo.platform.transaction.TransactionValidator.Result;
import com.fintechdemo.platform.transaction.TransactionValidator.Violation;
import java.math.BigDecimal;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class TransactionValidatorTest {

    private final TransactionValidator validator = new TransactionValidator();
    private static final BigDecimal MAX = new BigDecimal("1000000");
    private static final BigDecimal REVIEW = new BigDecimal("50000");

    private static BigDecimal d(String v) {
        return new BigDecimal(v);
    }

    private static AccountSnapshot account(String currency, String available) {
        return new AccountSnapshot(UUID.randomUUID(), AccountStatus.ACTIVE, CustomerStatus.ACTIVE, currency, d(available), d("10000"));
    }

    private static AccountSnapshot with(AccountSnapshot a, AccountStatus status, CustomerStatus owner) {
        return new AccountSnapshot(a.id(), status, owner, a.currency(), a.availableBalance(), a.dailyWithdrawalLimit());
    }

    private Result withdraw(AccountSnapshot source, String amount, String currency, String withdrawnToday) {
        return validator.validate(new Context(TransactionType.WITHDRAWAL, d(amount), currency, source, null, d(withdrawnToday), MAX, REVIEW));
    }

    private static java.util.List<String> codes(Result r) {
        return r.violations().stream().map(Violation::code).toList();
    }

    @Test
    @DisplayName("a valid withdrawal is accepted")
    void validWithdrawal() {
        Result r = withdraw(account("USD", "500.00"), "250.00", "USD", "0");
        assertThat(r.outcome()).isEqualTo(Outcome.ACCEPT);
        assertThat(r.violations()).isEmpty();
    }

    @Test
    @DisplayName("withdrawing exactly the available balance is allowed, one cent more is not")
    void availableBalanceBoundary() {
        assertThat(withdraw(account("USD", "100.00"), "100.00", "USD", "0").outcome()).isEqualTo(Outcome.ACCEPT);
        Result r = withdraw(account("USD", "100.00"), "100.01", "USD", "0");
        assertThat(r.outcome()).isEqualTo(Outcome.REJECT);
        assertThat(codes(r)).containsExactly("INSUFFICIENT_FUNDS");
    }

    @Test
    void currencyMustMatchTheAccount() {
        assertThat(codes(withdraw(account("USD", "500.00"), "10.00", "EUR", "0"))).contains("CURRENCY_MISMATCH");
    }

    @Test
    void inactiveAccountOrCustomerIsRejected() {
        AccountSnapshot suspended = with(account("USD", "500.00"), AccountStatus.SUSPENDED, CustomerStatus.ACTIVE);
        assertThat(codes(withdraw(suspended, "10.00", "USD", "0"))).containsExactly("SOURCE_ACCOUNT_NOT_ACTIVE");
        AccountSnapshot ownerSuspended = with(account("USD", "500.00"), AccountStatus.ACTIVE, CustomerStatus.SUSPENDED);
        assertThat(codes(withdraw(ownerSuspended, "10.00", "USD", "0"))).containsExactly("CUSTOMER_NOT_ACTIVE");
    }

    @Test
    void amountRules() {
        AccountSnapshot a = account("USD", "500.00");
        assertThat(codes(withdraw(a, "0", "USD", "0"))).contains("AMOUNT_NOT_POSITIVE");
        assertThat(codes(withdraw(a, "-5.00", "USD", "0"))).contains("AMOUNT_NOT_POSITIVE");
        assertThat(codes(withdraw(a, "1.234", "USD", "0"))).contains("AMOUNT_PRECISION");
        assertThat(codes(withdraw(account("USD", "9999999"), "1000000.01", "USD", "0"))).contains("AMOUNT_EXCEEDS_MAXIMUM");
        assertThat(codes(withdraw(a, "10.00", "XXX", "0"))).contains("UNSUPPORTED_CURRENCY");
    }

    @Test
    @DisplayName("daily limit counts earlier withdrawals (feature built test-first)")
    void dailyLimit() {
        AccountSnapshot a = new AccountSnapshot(UUID.randomUUID(), AccountStatus.ACTIVE, CustomerStatus.ACTIVE, "USD",
                d("5000.00"), d("100.00"));
        assertThat(withdraw(a, "60.00", "USD", "40.00").outcome()).isEqualTo(Outcome.ACCEPT);
        assertThat(codes(withdraw(a, "60.01", "USD", "40.00"))).containsExactly("DAILY_LIMIT_EXCEEDED");
    }

    @Test
    @DisplayName("an amount at the review threshold needs independent approval")
    void reviewThreshold() {
        AccountSnapshot rich = account("USD", "900000.00");
        Result below = validator.validate(new Context(TransactionType.DEPOSIT, d("49999.99"), "USD", null, rich, BigDecimal.ZERO, MAX, REVIEW));
        assertThat(below.outcome()).isEqualTo(Outcome.ACCEPT);
        Result r = validator.validate(new Context(TransactionType.DEPOSIT, d("50000.00"), "USD", null, rich, BigDecimal.ZERO, MAX, REVIEW));
        assertThat(r.outcome()).isEqualTo(Outcome.REVIEW);
        assertThat(r.primaryCode()).isEqualTo("REVIEW_REQUIRED");
    }

    @Test
    void depositOnlyChecksTheTarget() {
        AccountSnapshot target = with(account("USD", "0.00"), AccountStatus.PENDING_ACTIVATION, CustomerStatus.ACTIVE);
        Result r = validator.validate(new Context(TransactionType.DEPOSIT, d("5.00"), "USD", null, target, BigDecimal.ZERO, MAX, REVIEW));
        assertThat(codes(r)).containsExactly("TARGET_ACCOUNT_NOT_ACTIVE");
    }

    @Test
    void transferChecksBothSidesAndDistinctness() {
        AccountSnapshot a = account("USD", "100.00");
        AccountSnapshot eur = account("EUR", "0.00");
        Result mixed = validator.validate(new Context(TransactionType.TRANSFER, d("10.00"), "USD", a, eur, BigDecimal.ZERO, MAX, REVIEW));
        assertThat(codes(mixed)).containsExactly("CURRENCY_MISMATCH");
        Result same = validator.validate(new Context(TransactionType.TRANSFER, d("10.00"), "USD", a, a, BigDecimal.ZERO, MAX, REVIEW));
        assertThat(codes(same)).contains("SAME_ACCOUNT_TRANSFER");
        Result insufficient = validator.validate(new Context(TransactionType.TRANSFER, d("100.01"), "USD", a, account("USD", "0"), BigDecimal.ZERO, MAX, REVIEW));
        assertThat(codes(insufficient)).containsExactly("INSUFFICIENT_FUNDS");
    }

    @Test
    void severalViolationsAreAllReportedWithTheFirstAsPrimary() {
        AccountSnapshot a = with(account("USD", "5.00"), AccountStatus.SUSPENDED, CustomerStatus.ACTIVE);
        Result r = withdraw(a, "50.00", "EUR", "0");
        assertThat(codes(r)).contains("SOURCE_ACCOUNT_NOT_ACTIVE", "CURRENCY_MISMATCH", "INSUFFICIENT_FUNDS");
        assertThat(r.primaryCode()).isEqualTo("SOURCE_ACCOUNT_NOT_ACTIVE");
        assertThat(r.describe()).contains("CURRENCY_MISMATCH");
    }
}
