package com.fintechdemo.platform;

import static org.assertj.core.api.Assertions.assertThat;

import com.fintechdemo.platform.support.AbstractIntegrationTest;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Proves the server-error contract with the REAL global exception handler and security chain, using a test-only controller
 * that throws: no stack trace, SQL, class or message of the exception ever reaches the client, only a correlation id.
 */
@Import(ServerErrorIT.Boom.class)
class ServerErrorIT extends AbstractIntegrationTest {

    @TestConfiguration
    @RestController
    static class Boom {
        @GetMapping("/api/v1/test-only/boom")
        String boom() {
            throw new IllegalStateException("secret internal detail: jdbc:postgresql://db.internal:5432/platform password=hunter2");
        }

        @GetMapping("/api/v1/test-only/lock")
        String lock() {
            throw new CannotAcquireLockException("could not obtain lock on row in relation \"accounts\"");
        }

        @GetMapping("/api/v1/test-only/stale")
        String stale() {
            throw new ObjectOptimisticLockingFailureException("Account", "id-1");
        }
    }

    @Test
    @DisplayName("an unexpected exception becomes a generic 500 with a correlation id and no internal detail")
    void unexpectedExceptionIsSanitised() throws Exception {
        Reply r = get("/api/v1/test-only/boom", admin());
        assertThat(r.status()).isEqualTo(500);
        assertThat(r.text("code")).isEqualTo("INTERNAL_ERROR");
        assertThat(r.body().path("correlationId").asText()).isNotBlank();
        String body = r.body().toString();
        assertThat(body).doesNotContain("secret internal detail").doesNotContain("jdbc:").doesNotContain("hunter2")
                .doesNotContain("IllegalState").doesNotContain("at com.");
        Path target = Path.of("target", "server-error-example.json");
        Files.createDirectories(target.getParent());
        Files.writeString(target, json.writerWithDefaultPrettyPrinter().writeValueAsString(r.body()));
    }

    @Test
    @DisplayName("a lock timeout is a retryable 503 with Retry-After, not a 500")
    void lockTimeoutIs503() throws Exception {
        Reply r = get("/api/v1/test-only/lock", admin());
        assertThat(r.status()).isEqualTo(503);
        assertThat(r.text("code")).isEqualTo("LOCK_TIMEOUT");
        assertThat(r.raw().getHeader("Retry-After")).isEqualTo("1");
        assertThat(r.body().toString()).doesNotContain("in relation").doesNotContain("accounts");
    }

    @Test
    @DisplayName("an optimistic-lock conflict is a 409 the client can resolve by re-reading")
    void staleWriteIs409() throws Exception {
        Reply r = get("/api/v1/test-only/stale", admin());
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.text("code")).isEqualTo("CONCURRENT_MODIFICATION");
    }
}
