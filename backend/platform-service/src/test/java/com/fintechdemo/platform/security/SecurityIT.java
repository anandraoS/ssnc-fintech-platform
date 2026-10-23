package com.fintechdemo.platform.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.fintechdemo.platform.support.AbstractIntegrationTest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

/**
 * Security configuration and authorization tests: authentication, role rules, and - most importantly - object-level
 * authorization (OWASP API1 / BOLA): a customer must never reach another customer's accounts or transactions.
 */
class SecurityIT extends AbstractIntegrationTest {

    // ------------------------------------------------------------ authentication

    @Test
    @DisplayName("requests without a token are rejected with 401 and a standard error body")
    void noTokenIs401() throws Exception {
        Reply r = get("/api/v1/accounts", null);
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.text("code")).isEqualTo("UNAUTHENTICATED");
        assertThat(r.raw().getHeader("WWW-Authenticate")).startsWith("Bearer");
    }

    @Test
    @DisplayName("garbage, tampered and expired tokens are rejected")
    void invalidTokensAre401() throws Exception {
        assertThat(get("/api/v1/me", "not-a-jwt").status()).isEqualTo(401);
        String good = alice();
        String tampered = good.substring(0, good.length() - 4) + (good.endsWith("AAAA") ? "BBBB" : "AAAA");
        assertThat(get("/api/v1/me", tampered).status()).isEqualTo(401);
        String expired = mint("alice.customer", Role.CUSTOMER, ALICE, Instant.now().minus(5, ChronoUnit.MINUTES));
        Reply r = get("/api/v1/me", expired);
        assertThat(r.status()).isEqualTo(401);
        assertThat(r.text("code")).isEqualTo("INVALID_TOKEN");
    }

    @Test
    @DisplayName("a token signed with a different key is rejected")
    void foreignSignatureRejected() throws Exception {
        // header {"alg":"HS256"}, payload {"sub":"mallory","roles":["ADMIN"]}, bogus signature
        String forged = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJtYWxsb3J5Iiwicm9sZXMiOlsiQURNSU4iXX0.c2lnbmF0dXJl";
        assertThat(get("/api/v1/ops/summary", forged).status()).isEqualTo(401);
    }

    @Test
    @DisplayName("unknown role names in a valid token grant nothing (least privilege)")
    void unknownRoleGrantsNothing() throws Exception {
        String t = encoder.encode(org.springframework.security.oauth2.jwt.JwtEncoderParameters.from(
                org.springframework.security.oauth2.jwt.JwsHeader.with(org.springframework.security.oauth2.jose.jws.MacAlgorithm.HS256).build(),
                org.springframework.security.oauth2.jwt.JwtClaimsSet.builder().issuer(LocalIssuerConfig.ISSUER).subject("eve")
                        .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(600))
                        .claim("roles", java.util.List.of("SUPER_ADMIN", "root")).build())).getTokenValue();
        assertThat(get("/api/v1/ops/summary", t).status()).isEqualTo(403);
    }

    @Test
    @DisplayName("the local login endpoint issues a usable token and rejects bad credentials generically")
    void localLogin() throws Exception {
        Reply bad = post("/api/v1/auth/token", null, Map.of("username", "alice.customer", "password", "wrong"));
        Reply unknown = post("/api/v1/auth/token", null, Map.of("username", "nobody", "password", "wrong"));
        assertThat(bad.status()).isEqualTo(401);
        assertThat(bad.text("message")).isEqualTo(unknown.text("message")); // no user enumeration
        Reply ok = post("/api/v1/auth/token", null, Map.of("username", "alice.customer", "password", "test-only-password"));
        assertThat(ok.status()).isEqualTo(200);
        Reply me = get("/api/v1/me", ok.text("accessToken"));
        assertThat(me.text("subject")).isEqualTo("alice.customer");
        assertThat(me.body().path("roles").get(0).asText()).isEqualTo("CUSTOMER");
        assertThat(countAudit("LOGIN_FAILED", "alice.customer")).isGreaterThanOrEqualTo(1);
    }

    @Test
    @DisplayName("unknown paths and non-API paths are denied by default; responses carry security headers")
    void denyByDefaultAndHeaders() throws Exception {
        assertThat(get("/internal/secret", alice()).status()).isIn(401, 403, 404);
        Reply r = get("/api/v1/me", alice());
        assertThat(r.raw().getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
        assertThat(r.raw().getHeader("X-Frame-Options")).isEqualTo("DENY");
        assertThat(r.raw().getHeader("Cache-Control")).isEqualTo("no-store");
        assertThat(r.raw().getHeader("X-Correlation-Id")).isNotBlank();
        assertThat(r.raw().getHeader("X-API-Version")).isEqualTo("1");
    }

    @Test
    @DisplayName("CORS allows only the configured origin and exposes the idempotency header")
    void cors() throws Exception {
        var allowed = mvc.perform(MockMvcRequestBuilders.options("/api/v1/transactions")
                .header("Origin", "http://localhost:4280").header("Access-Control-Request-Method", "POST")
                .header("Access-Control-Request-Headers", "authorization,idempotency-key")).andReturn().getResponse();
        assertThat(allowed.getStatus()).isEqualTo(200);
        assertThat(allowed.getHeader("Access-Control-Allow-Origin")).isEqualTo("http://localhost:4280");
        var denied = mvc.perform(MockMvcRequestBuilders.options("/api/v1/transactions")
                .header("Origin", "https://evil.example").header("Access-Control-Request-Method", "POST")).andReturn().getResponse();
        assertThat(denied.getStatus()).isEqualTo(403);
        assertThat(denied.getHeader("Access-Control-Allow-Origin")).isNull();
    }

    @Test
    @DisplayName("a client-supplied correlation id is echoed; an unsafe one is replaced (log-injection guard)")
    void correlationId() throws Exception {
        var ok = mvc.perform(MockMvcRequestBuilders.get("/api/v1/me").header("Authorization", "Bearer " + alice())
                .header("X-Correlation-Id", "trace-abc-12345")).andReturn().getResponse();
        assertThat(ok.getHeader("X-Correlation-Id")).isEqualTo("trace-abc-12345");
        var evil = mvc.perform(MockMvcRequestBuilders.get("/api/v1/me").header("Authorization", "Bearer " + alice())
                .header("X-Correlation-Id", "bad id\r\nX-Injected: 1")).andReturn().getResponse();
        assertThat(evil.getHeader("X-Correlation-Id")).doesNotContain("\n").hasSize(36);
    }

    // ------------------------------------------------------------ role-based access

    @Test
    @DisplayName("roles gate what an endpoint does")
    void roleRules() throws Exception {
        Map<String, String> newCustomer = Map.of("legalName", "Role Test", "email", "role-" + UUID.randomUUID() + "@example.test");
        assertThat(post("/api/v1/customers", alice(), newCustomer).status()).isEqualTo(403);          // customer
        assertThat(post("/api/v1/customers", support(), newCustomer).status()).isEqualTo(403);        // support: read-only
        assertThat(post("/api/v1/customers", ops(), newCustomer).status()).isEqualTo(201);            // operations
        assertThat(get("/api/v1/customers", alice()).status()).isEqualTo(403);
        assertThat(get("/api/v1/customers", support()).status()).isEqualTo(200);
        assertThat(post("/api/v1/ops/processing/drain", ops(), "{}").status()).isEqualTo(403);        // admin only
        assertThat(post("/api/v1/ops/processing/drain", admin(), "{}").status()).isEqualTo(200);
        assertThat(get("/api/v1/ops/outbox", ops()).status()).isEqualTo(403);
        assertThat(get("/api/v1/ops/outbox", admin()).status()).isEqualTo(200);
    }

    @Test
    @DisplayName("a support agent can look up but never move money")
    void supportCannotSubmit() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "100.00");
        assertThat(submit(support(), "WITHDRAWAL", a, null, "10.00", "USD").status()).isEqualTo(403);
        assertThat(get("/api/v1/accounts/" + a, support()).status()).isEqualTo(200);
    }

    @Test
    @DisplayName("support agents see masked PII, the owner and operators see it in full")
    void piiMasking() throws Exception {
        assertThat(get("/api/v1/customers/" + ALICE, support()).text("email")).isEqualTo("a***@example.test");
        assertThat(get("/api/v1/customers/" + ALICE, alice()).text("email")).isEqualTo("alice@example.test");
        assertThat(get("/api/v1/customers/" + ALICE, ops()).text("email")).isEqualTo("alice@example.test");
        assertThat(get("/api/v1/customers/" + ALICE, ops()).text("taxIdLast4")).isEqualTo("****");
    }

    // ------------------------------------------------------------ BOLA

    @Test
    @DisplayName("BOLA: a customer cannot read another customer's account, balance, history or ledger")
    void customerCannotReadOthersAccounts() throws Exception {
        UUID bobsAccount = fundedAccount(BOB, "USD", "250.00");
        assertThat(get("/api/v1/accounts/" + bobsAccount, alice()).status()).isEqualTo(404);
        assertThat(get("/api/v1/accounts/" + bobsAccount + "/balance", alice()).status()).isEqualTo(404);
        assertThat(get("/api/v1/accounts/" + bobsAccount + "/transactions", alice()).status()).isEqualTo(404);
        assertThat(get("/api/v1/ops/accounts/" + bobsAccount + "/ledger", alice()).status()).isEqualTo(403);
        assertThat(get("/api/v1/customers/" + BOB, alice()).status()).isEqualTo(404);
        // the owner still can
        assertThat(get("/api/v1/accounts/" + bobsAccount, bob()).status()).isEqualTo(200);
        // the denial is audited
        assertThat(countAudit("ACCESS_DENIED", bobsAccount.toString())).isGreaterThanOrEqualTo(3);
    }

    @Test
    @DisplayName("BOLA: listing and searching are scoped to the caller's own customer")
    void searchesAreScoped() throws Exception {
        UUID bobsAccount = fundedAccount(BOB, "USD", "75.00");
        UUID alicesAccount = fundedAccount(ALICE, "USD", "75.00");
        Reply mine = get("/api/v1/accounts?size=100", alice());
        assertThat(mine.status()).isEqualTo(200);
        for (var item : mine.body().path("items")) {
            assertThat(item.path("customerId").asText()).isEqualTo(ALICE.toString());
        }
        assertThat(mine.body().toString()).contains(alicesAccount.toString()).doesNotContain(bobsAccount.toString());
        // asking for another customer's accounts explicitly is refused
        assertThat(get("/api/v1/accounts?customerId=" + BOB, alice()).status()).isEqualTo(404);
        // transaction search cannot be widened with a foreign accountId
        assertThat(get("/api/v1/transactions?accountId=" + bobsAccount, alice()).status()).isEqualTo(404);
        Reply txs = get("/api/v1/transactions?size=100", alice());
        for (var item : txs.body().path("items")) {
            assertThat(item.path("sourceAccountId").asText() + item.path("targetAccountId").asText())
                    .doesNotContain(bobsAccount.toString());
        }
    }

    @Test
    @DisplayName("BOLA: a customer cannot read, cancel or approve another customer's transaction")
    void customerCannotTouchOthersTransactions() throws Exception {
        UUID bobsAccount = fundedAccount(BOB, "USD", "500.00");
        Reply bobsTx = submit(bob(), "WITHDRAWAL", bobsAccount, null, "20.00", "USD");
        String id = bobsTx.text("id");
        assertThat(get("/api/v1/transactions/" + id, alice()).status()).isEqualTo(404);
        assertThat(post("/api/v1/transactions/" + id + "/cancel", alice(), "{}").status()).isEqualTo(404);
        assertThat(post("/api/v1/transactions/" + id + "/approve", alice(), "{}").status()).isEqualTo(403);
        assertThat(tx(id).text("status")).isEqualTo("VALIDATED"); // untouched
    }

    @Test
    @DisplayName("unauthorized transaction submission: no money movement on someone else's account")
    void cannotSubmitAgainstOthersAccounts() throws Exception {
        UUID bobsAccount = fundedAccount(BOB, "USD", "500.00");
        UUID alicesAccount = fundedAccount(ALICE, "USD", "500.00");
        assertThat(submit(alice(), "WITHDRAWAL", bobsAccount, null, "10.00", "USD").status()).isEqualTo(404);
        assertThat(submit(alice(), "DEPOSIT", null, bobsAccount, "10.00", "USD").status()).isEqualTo(404);
        assertThat(submit(alice(), "TRANSFER", alicesAccount, bobsAccount, "10.00", "USD").status()).isEqualTo(404);
        assertThat(submit(alice(), "TRANSFER", bobsAccount, alicesAccount, "10.00", "USD").status()).isEqualTo(404);
        assertThat(balance(bobsAccount)).isEqualTo("500.00");
        assertThat(balance(alicesAccount)).isEqualTo("500.00");
    }

    @Test
    @DisplayName("a token without a customer claim cannot reach any customer data")
    void customerRoleWithoutCustomerClaim() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "10.00");
        String orphan = token("orphan.customer", Role.CUSTOMER, null);
        assertThat(get("/api/v1/accounts/" + a, orphan).status()).isEqualTo(404);
        assertThat(get("/api/v1/accounts", orphan).status()).isEqualTo(404);
        assertThat(get("/api/v1/transactions", orphan).body().path("totalElements").asInt()).isZero();
    }

    // ------------------------------------------------------------ input handling

    @Test
    @DisplayName("mass assignment and unknown fields are rejected, injection strings are inert")
    void inputHardening() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "100.00");
        // unknown property (mass assignment attempt) => 400
        Reply mass = postWithKey("/api/v1/transactions", alice(), key(), Map.of("type", "DEPOSIT", "targetAccountId",
                a.toString(), "amount", "5.00", "currency", "USD", "status", "COMPLETED", "submittedBy", "admin"));
        assertThat(mass.status()).isEqualTo(400);
        assertThat(mass.text("code")).isEqualTo("MALFORMED_REQUEST");
        // SQL-injection style search input is just data
        assertThat(get("/api/v1/transactions?reference=" + java.net.URLEncoder.encode("' OR '1'='1", "UTF-8"), alice()).status()).isEqualTo(200);
        assertThat(get("/api/v1/accounts?q=" + java.net.URLEncoder.encode("x' OR 1=1 --", "UTF-8"), alice())
                .body().path("totalElements").asInt()).isZero();
        // memo allow-list
        Reply memo = postWithKey("/api/v1/transactions", alice(), key(), Map.of("type", "DEPOSIT", "targetAccountId",
                a.toString(), "amount", "5.00", "currency", "USD", "memo", "<script>alert(1)</script>"));
        assertThat(memo.status()).isEqualTo(400);
        assertThat(memo.text("code")).isEqualTo("VALIDATION_ERROR");
        // malformed UUID in path
        assertThat(get("/api/v1/accounts/not-a-uuid", alice()).status()).isEqualTo(400);
    }

    @Test
    @DisplayName("errors never leak stack traces, SQL or class names")
    void noInformationLeakage() throws Exception {
        Reply r = get("/api/v1/transactions/" + UUID.randomUUID(), admin());
        assertThat(r.status()).isEqualTo(404);
        String body = r.body().toString();
        assertThat(body).doesNotContain("Exception").doesNotContain("at com.").doesNotContain("SELECT").doesNotContain("hibernate");
        assertThat(r.raw().getContentType()).contains(MediaType.APPLICATION_JSON_VALUE);
    }
}
