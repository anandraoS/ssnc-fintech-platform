package com.fintechdemo.platform.transaction;

import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * The same concurrency scenarios against a REAL PostgreSQL started with Testcontainers (row locks, MVCC, partial indexes from the PostgreSQL-only
 * migration). Skipped automatically when no Docker daemon is available ({@code disabledWithoutDocker}); in CI this
 * runs on GitHub-hosted runners, which provide Docker.
 */
@Testcontainers(disabledWithoutDocker = true)
class TestcontainersPostgresConcurrencyIT extends ConcurrencyScenarios {

    @Container
    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16.4-alpine");

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", POSTGRES::getUsername);
        registry.add("spring.datasource.password", POSTGRES::getPassword);
        registry.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
    }
}
