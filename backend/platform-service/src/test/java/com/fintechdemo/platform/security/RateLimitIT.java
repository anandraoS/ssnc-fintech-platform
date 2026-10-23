package com.fintechdemo.platform.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.fintechdemo.platform.support.AbstractIntegrationTest;
import java.util.Map;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.context.TestPropertySource;

/** Separate Spring context (different properties) so the tiny limits here cannot affect other tests. */
@TestPropertySource(properties = {
        "app.security.rate-limit.auth-capacity=3",
        "app.security.rate-limit.auth-refill-per-minute=1",
        "app.security.rate-limit.api-capacity=5",
        "app.security.rate-limit.api-refill-per-minute=1"})
class RateLimitIT extends AbstractIntegrationTest {

    @Test
    @DisplayName("repeated login attempts from one address are throttled (credential-stuffing control)")
    void loginIsThrottled() throws Exception {
        int throttled = 0;
        for (int i = 0; i < 8; i++) {
            Reply r = post("/api/v1/auth/token", null, Map.of("username", "alice.customer", "password", "guess-" + i));
            if (r.status() == 429) {
                throttled++;
                assertThat(r.text("code")).isEqualTo("RATE_LIMITED");
                assertThat(r.raw().getHeader("Retry-After")).isNotBlank();
            } else {
                assertThat(r.status()).isEqualTo(401);
            }
        }
        assertThat(throttled).isGreaterThanOrEqualTo(4);
    }

    @Test
    @DisplayName("an authenticated caller is throttled per subject; other subjects are unaffected")
    void apiIsThrottledPerSubject() throws Exception {
        String noisy = token("noisy.user", Role.ADMIN, null);
        int throttled = 0;
        for (int i = 0; i < 9; i++) {
            if (get("/api/v1/me", noisy).status() == 429) {
                throttled++;
            }
        }
        assertThat(throttled).isGreaterThanOrEqualTo(3);
        assertThat(get("/api/v1/me", token("quiet.user", Role.ADMIN, null)).status()).isEqualTo(200);
    }
}
