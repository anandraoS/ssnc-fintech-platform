package com.fintechdemo.platform.transaction;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.processing")
public record ProcessingProperties(
        boolean dispatcherEnabled,
        Duration dispatcherDelay,
        int batchSize,
        int maxAttempts,
        Duration backoffBase,
        Duration stuckAfter,
        boolean reconcilerEnabled,
        Duration reconcilerDelay,
        Duration reconcileGrace,
        Duration maintenanceDelay) {
}
