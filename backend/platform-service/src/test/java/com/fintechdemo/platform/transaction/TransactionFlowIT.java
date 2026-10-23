package com.fintechdemo.platform.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import com.fintechdemo.platform.support.AbstractIntegrationTest;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * BDD-style acceptance scenarios against the real stack (Spring context + database + security + outbox + processor).
 * Scenario names mirror docs/testing/bdd-scenarios.md.
 */
class TransactionFlowIT extends AbstractIntegrationTest {

    @Test
    @DisplayName("Scenario: a valid withdrawal completes and reduces the balance")
    void validWithdrawal() throws Exception {
        // Given an active account with 1,000.00 USD
        UUID account = fundedAccount(ALICE, "USD", "1000.00");
        // When the customer withdraws 250.00
        Reply submitted = submit(alice(), "WITHDRAWAL", account, null, "250.00", "USD");
        assertThat(submitted.status()).isEqualTo(202);
        assertThat(submitted.text("status")).isEqualTo("VALIDATED");
        drain();
        // Then the transaction is COMPLETED and the balance is 750.00
        assertThat(tx(submitted.text("id")).text("status")).isEqualTo("COMPLETED");
        assertThat(balance(account)).isEqualTo("750.00");
        assertLedgerIntegrity();
    }

    @Test
    @DisplayName("Scenario: a withdrawal exceeding the available balance is rejected with INSUFFICIENT_FUNDS")
    void withdrawalExceedingBalance() throws Exception {
        UUID account = fundedAccount(ALICE, "USD", "100.00");
        Reply r = submit(alice(), "WITHDRAWAL", account, null, "100.01", "USD");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.text("code")).isEqualTo("TRANSACTION_REJECTED");
        assertThat(r.body().path("details").path("failureCode").asText()).isEqualTo("INSUFFICIENT_FUNDS");
        assertThat(balance(account)).isEqualTo("100.00");
    }

    @Test
    @DisplayName("Scenario: a transfer between two accounts debits and credits atomically")
    void transferBetweenAccounts() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "500.00");
        UUID b = fundedAccount(ALICE, "USD", "50.00");
        Reply r = submit(alice(), "TRANSFER", a, b, "200.00", "USD");
        assertThat(r.status()).isEqualTo(202);
        drain();
        assertThat(tx(r.text("id")).text("status")).isEqualTo("COMPLETED");
        assertThat(balance(a)).isEqualTo("300.00");
        assertThat(balance(b)).isEqualTo("250.00");
        assertLedgerIntegrity();
    }

    @Test
    @DisplayName("Scenario: currency mismatch and inactive accounts are rejected by validation")
    void validationRejections() throws Exception {
        UUID usd = fundedAccount(ALICE, "USD", "100.00");
        Reply mismatch = submit(alice(), "WITHDRAWAL", usd, null, "10.00", "EUR");
        assertThat(mismatch.body().path("details").path("failureCode").asText()).isEqualTo("CURRENCY_MISMATCH");

        Reply pending = post("/api/v1/customers/" + ALICE + "/accounts", admin(),
                java.util.Map.of("accountType", "BROKERAGE", "currency", "USD"));
        UUID notActivated = UUID.fromString(pending.text("id"));
        Reply toPending = submit(alice(), "DEPOSIT", null, notActivated, "10.00", "USD");
        assertThat(toPending.status()).isEqualTo(422);
        assertThat(toPending.body().path("details").path("failureCode").asText()).isEqualTo("TARGET_ACCOUNT_NOT_ACTIVE");

        Reply precision = submit(alice(), "DEPOSIT", null, usd, "10.005", "USD");
        assertThat(precision.body().path("details").path("failureCode").asText()).isEqualTo("AMOUNT_PRECISION");
    }

    @Test
    @DisplayName("Scenario: a customer who is suspended cannot move money")
    void suspendedCustomerCannotTransact() throws Exception {
        // seed account ACC-1000000010 belongs to the suspended customer Esha
        UUID account = UUID.fromString("10000000-0000-4000-8000-000000000010");
        Reply r = submit(admin(), "DEPOSIT", null, account, "10.00", "INR");
        assertThat(r.status()).isEqualTo(422);
        assertThat(r.body().path("details").path("failureCode").asText()).isEqualTo("CUSTOMER_NOT_ACTIVE");
    }

    @Test
    @DisplayName("Scenario: a large transaction needs an independent approver (maker-checker)")
    void reviewThresholdAndMakerChecker() throws Exception {
        UUID a = fundedAccount(CARLA, "EUR", "40000.00");
        // top up beyond the threshold in two deposits
        drain();
        assertThat(submit(admin(), "DEPOSIT", null, a, "40000.00", "EUR").status()).isEqualTo(202);
        drain();
        Reply big = submit(ops(), "WITHDRAWAL", a, null, "60000.00", "EUR");
        assertThat(big.status()).isEqualTo(202);
        assertThat(big.text("status")).isEqualTo("PENDING_REVIEW");

        // the submitter cannot approve their own transaction
        Reply self = post("/api/v1/transactions/" + big.text("id") + "/approve", ops(), "{}");
        assertThat(self.status()).isEqualTo(403);
        assertThat(self.text("code")).isEqualTo("MAKER_CHECKER_VIOLATION");

        // a customer cannot approve at all
        assertThat(post("/api/v1/transactions/" + big.text("id") + "/approve", token("carla.customer",
                com.fintechdemo.platform.security.Role.CUSTOMER, CARLA), "{}").status()).isEqualTo(403);

        // a different operator can
        Reply approved = post("/api/v1/transactions/" + big.text("id") + "/approve", ops2(), "{}");
        assertThat(approved.status()).isEqualTo(200);
        assertThat(approved.text("status")).isEqualTo("VALIDATED");
        drain();
        assertThat(tx(big.text("id")).text("status")).isEqualTo("COMPLETED");
        assertThat(tx(big.text("id")).text("reviewedBy")).isEqualTo("olivia.ops");
        assertThat(balance(a)).isEqualTo("20000.00");
    }

    @Test
    @DisplayName("Scenario: a pending transaction can be cancelled, a completed one cannot")
    void cancellation() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "300.00");
        Reply w = submit(alice(), "WITHDRAWAL", a, null, "50.00", "USD");
        Reply cancelled = post("/api/v1/transactions/" + w.text("id") + "/cancel", alice(), "{}");
        assertThat(cancelled.status()).isEqualTo(200);
        assertThat(cancelled.text("status")).isEqualTo("CANCELLED");
        drain(); // the outbox event is still delivered; the processor must ignore a cancelled transaction
        assertThat(tx(w.text("id")).text("status")).isEqualTo("CANCELLED");
        assertThat(balance(a)).isEqualTo("300.00");

        Reply done = submit(alice(), "WITHDRAWAL", a, null, "50.00", "USD");
        drain();
        Reply late = post("/api/v1/transactions/" + done.text("id") + "/cancel", alice(), "{}");
        assertThat(late.status()).isEqualTo(409);
        assertThat(late.text("code")).isEqualTo("INVALID_STATE_TRANSITION");
    }

    @Test
    @DisplayName("Scenario: a clearing decline fails the transaction and returns the reserved funds")
    void clearingDeclineRefunds() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "500.00");
        Reply w = submit(alice(), "WITHDRAWAL", a, null, "100.13", "USD"); // .13 => RISK_DECLINE in the scripted network
        drain();
        Reply result = tx(w.text("id"));
        assertThat(result.text("status")).isEqualTo("FAILED");
        assertThat(result.text("failureCode")).isEqualTo("CLEARING_DECLINED");
        assertThat(balance(a)).isEqualTo("500.00"); // reserved funds were returned
        assertLedgerIntegrity();
    }

    @Test
    @DisplayName("Scenario: a request that never reached the network fails fast and refunds")
    void notSentRefunds() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "500.00");
        Reply w = submit(alice(), "WITHDRAWAL", a, null, "100.88", "USD");
        drain();
        assertThat(tx(w.text("id")).text("failureCode")).isEqualTo("CLEARING_UNAVAILABLE");
        assertThat(balance(a)).isEqualTo("500.00");
    }

    @Test
    @DisplayName("Scenario: an unknown external outcome is held for reconciliation, funds stay reserved, then auto-resolves")
    void unknownOutcomeIsReconciledAutomatically() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "500.00");
        Reply w = submit(alice(), "WITHDRAWAL", a, null, "100.66", "USD"); // timeout, but the network executed it
        drain();
        Reply held = tx(w.text("id"));
        assertThat(held.text("status")).isEqualTo("RECONCILIATION_REQUIRED");
        assertThat(balance(a)).isEqualTo("399.34"); // funds remain reserved while uncertain

        Reply queue = get("/api/v1/ops/reconciliations", ops());
        assertThat(queue.body().path("items").toString()).contains(w.text("id"));

        // the reconciler asks the network what happened: it executed => COMPLETED
        Reply drained = post("/api/v1/ops/processing/drain", admin(), "{}");
        assertThat(drained.body().path("reconciled").asInt()).isGreaterThanOrEqualTo(1);
        assertThat(tx(w.text("id")).text("status")).isEqualTo("COMPLETED");
        assertThat(balance(a)).isEqualTo("399.34");
        assertLedgerIntegrity();
    }

    @Test
    @DisplayName("Scenario: a failed-uncertain transaction is investigated and resolved by an operator")
    void unknownOutcomeResolvedManually() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "500.00");
        Reply w = submit(alice(), "WITHDRAWAL", a, null, "100.77", "USD"); // timeout and NOT executed
        drain();
        assertThat(tx(w.text("id")).text("status")).isEqualTo("RECONCILIATION_REQUIRED");

        // investigation: attempts + audit trail + reconciliation record
        Reply attempts = get("/api/v1/transactions/" + w.text("id") + "/attempts", support());
        assertThat(attempts.body().toString()).contains("UNKNOWN").contains("RESERVED");
        Reply audit = get("/api/v1/transactions/" + w.text("id") + "/audit", support());
        assertThat(audit.body().toString()).contains("TRANSACTION_RECONCILIATION_REQUIRED");

        String recordId = null;
        for (var item : get("/api/v1/ops/reconciliations", ops()).body().path("items")) {
            if (item.path("transactionId").asText().equals(w.text("id"))) {
                recordId = item.path("id").asText();
            }
        }
        assertThat(recordId).isNotNull();

        // support agents can look but cannot resolve
        assertThat(post("/api/v1/ops/reconciliations/" + recordId + "/resolve", support(),
                java.util.Map.of("resolution", "CONFIRMED_NOT_EXECUTED")).status()).isEqualTo(403);

        Reply resolved = post("/api/v1/ops/reconciliations/" + recordId + "/resolve", ops(),
                java.util.Map.of("resolution", "CONFIRMED_NOT_EXECUTED", "note", "network confirmed no payout"));
        assertThat(resolved.status()).isEqualTo(200);
        assertThat(resolved.text("status")).isEqualTo("RESOLVED");
        assertThat(tx(w.text("id")).text("status")).isEqualTo("FAILED");
        assertThat(balance(a)).isEqualTo("500.00"); // funds returned

        // resolving twice is refused
        assertThat(post("/api/v1/ops/reconciliations/" + recordId + "/resolve", ops(),
                java.util.Map.of("resolution", "CONFIRMED_EXECUTED")).status()).isEqualTo(409);
        assertLedgerIntegrity();
    }

    @Test
    @DisplayName("Scenario: a transaction stuck in PROCESSING is recovered into reconciliation")
    void stuckProcessingIsRecovered() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "500.00");
        Reply w = submit(alice(), "WITHDRAWAL", a, null, "40.00", "USD");
        drain();
        // simulate a crash between "funds reserved" and "outcome recorded"
        jdbc.update("update transactions set status = 'PROCESSING', completed_at = null, updated_at = ? where id = ?",
                java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(3600)), UUID.fromString(w.text("id")));
        Reply drained = post("/api/v1/ops/processing/drain", admin(), "{}");
        assertThat(drained.body().path("recoveredStuck").asInt()).isGreaterThanOrEqualTo(1);
        assertThat(tx(w.text("id")).text("status")).isEqualTo("RECONCILIATION_REQUIRED");
        assertThat(tx(w.text("id")).text("failureCode")).isEqualTo("PROCESSING_TIMEOUT");
    }

    @Test
    @DisplayName("Scenario: invalid state transitions are refused (approve a non-pending transaction)")
    void approveNonPendingIsRefused() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "100.00");
        Reply w = submit(alice(), "WITHDRAWAL", a, null, "10.00", "USD");
        Reply r = post("/api/v1/transactions/" + w.text("id") + "/approve", ops(), "{}");
        assertThat(r.status()).isEqualTo(409);
        assertThat(r.text("code")).isEqualTo("INVALID_STATE_TRANSITION");
    }

    @Test
    @DisplayName("Scenario: daily withdrawal limit is enforced (acceptance criteria of the TDD feature)")
    void dailyLimitEnforced() throws Exception {
        Reply opened = post("/api/v1/customers/" + ALICE + "/accounts", admin(),
                java.util.Map.of("accountType", "BROKERAGE", "currency", "USD", "dailyWithdrawalLimit", "100.00"));
        UUID a = UUID.fromString(opened.text("id"));
        post("/api/v1/accounts/" + a + "/activate", admin(), "{}");
        submit(admin(), "DEPOSIT", null, a, "1000.00", "USD");
        drain();

        assertThat(submit(alice(), "WITHDRAWAL", a, null, "60.00", "USD").status()).isEqualTo(202);
        drain();
        Reply over = submit(alice(), "WITHDRAWAL", a, null, "40.01", "USD");
        assertThat(over.status()).isEqualTo(422);
        assertThat(over.body().path("details").path("failureCode").asText()).isEqualTo("DAILY_LIMIT_EXCEEDED");
        assertThat(submit(alice(), "WITHDRAWAL", a, null, "40.00", "USD").status()).isEqualTo(202);
    }

    @Test
    @DisplayName("Scenario: cancelled and failed withdrawals do not count against the daily limit (AC8)")
    void dailyLimitIgnoresCancelledAndFailed() throws Exception {
        Reply opened = post("/api/v1/customers/" + ALICE + "/accounts", admin(),
                java.util.Map.of("accountType", "BROKERAGE", "currency", "USD", "dailyWithdrawalLimit", "100.00"));
        UUID a = UUID.fromString(opened.text("id"));
        post("/api/v1/accounts/" + a + "/activate", admin(), "{}");
        submit(admin(), "DEPOSIT", null, a, "1000.00", "USD");
        drain();

        Reply toCancel = submit(alice(), "WITHDRAWAL", a, null, "60.00", "USD");
        assertThat(post("/api/v1/transactions/" + toCancel.text("id") + "/cancel", alice(), "{}").text("status")).isEqualTo("CANCELLED");
        Reply declined = submit(alice(), "WITHDRAWAL", a, null, "60.13", "USD"); // .13 => declined by the scripted network => FAILED
        drain();
        assertThat(tx(declined.text("id")).text("status")).isEqualTo("FAILED");

        // neither the cancelled nor the failed withdrawal consumed any of the allowance: the full 100.00 is still available
        Reply full = submit(alice(), "WITHDRAWAL", a, null, "100.00", "USD");
        assertThat(full.status()).isEqualTo(202);
        drain();
        assertThat(tx(full.text("id")).text("status")).isEqualTo("COMPLETED");
    }

    @Test
    @DisplayName("Scenario: closing an account requires a zero balance and nothing in flight")
    void closeAccountRules() throws Exception {
        UUID a = fundedAccount(ALICE, "USD", "10.00");
        assertThat(post("/api/v1/accounts/" + a + "/close", admin(), "{}").text("code")).isEqualTo("ACCOUNT_HAS_BALANCE");
        submit(alice(), "WITHDRAWAL", a, null, "10.00", "USD");
        // withdrawal is VALIDATED (in flight, balance still 10.00)
        drain();
        assertThat(balance(a)).isEqualTo("0.00");
        Reply closed = post("/api/v1/accounts/" + a + "/close", admin(), "{}");
        assertThat(closed.status()).isEqualTo(200);
        assertThat(closed.text("status")).isEqualTo("CLOSED");
        // a closed account cannot be reactivated
        assertThat(post("/api/v1/accounts/" + a + "/activate", admin(), "{}").status()).isEqualTo(409);
    }

    @Test
    @DisplayName("Scenario: customer search, pagination, sorting and filters work and are scoped")
    void searchAndPagination() throws Exception {
        UUID a = fundedAccount(BOB, "GBP", "100.00");
        for (int i = 0; i < 3; i++) {
            submit(bob(), "WITHDRAWAL", a, null, "1.0" + i, "GBP");
        }
        drain();
        Reply page = get("/api/v1/accounts/" + a + "/transactions?size=2&sort=amount,asc", bob());
        assertThat(page.status()).isEqualTo(200);
        assertThat(page.body().path("items").size()).isEqualTo(2);
        assertThat(page.body().path("totalElements").asInt()).isEqualTo(4); // opening deposit + 3 withdrawals
        assertThat(page.body().path("items").get(0).path("amount").asText()).isEqualTo("1.00");

        Reply filtered = get("/api/v1/transactions?accountId=" + a + "&type=WITHDRAWAL&status=COMPLETED&minAmount=1.01", bob());
        assertThat(filtered.body().path("totalElements").asInt()).isEqualTo(2);

        Reply badSort = get("/api/v1/transactions?sort=submittedBy,asc", bob());
        assertThat(badSort.status()).isEqualTo(400);
        assertThat(badSort.text("code")).isEqualTo("INVALID_SORT");
    }

    @Test
    @DisplayName("Scenario: operational dashboard endpoints return consistent data")
    void dashboard() throws Exception {
        fundedAccount(ALICE, "USD", "10.00");
        Reply summary = get("/api/v1/ops/summary", support());
        assertThat(summary.status()).isEqualTo(200);
        assertThat(summary.body().path("transactionsByStatus").has("COMPLETED")).isTrue();
        assertThat(summary.body().path("processingLatency").path("sampleSize").asInt()).isGreaterThan(0);
        Reply health = get("/api/v1/ops/health", support());
        assertThat(health.text("status")).isIn("UP", "DEGRADED");
        assertThat(health.body().path("components").size()).isGreaterThanOrEqualTo(4);
        Reply audit = get("/api/v1/ops/audit-events?action=TRANSACTION_COMPLETED&size=5", support());
        assertThat(audit.body().path("items").size()).isGreaterThan(0);
        assertThat(get("/api/v1/ops/summary", alice()).status()).isEqualTo(403);
    }
}
