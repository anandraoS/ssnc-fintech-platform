package com.fintechdemo.platform.clearing;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.clearing")
public record ClearingProperties(
        String baseUrl,
        Duration connectTimeout,
        Duration readTimeout,
        int maxAttempts,
        Duration retryBaseDelay,
        Duration retryMaxDelay,
        int circuitFailureRate,
        int circuitMinimumCalls,
        int circuitWindow,
        Duration circuitOpenDuration) {

    public boolean configured() {
        return baseUrl != null && !baseUrl.isBlank();
    }
}
