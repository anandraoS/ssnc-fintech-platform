package com.fintechdemo.platform.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fintechdemo.platform.security.Role;
import com.fintechdemo.platform.transaction.OutboxDispatcher;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.actuate.observability.AutoConfigureObservability;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/**
 * Shared fixtures for integration tests: real Spring context, real H2 database (PostgreSQL mode) with Flyway
 * migrations and synthetic seed data, real JWT validation (tokens are minted with the local issuer's encoder).
 * Each test creates its OWN accounts so tests do not interfere with each other.
 */
@SpringBootTest
@AutoConfigureMockMvc
@AutoConfigureObservability
@ActiveProfiles("test")
@Import(TestClearingConfig.class)
public abstract class AbstractIntegrationTest {

    protected static final UUID ALICE = UUID.fromString("00000000-0000-4000-8000-000000000001");
    protected static final UUID BOB = UUID.fromString("00000000-0000-4000-8000-000000000002");
    protected static final UUID CARLA = UUID.fromString("00000000-0000-4000-8000-000000000003");
    protected static final UUID SUSPENDED_CUSTOMER = UUID.fromString("00000000-0000-4000-8000-000000000005");

    @Autowired protected MockMvc mvc;
    @Autowired protected ObjectMapper json;
    @Autowired protected JwtEncoder encoder;
    @Autowired protected JdbcTemplate jdbc;
    @Autowired protected OutboxDispatcher dispatcher;
    @Autowired protected ScriptedClearingClient clearing;

    // ---------------------------------------------------------------- tokens

    protected String token(String subject, Role role, UUID customerId) {
        return mint(subject, role, customerId, Instant.now().plus(30, ChronoUnit.MINUTES));
    }

    protected String mint(String subject, Role role, UUID customerId, Instant expiry) {
        Instant issued = expiry.isBefore(Instant.now()) ? expiry.minus(1, ChronoUnit.HOURS) : Instant.now();
        JwtClaimsSet.Builder claims = JwtClaimsSet.builder().issuer(com.fintechdemo.platform.security.LocalIssuerConfig.ISSUER)
                .subject(subject).issuedAt(issued).expiresAt(expiry).claim("roles", List.of(role.name()));
        if (customerId != null) {
            claims.claim("customer_id", customerId.toString());
        }
        return encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims.build())).getTokenValue();
    }

    protected String admin() {
        return token("adam.admin", Role.ADMIN, null);
    }

    protected String ops() {
        return token("omar.ops", Role.OPERATIONS_ANALYST, null);
    }

    protected String ops2() {
        return token("olivia.ops", Role.OPERATIONS_ANALYST, null);
    }

    protected String support() {
        return token("sam.support", Role.SUPPORT_AGENT, null);
    }

    protected String alice() {
        return token("alice.customer", Role.CUSTOMER, ALICE);
    }

    protected String bob() {
        return token("bob.customer", Role.CUSTOMER, BOB);
    }

    // ---------------------------------------------------------------- http helpers

    protected record Reply(int status, JsonNode body, MockHttpServletResponse raw) {
        public String text(String field) {
            return body.path(field).asText();
        }
    }

    protected Reply send(MockHttpServletRequestBuilder request, String token) throws Exception {
        if (token != null) {
            request.header("Authorization", "Bearer " + token);
        }
        MockHttpServletResponse response = mvc.perform(request).andReturn().getResponse();
        String content = response.getContentAsString();
        JsonNode node = content == null || content.isBlank() ? json.createObjectNode() : json.readTree(content);
        return new Reply(response.getStatus(), node, response);
    }

    protected Reply get(String url, String token) throws Exception {
        return send(MockMvcRequestBuilders.get(url), token);
    }

    protected Reply post(String url, String token, Object body) throws Exception {
        return send(MockMvcRequestBuilders.post(url).contentType(MediaType.APPLICATION_JSON)
                .content(body instanceof String s ? s : json.writeValueAsString(body)), token);
    }

    protected Reply postWithKey(String url, String token, String key, Object body) throws Exception {
        return send(MockMvcRequestBuilders.post(url).contentType(MediaType.APPLICATION_JSON).header("Idempotency-Key", key)
                .content(body instanceof String s ? s : json.writeValueAsString(body)), token);
    }

    // ---------------------------------------------------------------- domain fixtures

    protected static String key() {
        return "it-" + UUID.randomUUID();
    }

    /** Opens, activates and funds an account (funding must stay below the review threshold). */
    protected UUID fundedAccount(UUID customerId, String currency, String openingDeposit) throws Exception {
        Reply opened = post("/api/v1/customers/" + customerId + "/accounts", admin(),
                java.util.Map.of("accountType", "BROKERAGE", "currency", currency, "dailyWithdrawalLimit", "100000.00"));
        if (opened.status() != 201) {
            throw new IllegalStateException("could not open account: " + opened.body());
        }
        UUID id = UUID.fromString(opened.text("id"));
        Reply activated = post("/api/v1/accounts/" + id + "/activate", admin(), "{}");
        if (activated.status() != 200) {
            throw new IllegalStateException("could not activate: " + activated.body());
        }
        if (new java.math.BigDecimal(openingDeposit).signum() > 0) {
            Reply deposit = postWithKey("/api/v1/transactions", admin(), key(),
                    java.util.Map.of("type", "DEPOSIT", "targetAccountId", id.toString(), "amount", openingDeposit, "currency", currency));
            if (deposit.status() != 202) {
                throw new IllegalStateException("could not fund: " + deposit.body());
            }
            drain();
        }
        return id;
    }

    protected void drain() {
        for (int i = 0; i < 20 && dispatcher.drain() > 0; i++) {
            // keep draining until the outbox is empty
        }
    }

    protected Reply submit(String token, String type, UUID source, UUID target, String amount, String currency) throws Exception {
        java.util.Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("type", type);
        if (source != null) {
            body.put("sourceAccountId", source.toString());
        }
        if (target != null) {
            body.put("targetAccountId", target.toString());
        }
        body.put("amount", amount);
        body.put("currency", currency);
        return postWithKey("/api/v1/transactions", token, key(), body);
    }

    protected String balance(UUID accountId) throws Exception {
        return get("/api/v1/accounts/" + accountId + "/balance", admin()).text("ledgerBalance");
    }

    protected Reply tx(String id) throws Exception {
        return get("/api/v1/transactions/" + id, admin());
    }

    protected long countAudit(String action, String entityId) {
        Long n = jdbc.queryForObject("select count(*) from audit_events where action = ? and entity_id = ?", Long.class,
                action, entityId);
        return n == null ? 0 : n;
    }

    protected void assertLedgerIntegrity() throws Exception {
        Reply r = get("/api/v1/ops/ledger-integrity", admin());
        org.assertj.core.api.Assertions.assertThat(r.status()).isEqualTo(200);
        org.assertj.core.api.Assertions.assertThat(r.body().size()).as("accounts whose balance != ledger sum").isZero();
    }
}
