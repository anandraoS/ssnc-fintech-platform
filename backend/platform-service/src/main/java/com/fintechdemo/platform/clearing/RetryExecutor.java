package com.fintechdemo.platform.clearing;

import java.time.Duration;
import java.util.concurrent.Callable;
import java.util.function.Predicate;
import java.util.random.RandomGenerator;

/**
 * Retry with exponential backoff and FULL jitter: delay = random(0, min(maxDelay, base * 2^(attempt-1))).
 * Jitter prevents retry storms in which many clients retry in lock-step against a recovering dependency.
 * Only wrap operations that are idempotent - retrying a non-idempotent call is how money gets sent twice.
 */
public class RetryExecutor {

    /** Seam for tests so no real sleeping happens. */
    @FunctionalInterface
    public interface Sleeper {
        void sleep(Duration duration) throws InterruptedException;
    }

    private final int maxAttempts;
    private final Duration baseDelay;
    private final Duration maxDelay;
    private final RandomGenerator random;
    private final Sleeper sleeper;

    public RetryExecutor(int maxAttempts, Duration baseDelay, Duration maxDelay, RandomGenerator random, Sleeper sleeper) {
        if (maxAttempts < 1) {
            throw new IllegalArgumentException("maxAttempts must be >= 1");
        }
        this.maxAttempts = maxAttempts;
        this.baseDelay = baseDelay;
        this.maxDelay = maxDelay;
        this.random = random;
        this.sleeper = sleeper;
    }

    public <T> T execute(Callable<T> action, Predicate<Throwable> retryable) {
        RuntimeException last = null;
        for (int attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return action.call();
            } catch (Exception e) {
                RuntimeException wrapped = e instanceof RuntimeException re ? re : new IllegalStateException(e);
                if (!retryable.test(e) || attempt == maxAttempts) {
                    throw wrapped;
                }
                last = wrapped;
                pause(delayFor(attempt));
            }
        }
        throw last; // unreachable: the loop either returns or throws
    }

    Duration delayFor(int attempt) {
        long exp = baseDelay.toMillis() * (1L << Math.min(attempt - 1, 20));
        long cap = Math.min(maxDelay.toMillis(), exp);
        return Duration.ofMillis(cap <= 0 ? 0 : random.nextLong(cap + 1));
    }

    private void pause(Duration d) {
        try {
            sleeper.sleep(d);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while backing off", ie);
        }
    }
}
