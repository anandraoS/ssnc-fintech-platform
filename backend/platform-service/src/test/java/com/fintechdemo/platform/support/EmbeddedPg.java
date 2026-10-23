package com.fintechdemo.platform.support;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import java.io.IOException;
import org.springframework.test.context.DynamicPropertyRegistry;

/**
 * One real PostgreSQL server (native binaries, no Docker) shared by the *PostgresIT classes of a test JVM. Each class gets
 * the same server but Flyway has already migrated it once; tests create their own data, exactly like the H2 variants.
 */
public final class EmbeddedPg {

    private static EmbeddedPostgres instance;

    private EmbeddedPg() {
    }

    public static synchronized EmbeddedPostgres get() {
        if (instance == null) {
            try {
                instance = EmbeddedPostgres.builder().setPGStartupWait(java.time.Duration.ofSeconds(120)).start();
                Runtime.getRuntime().addShutdownHook(new Thread(() -> {
                    try {
                        instance.close();
                    } catch (IOException ignored) {
                        // best effort at JVM shutdown
                    }
                }));
            } catch (IOException e) {
                throw new IllegalStateException("could not start embedded PostgreSQL", e);
            }
        }
        return instance;
    }

    public static void register(DynamicPropertyRegistry registry) {
        EmbeddedPostgres pg = get();
        registry.add("spring.datasource.url", () -> pg.getJdbcUrl("postgres", "postgres"));
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "");
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
    }
}
