package com.fintechdemo.platform.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fintechdemo.platform.account.Account;
import com.fintechdemo.platform.account.AccountRepository;
import com.fintechdemo.platform.account.AccountStatus;
import com.fintechdemo.platform.account.AccountType;
import com.fintechdemo.platform.common.ApiException;
import com.fintechdemo.platform.transaction.SupportRepositories.LedgerRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

class LedgerServiceTest {

    private static final Instant NOW = Instant.parse("2026-01-01T00:00:00Z");
    private AccountRepository accounts;
    private LedgerRepository ledger;
    private TransactionRepository transactions;
    private LedgerService service;

    @BeforeEach
    void setUp() {
        accounts = mock(AccountRepository.class);
        ledger = mock(LedgerRepository.class);
        transactions = mock(TransactionRepository.class);
        service = new LedgerService(accounts, ledger, transactions, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private Account account(UUID id, String balance, AccountStatus status) {
        Account a = new Account(id, "ACC-" + id.toString().substring(0, 8), UUID.randomUUID(), AccountType.BROKERAGE, "USD",
                new BigDecimal("100000"), NOW);
        if (status != AccountStatus.PENDING_ACTIVATION) {
            a.transitionTo(AccountStatus.ACTIVE, null, NOW);
            if (status == AccountStatus.SUSPENDED) {
                a.transitionTo(AccountStatus.SUSPENDED, "test", NOW);
            }
        }
        a.credit(new BigDecimal(balance), NOW);
        when(accounts.lockById(id)).thenReturn(Optional.of(a));
        return a;
    }

    private FinancialTransaction tx(TransactionType type, UUID source, UUID target, String amount) {
        return new FinancialTransaction(UUID.randomUUID(), "TXN-1", type, source, target, new BigDecimal(amount), "USD", null, "tester", NOW);
    }

    @Test
    @DisplayName("transfers lock the lower account id first regardless of direction (deadlock avoidance)")
    void locksInAscendingIdOrder() {
        UUID low = UUID.fromString("00000000-0000-4000-8000-000000000001");
        UUID high = UUID.fromString("7fffffff-ffff-4fff-8fff-ffffffffffff");
        account(low, "100.00", AccountStatus.ACTIVE);
        account(high, "100.00", AccountStatus.ACTIVE);

        service.applyTransfer(tx(TransactionType.TRANSFER, high, low, "10.00")); // high -> low
        InOrder first = inOrder(accounts);
        first.verify(accounts).lockById(low);
        first.verify(accounts).lockById(high);

        org.mockito.Mockito.clearInvocations(accounts);
        service.applyTransfer(tx(TransactionType.TRANSFER, low, high, "10.00")); // low -> high
        InOrder second = inOrder(accounts);
        second.verify(accounts).lockById(low);
        second.verify(accounts).lockById(high);
    }

    @Test
    @DisplayName("a transfer debits the source and credits the target by exactly the amount, with two ledger entries")
    void transferMovesMoney() {
        UUID s = UUID.randomUUID();
        UUID t = UUID.randomUUID();
        Account source = account(s, "100.00", AccountStatus.ACTIVE);
        Account target = account(t, "5.00", AccountStatus.ACTIVE);
        service.applyTransfer(tx(TransactionType.TRANSFER, s, t, "40.2500"));
        assertThat(source.getBalance()).isEqualByComparingTo("59.75");
        assertThat(target.getBalance()).isEqualByComparingTo("45.25");
        ArgumentCaptor<LedgerEntry> entries = ArgumentCaptor.forClass(LedgerEntry.class);
        verify(ledger, org.mockito.Mockito.times(2)).save(entries.capture());
        assertThat(entries.getAllValues()).extracting(LedgerEntry::getEntryType)
                .containsExactlyInAnyOrder(LedgerEntry.Type.DEBIT, LedgerEntry.Type.CREDIT);
    }

    @Test
    @DisplayName("business failures are detected BEFORE any balance is touched (nothing half-applied)")
    void checksPrecedeMutation() {
        UUID s = UUID.randomUUID();
        UUID t = UUID.randomUUID();
        Account source = account(s, "10.00", AccountStatus.ACTIVE);
        Account suspendedTarget = account(t, "5.00", AccountStatus.SUSPENDED);
        assertThatThrownBy(() -> service.applyTransfer(tx(TransactionType.TRANSFER, s, t, "5.00")))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getCode()).isEqualTo("TARGET_ACCOUNT_NOT_ACTIVE"));
        assertThat(source.getBalance()).isEqualByComparingTo("10.00");
        assertThat(suspendedTarget.getBalance()).isEqualByComparingTo("5.00");
        verify(ledger, never()).save(any());

        assertThatThrownBy(() -> service.applyTransfer(tx(TransactionType.TRANSFER, s, account(UUID.randomUUID(), "0", AccountStatus.ACTIVE).getId(), "10.01")))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getCode()).isEqualTo("INSUFFICIENT_FUNDS"));
        assertThat(source.getBalance()).isEqualByComparingTo("10.00");
    }

    @Test
    @DisplayName("withdrawal reserves funds, enforces the minimum balance and the daily limit")
    void reserveWithdrawal() {
        UUID s = UUID.randomUUID();
        Account source = account(s, "500.00", AccountStatus.ACTIVE);
        when(transactions.sumWithdrawnSince(eq(s), any(), any(), any())).thenReturn(new BigDecimal("99999.00"));
        FinancialTransaction w = tx(TransactionType.WITHDRAWAL, s, null, "2.00");
        assertThatThrownBy(() -> service.reserveWithdrawal(w))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getCode()).isEqualTo("DAILY_LIMIT_EXCEEDED"));
        assertThat(source.getBalance()).isEqualByComparingTo("500.00");

        when(transactions.sumWithdrawnSince(eq(s), any(), any(), any())).thenReturn(BigDecimal.ZERO);
        service.reserveWithdrawal(w);
        assertThat(source.getBalance()).isEqualByComparingTo("498.00");
        assertThat(w.isFundsReserved()).isTrue();
    }

    @Test
    @DisplayName("reversal returns reserved funds once; a second reversal is a no-op")
    void reversalIsIdempotent() {
        UUID s = UUID.randomUUID();
        Account source = account(s, "500.00", AccountStatus.ACTIVE);
        when(transactions.sumWithdrawnSince(eq(s), any(), any(), any())).thenReturn(BigDecimal.ZERO);
        FinancialTransaction w = tx(TransactionType.WITHDRAWAL, s, null, "100.00");
        service.reserveWithdrawal(w);
        assertThat(source.getBalance()).isEqualByComparingTo("400.00");

        service.reverseWithdrawal(w);
        assertThat(source.getBalance()).isEqualByComparingTo("500.00");
        assertThat(w.isFundsReserved()).isFalse();
        service.reverseWithdrawal(w); // funds_reserved is false now => nothing happens
        assertThat(source.getBalance()).isEqualByComparingTo("500.00");
    }

    @Test
    void reversalWorksEvenIfTheAccountWasSuspendedMeanwhile() {
        UUID s = UUID.randomUUID();
        Account source = account(s, "500.00", AccountStatus.ACTIVE);
        when(transactions.sumWithdrawnSince(eq(s), any(), any(), any())).thenReturn(BigDecimal.ZERO);
        FinancialTransaction w = tx(TransactionType.WITHDRAWAL, s, null, "100.00");
        service.reserveWithdrawal(w);
        source.transitionTo(AccountStatus.SUSPENDED, "compliance hold", NOW);
        service.reverseWithdrawal(w); // customer's money must always be returned
        assertThat(source.getBalance()).isEqualByComparingTo("500.00");
    }
}
