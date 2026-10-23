package com.fintechdemo.platform.security;

import java.util.concurrent.ConcurrentHashMap;
import java.util.function.LongSupplier;

/**
 * In-memory token bucket (per key). Good enough for one instance and for demonstrating the control; with several
 * replicas each instance would enforce its own limit, so production would back this with a shared store (Redis) or an
 * API gateway - see docs/security/threat-model.md.
 */
public class TokenBucketRateLimiter {

    public record Decision(boolean allowed, long retryAfterSeconds) {
    }

    private static final class Bucket {
        double tokens;
        long lastNanos;

        Bucket(double tokens, long lastNanos) {
            this.tokens = tokens;
            this.lastNanos = lastNanos;
        }
    }

    private static final int CLEANUP_THRESHOLD = 50_000;

    private final ConcurrentHashMap<String, Bucket> buckets = new ConcurrentHashMap<>();
    private final LongSupplier nanoClock;

    public TokenBucketRateLimiter() {
        this(System::nanoTime);
    }

    public TokenBucketRateLimiter(LongSupplier nanoClock) {
        this.nanoClock = nanoClock;
    }

    public Decision tryAcquire(String key, int capacity, int refillPerMinute) {
        long now = nanoClock.getAsLong();
        if (buckets.size() > CLEANUP_THRESHOLD) {
            buckets.clear(); // crude memory guard against key-flooding; a real limiter would evict idle keys
        }
        Bucket bucket = buckets.computeIfAbsent(key, k -> new Bucket(capacity, now));
        synchronized (bucket) {
            double refillPerNano = refillPerMinute / 60.0 / 1_000_000_000.0;
            bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.lastNanos) * refillPerNano);
            bucket.lastNanos = now;
            if (bucket.tokens >= 1.0) {
                bucket.tokens -= 1.0;
                return new Decision(true, 0);
            }
            double missing = 1.0 - bucket.tokens;
            long seconds = (long) Math.ceil(missing / (refillPerMinute / 60.0));
            return new Decision(false, Math.max(1, seconds));
        }
    }
}
