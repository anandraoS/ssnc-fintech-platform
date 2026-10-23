package com.fintechdemo.platform.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import com.fintechdemo.platform.support.AbstractIntegrationTest;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * Race-condition scenarios shared by the H2 run (ConcurrencyIT) and the PostgreSQL Testcontainers run
 * (PostgresConcurrencyIT). Transactions are submitted (and therefore VALIDATED against the same advisory balance)
 * first, then PROCESSED CONCURRENTLY: the authoritative checks under row locks decide the winners.
 */
@Timeout(value = 180, unit = TimeUnit.SECONDS)
abstract class ConcurrencyScenarios extends AbstractIntegrationTest {

    @Autowired TransactionProcessor processor;
    @Autowired TransactionRepository transactions;

    private void runConcurrently(List<UUID> ids) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(ids.size()); // one thread per task so all start together
        CountDownLatch ready = new CountDownLatch(ids.size());
        CountDownLatch go = new CountDownLatch(1);
        List<Future<?>> futures = new ArrayList<>();
        for (UUID id : ids) {
            futures.add(pool.submit(() -> {
                ready.countDown();
                go.await();
                processor.process(id);
                return null;
            }));
        }
        ready.await();
        go.countDown();
        for (Future<?> f : futures) {
            f.get(60, TimeUnit.SECONDS); // any exception (deadlock victim, lock timeout) fails the test
        }
        pool.shutdown();
    }

    private long countStatus(List<UUID> ids, TransactionStatus status) {
        return ids.stream().filter(id -> transactions.findById(id).orElseThrow().getStatus() == status).count();
    }

    @Test
    @DisplayName("Scenario: concurrent withdrawals can never overspend the account")
    void concurrentWithdrawalsNeverOverspend() throws Exception {
        UUID account = fundedAccount(ALICE, "USD", "100.00");
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 20; i++) { // 20 x 10.00 against a balance of 100.00: all pass the advisory check
            Reply r = submit(admin(), "WITHDRAWAL", account, null, "10.00", "USD");
            assertThat(r.status()).isEqualTo(202);
            ids.add(UUID.fromString(r.text("id")));
        }
        runConcurrently(ids);
        assertThat(countStatus(ids, TransactionStatus.COMPLETED)).isEqualTo(10);
        assertThat(countStatus(ids, TransactionStatus.FAILED)).isEqualTo(10);
        for (UUID id : ids) {
            var tx = transactions.findById(id).orElseThrow();
            if (tx.getStatus() == TransactionStatus.FAILED) {
                assertThat(tx.getFailureCode()).isEqualTo("INSUFFICIENT_FUNDS");
            }
        }
        assertThat(balance(account)).isEqualTo("0.00");
        assertLedgerIntegrity();
    }

    @Test
    @DisplayName("Scenario: concurrent withdrawals respect the daily limit under contention")
    void concurrentWithdrawalsRespectDailyLimit() throws Exception {
        Reply opened = post("/api/v1/customers/" + ALICE + "/accounts", admin(),
                java.util.Map.of("accountType", "BROKERAGE", "currency", "USD", "dailyWithdrawalLimit", "100.00"));
        UUID account = UUID.fromString(opened.text("id"));
        post("/api/v1/accounts/" + account + "/activate", admin(), "{}");
        submit(admin(), "DEPOSIT", null, account, "5000.00", "USD");
        drain();
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 8; i++) { // 8 x 40.00 = 320 > limit 100 => at most 2 can complete (80.00)
            Reply r = submit(admin(), "WITHDRAWAL", account, null, "40.00", "USD");
            assertThat(r.status()).isEqualTo(202);
            ids.add(UUID.fromString(r.text("id")));
        }
        runConcurrently(ids);
        assertThat(countStatus(ids, TransactionStatus.COMPLETED)).isEqualTo(2);
        assertThat(balance(account)).isEqualTo("4920.00");
        assertLedgerIntegrity();
    }

    @Test
    @DisplayName("Scenario: opposite-direction transfers between the same two accounts never deadlock and conserve money")
    void oppositeTransfersDoNotDeadlock() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "1000.00");
        UUID b = fundedAccount(ALICE, "USD", "1000.00");
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            Reply ab = submit(alice(), "TRANSFER", a, b, "7.00", "USD");
            Reply ba = submit(alice(), "TRANSFER", b, a, "3.00", "USD");
            ids.add(UUID.fromString(ab.text("id")));
            ids.add(UUID.fromString(ba.text("id")));
        }
        runConcurrently(ids);
        assertThat(countStatus(ids, TransactionStatus.COMPLETED)).isEqualTo(24);
        // a lost 12*7 = 84 out, 12*3 = 36 in => 952.00 ; b => 1048.00 ; total conserved
        assertThat(balance(a)).isEqualTo("952.00");
        assertThat(balance(b)).isEqualTo("1048.00");
        assertThat(new BigDecimal(balance(a)).add(new BigDecimal(balance(b)))).isEqualByComparingTo("2000.00");
        assertLedgerIntegrity();
    }

    @Test
    @DisplayName("Scenario: concurrent deposits are all applied (no lost updates)")
    void concurrentDepositsAreNotLost() throws Exception {
        UUID account = fundedAccount(ALICE, "USD", "0.00");
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < 30; i++) {
            ids.add(UUID.fromString(submit(admin(), "DEPOSIT", null, account, "1.50", "USD").text("id")));
        }
        runConcurrently(ids);
        assertThat(countStatus(ids, TransactionStatus.COMPLETED)).isEqualTo(30);
        assertThat(balance(account)).isEqualTo("45.00");
        assertLedgerIntegrity();
    }

    @Test
    @DisplayName("Scenario: delivering the same event twice processes the transaction once")
    void duplicateDeliveryIsHarmless() throws Exception {
        UUID account = fundedAccount(ALICE, "USD", "100.00");
        UUID id = UUID.fromString(submit(alice(), "WITHDRAWAL", account, null, "30.00", "USD").text("id"));
        processor.process(id);
        processor.process(id); // at-least-once delivery: the second call must be a no-op
        assertThat(transactions.findById(id).orElseThrow().getStatus()).isEqualTo(TransactionStatus.COMPLETED);
        assertThat(balance(account)).isEqualTo("70.00");
        assertThat(clearing.calls()).isGreaterThanOrEqualTo(1);
    }
}
