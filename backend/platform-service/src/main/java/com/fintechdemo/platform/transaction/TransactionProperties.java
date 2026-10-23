package com.fintechdemo.platform.transaction;

import java.math.BigDecimal;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.transaction")
public record TransactionProperties(BigDecimal maxAmount, BigDecimal reviewThreshold, Duration idempotencyRetention) {
}
