package com.fintechdemo.platform.security;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.security")
public record SecurityProperties(
        String rolesClaim,
        String customerClaim,
        String corsAllowedOrigins,
        RateLimit rateLimit,
        LocalIssuer localIssuer) {

    public record RateLimit(boolean enabled, int apiCapacity, int apiRefillPerMinute, int authCapacity,
                            int authRefillPerMinute) {
    }

    public record LocalIssuer(boolean enabled, String hmacSecret, String demoPassword, Duration tokenTtl) {
    }
}
