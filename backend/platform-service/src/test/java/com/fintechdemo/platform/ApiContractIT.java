package com.fintechdemo.platform;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fintechdemo.platform.support.AbstractIntegrationTest;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.TreeSet;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/**
 * API contract checks: (1) the committed OpenAPI document (specs/openapi.json) matches what the running application
 * actually exposes - regenerate with -Dopenapi.update=true; (2) every error path returns the standard envelope.
 */
class ApiContractIT extends AbstractIntegrationTest {

    private static final Path SPEC = Path.of("..", "..", "specs", "openapi.json");

    private TreeSet<String> operations(JsonNode doc) {
        TreeSet<String> ops = new TreeSet<>();
        doc.path("paths").fields().forEachRemaining(path -> path.getValue().fieldNames().forEachRemaining(
                method -> ops.add(method.toUpperCase() + " " + path.getKey())));
        return ops;
    }

    @Test
    @DisplayName("the committed OpenAPI contract matches the running application")
    void committedSpecMatchesRuntime() throws Exception {
        Reply live = get("/v3/api-docs", null);
        assertThat(live.status()).isEqualTo(200);
        if (Boolean.getBoolean("openapi.update")) {
            Files.createDirectories(SPEC.getParent());
            Files.writeString(SPEC, json.writerWithDefaultPrettyPrinter().writeValueAsString(live.body()) + "\n");
        }
        assertThat(SPEC).as("run with -Dopenapi.update=true to (re)generate specs/openapi.json").exists();
        JsonNode committed = json.readTree(Files.readString(SPEC));
        assertThat(operations(live.body())).isEqualTo(operations(committed));
        assertThat(live.body().path("components").path("schemas").fieldNames())
                .toIterable().containsExactlyInAnyOrderElementsOf(() -> committed.path("components").path("schemas").fieldNames());
        assertThat(live.body().path("info").path("version").asText()).isEqualTo(committed.path("info").path("version").asText());
    }

    @Test
    @DisplayName("the contract documents the endpoints the platform promises")
    void contractCoversRequiredCapabilities() throws Exception {
        TreeSet<String> ops = operations(get("/v3/api-docs", null).body());
        assertThat(ops).contains("POST /api/v1/customers", "GET /api/v1/customers/{id}", "POST /api/v1/customers/{customerId}/accounts",
                "GET /api/v1/accounts", "GET /api/v1/accounts/{id}/balance", "POST /api/v1/transactions",
                "GET /api/v1/transactions/{id}", "GET /api/v1/transactions", "GET /api/v1/accounts/{accountId}/transactions",
                "POST /api/v1/transactions/{id}/cancel", "GET /api/v1/ops/summary", "GET /api/v1/ops/health",
                "GET /api/v1/ops/audit-events", "POST /api/v1/ops/reconciliations/{id}/resolve", "POST /api/v1/ops/processing/drain");
        JsonNode submit = get("/v3/api-docs", null).body().path("paths").path("/api/v1/transactions").path("post");
        assertThat(submit.path("parameters").toString()).contains("Idempotency-Key");
    }

    @Test
    @DisplayName("validation failures use the standard envelope with per-field violations")
    void validationEnvelope() throws Exception {
        Reply r = post("/api/v1/customers", admin(), Map.of("legalName", "", "email", "not-an-email", "taxIdLast4", "12"));
        assertThat(r.status()).isEqualTo(400);
        assertThat(r.text("code")).isEqualTo("VALIDATION_ERROR");
        assertThat(r.body().path("violations").size()).isGreaterThanOrEqualTo(3);
        assertThat(r.body().path("correlationId").asText()).isNotBlank();
        assertThat(r.body().path("timestamp").asText()).isNotBlank();
        assertThat(r.body().path("path").asText()).isEqualTo("/api/v1/customers");
    }

