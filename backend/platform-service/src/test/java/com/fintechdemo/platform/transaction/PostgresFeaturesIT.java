package com.fintechdemo.platform.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fintechdemo.platform.support.AbstractIntegrationTest;
import com.fintechdemo.platform.support.EmbeddedPg;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * PostgreSQL-only behaviour on a REAL PostgreSQL 16 (embedded native binaries - no Docker needed): the vendor migration
 * (partial indexes, append-only audit trigger) and the query plans of the hot queries.
 */
public class PostgresFeaturesIT extends AbstractIntegrationTest {
    @DynamicPropertySource
    static void pg(DynamicPropertyRegistry registry) {
        EmbeddedPg.register(registry);
    }

    @Test
    @DisplayName("the PostgreSQL vendor migration ran (partial indexes exist)")
    void vendorMigrationApplied() {
        List<String> indexes = jdbc.queryForList("select indexname from pg_indexes where tablename in ('reconciliation_records','transactions')", String.class);
        assertThat(indexes).contains("uq_recon_open_per_tx", "ix_tx_attention", "ix_tx_source_created", "ix_tx_status_created");
        assertThat(jdbc.queryForObject("select version()", String.class)).startsWith("PostgreSQL");
    }

    @Test
    @DisplayName("audit events are append-only: UPDATE and DELETE are rejected by a database trigger")
    void auditTrailIsImmutable() throws Exception {
        fundedAccount(ALICE, "USD", "1.00");
        assertThat(jdbc.queryForObject("select count(*) from audit_events", Long.class)).isGreaterThan(0);
        assertThatThrownBy(() -> jdbc.update("update audit_events set actor = 'tampered'")).hasMessageContaining("append-only");
        assertThatThrownBy(() -> jdbc.update("delete from audit_events")).hasMessageContaining("append-only");
    }

    @Test
    @DisplayName("at most one OPEN reconciliation record per transaction (partial unique index)")
    void onlyOneOpenReconciliationPerTransaction() throws Exception {
        UUID account = fundedAccount(ALICE, "USD", "100.00");
        Reply w = submit(alice(), "WITHDRAWAL", account, null, "10.77", "USD");
        drain();
        UUID txId = UUID.fromString(w.text("id"));
        assertThat(jdbc.queryForObject("select count(*) from reconciliation_records where transaction_id = ? and status = 'OPEN'", Long.class, txId)).isEqualTo(1);
        assertThatThrownBy(() -> jdbc.update("insert into reconciliation_records (id, transaction_id, status, reason_code, opened_at, version) values (?,?,?,?,now(),0)",
                UUID.randomUUID(), txId, "OPEN", "DUPLICATE")).isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("captures EXPLAIN (ANALYZE) plans of the hot queries into target/query-plans.txt")
    void queryPlans() throws Exception {
        UUID account = fundedAccount(ALICE, "USD", "500.00");
        List<UUID> others = new ArrayList<>();
        for (int i = 0; i < 19; i++) {
            others.add(fundedAccount(ALICE, "USD", "1.00"));
        }
        String idArray = "array['" + account + "'," + String.join(",", others.stream().map(u -> "'" + u + "'").toList()) + "]::uuid[]";
        // 100,000 synthetic completed withdrawals spread over 20 accounts (5,000 per account), spread over ~28 hours
        jdbc.execute("insert into transactions (id, reference, transaction_type, status, source_account_id, amount, currency, submitted_by, funds_reserved, version, created_at, updated_at) "
                + "select gen_random_uuid(), 'TXN-P' || g || substr(md5(random()::text), 1, 8), 'WITHDRAWAL', 'COMPLETED', (" + idArray + ")[1 + (g % 20)], 1.0000, 'USD', 'plan-test', false, 0, "
                + "now() - (g || ' seconds')::interval, now() from generate_series(1, 100000) g");
        UUID sparse = fundedAccount(ALICE, "USD", "5.00"); // an account with a single transaction among 100,000
        jdbc.execute("ANALYZE transactions");
        Map<String, String> queries = new java.util.LinkedHashMap<>();
        queries.put("Account history for a SPARSE account (planner switches to the per-account indexes)",
                "select * from transactions where (source_account_id = '" + sparse + "' or target_account_id = '" + sparse + "') order by created_at desc, id limit 20");
        queries.put("Account history for a BUSY account (5,000 rows): newest-first walk of ix_tx_created with a filter",
                "select * from transactions where (source_account_id = '" + account + "' or target_account_id = '" + account + "') order by created_at desc, id limit 20");
        queries.put("Operations attention queue (partial index ix_tx_attention)",
                "select * from transactions where status in ('PENDING_REVIEW','RECONCILIATION_REQUIRED','FAILED') order by created_at desc limit 50");
        queries.put("Idempotency lookup (unique index uq_idempotency_principal_key)",
                "select * from idempotency_records where principal = 'alice.customer' and idempotency_key = 'k-1234567890'");
        queries.put("Outbox polling (ix_outbox_status_available)",
                "select id from outbox_events where status = 'NEW' and available_at <= now() order by created_at limit 20");
        queries.put("Daily withdrawal limit sum (ix_tx_source_created)",
                "select coalesce(sum(amount),0) from transactions where source_account_id = '" + account + "' and transaction_type = 'WITHDRAWAL' and created_at >= now() - interval '24 hours' and status in ('PROCESSING','COMPLETED','RECONCILIATION_REQUIRED')");
        queries.put("Row lock taken when applying a transfer (primary key)",
                "select * from accounts where id = '" + account + "' for update");
        queries.put("Open reconciliation records (partial unique index uq_recon_open_per_tx)",
                "select * from reconciliation_records where status = 'OPEN' order by opened_at limit 50");
        StringBuilder out = new StringBuilder("# EXPLAIN (ANALYZE, COSTS OFF) on PostgreSQL with 100,000 synthetic transactions over 20 accounts - the SHAPE of the plan matters; timings are omitted on purpose (shared dev machine)\n\n");
        for (var e : queries.entrySet()) {
            List<String> plan = new ArrayList<>(jdbc.queryForList("explain (analyze, costs off, timing off, summary off) " + e.getValue(), String.class));
            out.append("## ").append(e.getKey()).append("\n\n```sql\n").append(e.getValue()).append("\n```\n\n```text\n").append(String.join("\n", plan)).append("\n```\n\n");
        }
        Path target = Path.of("target", "query-plans.txt");
        Files.createDirectories(target.getParent());
        Files.writeString(target, out.toString());
        assertThat(out.toString()).contains("Index");
    }
}
