package com.fintechdemo.platform.clearing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fintechdemo.platform.security.TokenBucketRateLimiter;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class RetryAndRateLimitTest {

    private static final class Transient extends RuntimeException {
    }

    @Test
    @DisplayName("retries only retryable failures and stops at maxAttempts")
    void retriesThenGivesUp() {
        AtomicInteger calls = new AtomicInteger();
        List<Duration> sleeps = new ArrayList<>();
        RetryExecutor retry = new RetryExecutor(4, Duration.ofMillis(100), Duration.ofSeconds(1), new Random(1), sleeps::add);
        assertThatThrownBy(() -> retry.execute(() -> {
            calls.incrementAndGet();
            throw new Transient();
        }, t -> t instanceof Transient)).isInstanceOf(Transient.class);
        assertThat(calls).hasValue(4);
        assertThat(sleeps).hasSize(3); // no sleep after the last attempt
    }

    @Test
    void successOnALaterAttemptIsReturned() {
        AtomicInteger calls = new AtomicInteger();
        RetryExecutor retry = new RetryExecutor(3, Duration.ofMillis(1), Duration.ofMillis(5), new Random(1), d -> { });
        String result = retry.execute(() -> {
            if (calls.incrementAndGet() < 3) {
                throw new Transient();
            }
            return "ok";
        }, t -> true);
        assertThat(result).isEqualTo("ok");
        assertThat(calls).hasValue(3);
    }

    @Test
    @DisplayName("a non-retryable failure is thrown immediately (no retry of non-idempotent / permanent errors)")
    void nonRetryableFailsFast() {
        AtomicInteger calls = new AtomicInteger();
        RetryExecutor retry = new RetryExecutor(5, Duration.ofMillis(1), Duration.ofMillis(5), new Random(1), d -> { });
        assertThatThrownBy(() -> retry.execute(() -> {
            calls.incrementAndGet();
            throw new IllegalArgumentException("permanent");
        }, t -> t instanceof Transient)).isInstanceOf(IllegalArgumentException.class);
        assertThat(calls).hasValue(1);
    }

    @Test
    @DisplayName("backoff is exponential, capped, and fully jittered (0..cap)")
    void backoffShape() {
        RetryExecutor retry = new RetryExecutor(10, Duration.ofMillis(100), Duration.ofMillis(1000), new Random(7), d -> { });
        for (int attempt = 1; attempt <= 8; attempt++) {
            long cap = Math.min(1000, 100L << (attempt - 1));
            for (int i = 0; i < 200; i++) {
                assertThat(retry.delayFor(attempt).toMillis()).isBetween(0L, cap);
            }
        }
        // jitter really spreads the delays: not all equal
        assertThat(java.util.stream.IntStream.range(0, 50).mapToObj(i -> retry.delayFor(5).toMillis()).distinct().count())
                .isGreaterThan(10);
    }

    @Test
    void rejectsInvalidConfiguration() {
        assertThatThrownBy(() -> new RetryExecutor(0, Duration.ZERO, Duration.ZERO, new Random(), d -> { }))
                .isInstanceOf(IllegalArgumentException.class);
    }

    // ------------------------------------------------------------------ rate limiter

    @Test
    @DisplayName("token bucket: burst up to capacity, then throttled, then refills over time")
    void tokenBucket() {
        AtomicLong nanos = new AtomicLong();
        TokenBucketRateLimiter limiter = new TokenBucketRateLimiter(nanos::get);
        for (int i = 0; i < 3; i++) {
            assertThat(limiter.tryAcquire("k", 3, 60).allowed()).isTrue();
        }
        TokenBucketRateLimiter.Decision denied = limiter.tryAcquire("k", 3, 60);
        assertThat(denied.allowed()).isFalse();
        assertThat(denied.retryAfterSeconds()).isEqualTo(1); // 60/min = 1 per second
        nanos.addAndGet(1_000_000_000L);
        assertThat(limiter.tryAcquire("k", 3, 60).allowed()).isTrue();
        assertThat(limiter.tryAcquire("k", 3, 60).allowed()).isFalse();
    }

    @Test
    void bucketsAreIndependentPerKeyAndNeverExceedCapacity() {
        AtomicLong nanos = new AtomicLong();
        TokenBucketRateLimiter limiter = new TokenBucketRateLimiter(nanos::get);
        assertThat(limiter.tryAcquire("a", 1, 60).allowed()).isTrue();
        assertThat(limiter.tryAcquire("a", 1, 60).allowed()).isFalse();
        assertThat(limiter.tryAcquire("b", 1, 60).allowed()).isTrue();
        nanos.addAndGet(3_600_000_000_000L); // an hour idle must not bank more than `capacity` tokens
        assertThat(limiter.tryAcquire("a", 1, 60).allowed()).isTrue();
        assertThat(limiter.tryAcquire("a", 1, 60).allowed()).isFalse();
    }
}