    @Test
    @DisplayName("conflict, not-found, method and media-type errors are consistent")
    void errorEnvelopes() throws Exception {
        String email = "dup-" + UUID.randomUUID() + "@example.test";
        assertThat(post("/api/v1/customers", admin(), Map.of("legalName", "Dup", "email", email)).status()).isEqualTo(201);
        Reply dup = post("/api/v1/customers", admin(), Map.of("legalName", "Dup", "email", email.toUpperCase()));
        assertThat(dup.status()).isEqualTo(409);
        assertThat(dup.text("code")).isEqualTo("DUPLICATE_EMAIL");

        assertThat(get("/api/v1/accounts/" + UUID.randomUUID(), admin()).text("code")).isEqualTo("ACCOUNT_NOT_FOUND");
        Reply method = send(MockMvcRequestBuilders.delete("/api/v1/accounts"), admin());
        assertThat(method.status()).isEqualTo(405);
        assertThat(method.text("code")).isEqualTo("METHOD_NOT_ALLOWED");
        Reply media = send(MockMvcRequestBuilders.post("/api/v1/customers").contentType(MediaType.TEXT_PLAIN).content("x"), admin());
        assertThat(media.status()).isEqualTo(415);
        Reply malformed = post("/api/v1/customers", admin(), "{not json");
        assertThat(malformed.status()).isEqualTo(400);
        assertThat(malformed.text("code")).isEqualTo("MALFORMED_REQUEST");
        assertThat(malformed.body().toString()).doesNotContain("not json");
    }

    @Test
    @DisplayName("oversized request bodies are rejected with 413")
    void requestSizeLimit() throws Exception {
        String big = "{\"legalName\":\"" + "x".repeat(70_000) + "\",\"email\":\"big@example.test\"}";
        Reply r = post("/api/v1/customers", admin(), big);
        assertThat(r.status()).isEqualTo(413);
        assertThat(r.text("code")).isEqualTo("PAYLOAD_TOO_LARGE");
    }

    @Test
    @DisplayName("pagination envelope and page-size cap")
    void pagination() throws Exception {
        Reply r = get("/api/v1/customers?size=2&page=0&sort=legalName,asc", support());
        assertThat(r.status()).isEqualTo(200);
        assertThat(r.body().path("items").size()).isEqualTo(2);
        assertThat(r.body().path("size").asInt()).isEqualTo(2);
        assertThat(r.body().path("totalElements").asInt()).isGreaterThanOrEqualTo(5);
        Reply capped = get("/api/v1/customers?size=100000", support());
        assertThat(capped.body().path("size").asInt()).isEqualTo(100);
    }

    @Test
    @DisplayName("monetary values are serialized as strings with the currency's scale")
    void moneyIsAString() throws Exception {
        Reply r = get("/api/v1/accounts/10000000-0000-4000-8000-000000000006", admin());
        assertThat(r.body().path("balance").isTextual()).isTrue();
        assertThat(r.text("balance")).matches("\\d+\\.\\d{2}");
    }

    @Test
    @DisplayName("actuator exposes only health/info/prometheus and Prometheus carries the custom business metrics")
    void actuatorSurface() throws Exception {
        assertThat(send(MockMvcRequestBuilders.get("/actuator/health/liveness"), null).status()).isEqualTo(200);
        assertThat(send(MockMvcRequestBuilders.get("/actuator/health/readiness"), null).status()).isEqualTo(200);
        assertThat(send(MockMvcRequestBuilders.get("/actuator/env"), null).status()).isIn(401, 403, 404);
        assertThat(send(MockMvcRequestBuilders.get("/actuator/heapdump"), null).status()).isIn(401, 403, 404);
        fundedAccount(ALICE, "USD", "5.00");
        String metrics = mvc.perform(MockMvcRequestBuilders.get("/actuator/prometheus")).andReturn().getResponse().getContentAsString();
        assertThat(metrics).contains("platform_transactions_submitted_total", "platform_transactions_finished_total",
                "platform_transactions_end_to_end_seconds", "platform_reconciliation_open", "platform_outbox_backlog",
                "hikaricp_connections_active", "http_server_requests_seconds_bucket", "jvm_memory_used_bytes");
    }
}
