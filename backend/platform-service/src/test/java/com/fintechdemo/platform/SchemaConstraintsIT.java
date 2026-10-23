package com.fintechdemo.platform;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fintechdemo.platform.support.AbstractIntegrationTest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * Proves the database itself defends the invariants even if application code had a bug (defence in depth):
 * these statements bypass the domain layer entirely.
 */
class SchemaConstraintsIT extends AbstractIntegrationTest {

    private static final UUID SEED_ACCOUNT = UUID.fromString("10000000-0000-4000-8000-000000000004");
    private static final UUID SEED_ACCOUNT_2 = UUID.fromString("10000000-0000-4000-8000-000000000001");

    private void insertTx(UUID id, String type, UUID source, UUID target, String amount, String status) {
        jdbc.update("insert into transactions (id, reference, transaction_type, status, source_account_id, target_account_id, amount, "
                        + "currency, submitted_by, funds_reserved, version, created_at, updated_at) values (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                id, "TXN-" + id.toString().substring(0, 12), type, status, source, target, new java.math.BigDecimal(amount), "USD",
                "schema-test", false, 0L, Timestamp.from(Instant.now()), Timestamp.from(Instant.now()));
    }

    @Test
    @DisplayName("a negative balance is impossible even with a direct UPDATE (overdraft guard)")
    void balanceCannotGoNegative() {
        assertThatThrownBy(() -> jdbc.update("update accounts set balance = -0.0001 where id = ?", SEED_ACCOUNT))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("transaction rows must match their type (deposit has a target only, transfer needs two different accounts)")
    void transactionShapeIsEnforced() {
        assertThatThrownBy(() -> insertTx(UUID.randomUUID(), "DEPOSIT", SEED_ACCOUNT, SEED_ACCOUNT_2, "1.00", "RECEIVED"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertTx(UUID.randomUUID(), "TRANSFER", SEED_ACCOUNT, SEED_ACCOUNT, "1.00", "RECEIVED"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertTx(UUID.randomUUID(), "WITHDRAWAL", SEED_ACCOUNT, null, "0.00", "RECEIVED"))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> insertTx(UUID.randomUUID(), "WITHDRAWAL", SEED_ACCOUNT, null, "1.00", "MADE_UP"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("the same idempotency key cannot be stored twice for a principal, but can for another")
    void idempotencyKeyIsUnique() {
        UUID tx1 = UUID.randomUUID();
        UUID tx2 = UUID.randomUUID();
        insertTx(tx1, "DEPOSIT", null, SEED_ACCOUNT, "1.00", "RECEIVED");
        insertTx(tx2, "DEPOSIT", null, SEED_ACCOUNT, "2.00", "RECEIVED");
        String sql = "insert into idempotency_records (id, principal, idempotency_key, request_hash, transaction_id, created_at) values (?,?,?,?,?,?)";
        String key = "schema-" + UUID.randomUUID();
        jdbc.update(sql, UUID.randomUUID(), "p1", key, "h", tx1, Timestamp.from(Instant.now()));
        assertThatThrownBy(() -> jdbc.update(sql, UUID.randomUUID(), "p1", key, "h", tx2, Timestamp.from(Instant.now())))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThat(jdbc.update(sql, UUID.randomUUID(), "p2", key, "h", tx2, Timestamp.from(Instant.now()))).isEqualTo(1);
    }

    @Test
    @DisplayName("a transaction can apply at most one ledger entry of a type per account (double-apply guard)")
    void ledgerEntriesAreUniquePerTransactionAccountType() {
        UUID tx = UUID.randomUUID();
        insertTx(tx, "DEPOSIT", null, SEED_ACCOUNT, "1.00", "COMPLETED");
        String sql = "insert into ledger_entries (transaction_id, account_id, entry_type, amount, balance_after, created_at) values (?,?,?,?,?,?)";
        jdbc.update(sql, tx, SEED_ACCOUNT, "CREDIT", new java.math.BigDecimal("1.00"), new java.math.BigDecimal("1.00"), Timestamp.from(Instant.now()));
        assertThatThrownBy(() -> jdbc.update(sql, tx, SEED_ACCOUNT, "CREDIT", new java.math.BigDecimal("1.00"),
                new java.math.BigDecimal("2.00"), Timestamp.from(Instant.now()))).isInstanceOf(DataIntegrityViolationException.class);
        // leave the books balanced for the integrity check used by other tests
        jdbc.update("delete from ledger_entries where transaction_id = ?", tx);
        jdbc.update("delete from transactions where id = ?", tx);
    }

    @Test
    @DisplayName("duplicate account numbers and customer e-mails are impossible")
    void naturalKeysAreUnique() {
        assertThatThrownBy(() -> jdbc.update("update accounts set account_number = 'ACC-1000000001' where id = ?", SEED_ACCOUNT))
                .isInstanceOf(DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("update customers set email = 'alice@example.test' where customer_ref = 'CUS-100002'"))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @DisplayName("Flyway applied every migration and the seed data is present")
    void migrationsApplied() {
        Long applied = jdbc.queryForObject("select count(*) from flyway_schema_history where success = true", Long.class);
        assertThat(applied).isGreaterThanOrEqualTo(3L); // V1, V2 (vendor) and the seed migration
        assertThat(jdbc.queryForObject("select count(*) from customers", Long.class)).isGreaterThanOrEqualTo(5L);
    }
}
