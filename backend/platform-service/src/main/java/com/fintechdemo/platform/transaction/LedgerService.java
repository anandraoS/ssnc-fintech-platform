package com.fintechdemo.platform.transaction;

import com.fintechdemo.platform.account.Account;
import com.fintechdemo.platform.account.AccountRepository;
import com.fintechdemo.platform.account.AccountStatus;
import com.fintechdemo.platform.common.ApiException;
import com.fintechdemo.platform.transaction.SupportRepositories.LedgerRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * The only code that changes account balances. Every method requires an ACTIVE database transaction (MANDATORY) -
 * balance changes and their ledger entries therefore commit or roll back together - and takes row locks
 * (SELECT ... FOR UPDATE) before reading balances, so concurrent requests serialize per account.
 * <p>
 * Deadlock avoidance: when two accounts are involved they are locked in ascending-id order, so a transfer A->B and a
 * transfer B->A can never each hold the lock the other one waits for. (Any total order works, so the SIGNED ordering of
 * {@link UUID#compareTo} is fine - what matters is that every code path uses the same one.)
 */
@Service
public class LedgerService {

    /** Statuses whose withdrawals still count against the rolling daily limit. */
    static final Set<TransactionStatus> LIMIT_COUNTING = Set.of(TransactionStatus.PROCESSING, TransactionStatus.COMPLETED,
            TransactionStatus.RECONCILIATION_REQUIRED);

    private final AccountRepository accounts;
    private final LedgerRepository ledger;
    private final TransactionRepository transactions;
    private final Clock clock;

    public LedgerService(AccountRepository accounts, LedgerRepository ledger, TransactionRepository transactions, Clock clock) {
        this.accounts = accounts;
        this.ledger = ledger;
        this.transactions = transactions;
        this.clock = clock;
    }

    /** Deposit: credit the target. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void applyDeposit(FinancialTransaction tx) {
        Account target = lock(tx.getTargetAccountId());
        requireActive(target, "TARGET_ACCOUNT_NOT_ACTIVE");
        credit(tx, target, LedgerEntry.Type.CREDIT);
    }

    /** Transfer: debit source and credit target in ONE database transaction - both happen or neither does. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void applyTransfer(FinancialTransaction tx) {
        UUID first = tx.getSourceAccountId().compareTo(tx.getTargetAccountId()) < 0 ? tx.getSourceAccountId() : tx.getTargetAccountId();
        UUID second = first.equals(tx.getSourceAccountId()) ? tx.getTargetAccountId() : tx.getSourceAccountId();
        Account a = lock(first);
        Account b = lock(second);
        Account source = a.getId().equals(tx.getSourceAccountId()) ? a : b;
        Account target = source == a ? b : a;
        // all checks happen BEFORE any mutation so a business failure leaves nothing half-applied
        requireActive(source, "SOURCE_ACCOUNT_NOT_ACTIVE");
        requireActive(target, "TARGET_ACCOUNT_NOT_ACTIVE");
        requireFunds(source, tx.getAmount());
        debit(tx, source);
        credit(tx, target, LedgerEntry.Type.CREDIT);
    }

    /**
     * Withdrawal step 1: reserve (debit) the funds immediately so they cannot be spent twice while the external
     * clearing call is in flight. Enforces the authoritative daily limit under the account lock.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void reserveWithdrawal(FinancialTransaction tx) {
        Account source = lock(tx.getSourceAccountId());
        requireActive(source, "SOURCE_ACCOUNT_NOT_ACTIVE");
        requireFunds(source, tx.getAmount());
        Instant now = Instant.now(clock);
        BigDecimal withdrawn = transactions.sumWithdrawnSince(source.getId(), now.minus(Duration.ofHours(24)),
                LIMIT_COUNTING, tx.getId());
        if (DailyLimitPolicy.wouldExceed(source.getDailyWithdrawalLimit(), withdrawn, tx.getAmount())) {
            throw ApiException.unprocessable("DAILY_LIMIT_EXCEEDED", "The daily withdrawal limit would be exceeded");
        }
        debit(tx, source);
        tx.markFundsReserved(true);
    }

    /** Compensation: give reserved funds back. Idempotent - a second call is a no-op (and the UNIQUE constraint backs it). */
    @Transactional(propagation = Propagation.MANDATORY)
    public void reverseWithdrawal(FinancialTransaction tx) {
        if (!tx.isFundsReserved()) {
            return;
        }
        Account source = lock(tx.getSourceAccountId());
        if (ledger.existsByTransactionIdAndAccountIdAndEntryType(tx.getId(), source.getId(), LedgerEntry.Type.REVERSAL_CREDIT)) {
            tx.markFundsReserved(false);
            return;
        }
        credit(tx, source, LedgerEntry.Type.REVERSAL_CREDIT);
        tx.markFundsReserved(false);
    }

    private Account lock(UUID accountId) {
        return accounts.lockById(accountId)
                .orElseThrow(() -> ApiException.notFound("ACCOUNT_NOT_FOUND", "Account not found"));
    }

    private void requireActive(Account account, String code) {
        if (account.getStatus() != AccountStatus.ACTIVE) {
            throw ApiException.unprocessable(code, "Account is " + account.getStatus());
        }
    }

    private void requireFunds(Account source, BigDecimal amount) {
        if (source.getBalance().subtract(amount).compareTo(source.getMinimumBalance()) < 0) {
            throw ApiException.unprocessable("INSUFFICIENT_FUNDS", "Available balance is insufficient");
        }
    }

    private void debit(FinancialTransaction tx, Account account) {
        Instant now = Instant.now(clock);
        account.debit(tx.getAmount(), now);
        ledger.save(new LedgerEntry(tx.getId(), account.getId(), LedgerEntry.Type.DEBIT, tx.getAmount(), account.getBalance(), now));
        accounts.save(account);
    }

    private void credit(FinancialTransaction tx, Account account, LedgerEntry.Type type) {
        Instant now = Instant.now(clock);
        account.credit(tx.getAmount(), now);
        ledger.save(new LedgerEntry(tx.getId(), account.getId(), type, tx.getAmount(), account.getBalance(), now));
        accounts.save(account);
    }
}
