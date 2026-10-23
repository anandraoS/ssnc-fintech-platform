package com.fintechdemo.platform.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import com.fintechdemo.platform.support.AbstractIntegrationTest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class IdempotencyIT extends AbstractIntegrationTest {

    private Map<String, Object> deposit(UUID target, String amount) {
        return Map.of("type", "DEPOSIT", "targetAccountId", target.toString(), "amount", amount, "currency", "USD");
    }

    @Test
    @DisplayName("Scenario: a duplicate submission returns the original result and creates no second transaction")
    void duplicateSubmissionReplays() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "0.00");
        String key = key();
        Reply first = postWithKey("/api/v1/transactions", alice(), key, deposit(a, "25.00"));
        Reply second = postWithKey("/api/v1/transactions", alice(), key, deposit(a, "25.00"));
        assertThat(first.status()).isEqualTo(202);
        assertThat(second.status()).isEqualTo(202);
        assertThat(second.text("id")).isEqualTo(first.text("id"));
        assertThat(second.raw().getHeader("Idempotent-Replayed")).isEqualTo("true");
        assertThat(first.raw().getHeader("Idempotent-Replayed")).isNull();
        drain();
        drain();
        assertThat(balance(a)).isEqualTo("25.00"); // applied exactly once
        Long rows = jdbc.queryForObject("select count(*) from transactions where target_account_id = ?", Long.class, a);
        assertThat(rows).isEqualTo(1L);
    }

    @Test
    @DisplayName("replay of a rejected submission returns the same rejection")
    void replayOfRejection() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "10.00");
        String key = key();
        Map<String, Object> body = Map.of("type", "WITHDRAWAL", "sourceAccountId", a.toString(), "amount", "999.00", "currency", "USD");
        Reply first = postWithKey("/api/v1/transactions", alice(), key, body);
        Reply second = postWithKey("/api/v1/transactions", alice(), key, body);
        assertThat(first.status()).isEqualTo(422);
        assertThat(second.status()).isEqualTo(422);
        assertThat(second.body().path("details").path("transactionId").asText())
                .isEqualTo(first.body().path("details").path("transactionId").asText());
    }

    @Test
    @DisplayName("the same key with a different payload is refused (422) instead of silently returning stale data")
    void keyReuseWithDifferentPayload() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "0.00");
        String key = key();
        assertThat(postWithKey("/api/v1/transactions", alice(), key, deposit(a, "25.00")).status()).isEqualTo(202);
        Reply other = postWithKey("/api/v1/transactions", alice(), key, deposit(a, "26.00"));
        assertThat(other.status()).isEqualTo(422);
        assertThat(other.text("code")).isEqualTo("IDEMPOTENCY_KEY_REUSED");
    }

    @Test
    @DisplayName("the key is scoped per principal: two users may use the same key independently")
    void keysAreScopedPerPrincipal() throws Exception {
        UUID aliceAccount = fundedAccount(ALICE, "USD", "0.00");
        UUID bobAccount = fundedAccount(BOB, "USD", "0.00");
        String shared = key();
        Reply a = postWithKey("/api/v1/transactions", alice(), shared, deposit(aliceAccount, "5.00"));
        Reply b = postWithKey("/api/v1/transactions", bob(), shared, deposit(bobAccount, "5.00"));
        assertThat(a.status()).isEqualTo(202);
        assertThat(b.status()).isEqualTo(202);
        assertThat(a.text("id")).isNotEqualTo(b.text("id"));
    }

    @Test
    @DisplayName("a missing or malformed Idempotency-Key is rejected with a clear error")
    void keyIsMandatoryAndValidated() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "0.00");
        Reply missing = post("/api/v1/transactions", alice(), deposit(a, "5.00"));
        assertThat(missing.status()).isEqualTo(400);
        assertThat(missing.text("code")).isEqualTo("IDEMPOTENCY_KEY_REQUIRED");
        Reply bad = postWithKey("/api/v1/transactions", alice(), "short", deposit(a, "5.00"));
        assertThat(bad.status()).isEqualTo(400);
        assertThat(bad.text("code")).isEqualTo("IDEMPOTENCY_KEY_INVALID");
    }

    @Test
    @DisplayName("Scenario: concurrent requests with the same key create exactly one transaction")
    void concurrentSameKeyCreatesOneTransaction() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "0.00");
        String key = key();
        String token = alice();
        int threads = 12;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch ready = new CountDownLatch(threads);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<Reply>> futures = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            Callable<Reply> call = () -> {
                ready.countDown();
                go.await();
                return postWithKey("/api/v1/transactions", token, key, deposit(a, "10.00"));
            };
            futures.add(pool.submit(call));
        }
        ready.await();
        go.countDown();
        List<String> ids = new ArrayList<>();
        for (Future<Reply> f : futures) {
            Reply r = f.get();
            assertThat(r.status()).as("every concurrent duplicate gets the same successful answer").isEqualTo(202);
            ids.add(r.text("id"));
        }
        pool.shutdown();
        assertThat(ids).allMatch(id -> id.equals(ids.get(0)));
        Long rows = jdbc.queryForObject("select count(*) from transactions where target_account_id = ?", Long.class, a);
        assertThat(rows).isEqualTo(1L);
        drain();
        assertThat(balance(a)).isEqualTo("10.00");
    }
}
