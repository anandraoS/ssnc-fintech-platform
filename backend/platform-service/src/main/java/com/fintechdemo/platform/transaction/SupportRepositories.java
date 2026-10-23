package com.fintechdemo.platform.transaction;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** Small repositories for the transaction module's supporting tables. */
public final class SupportRepositories {

    private SupportRepositories() {
    }

    public interface IdempotencyRepository extends JpaRepository<IdempotencyRecord, UUID> {

        @Query("select r from IdempotencyRecord r where r.principal = :principal and r.key = :key")
        Optional<IdempotencyRecord> find(@Param("principal") String principal, @Param("key") String key);

        @Modifying
        @Query("delete from IdempotencyRecord r where r.createdAt < :before")
        int deleteOlderThan(@Param("before") Instant before);
    }

    public interface AttemptRepository extends JpaRepository<TransactionAttempt, Long> {

        List<TransactionAttempt> findByTransactionIdOrderByAttemptNoAsc(UUID transactionId);

        int countByTransactionId(UUID transactionId);
    }

    public interface LedgerRepository extends JpaRepository<LedgerEntry, Long> {

        Page<LedgerEntry> findByAccountId(UUID accountId, Pageable pageable);

        boolean existsByTransactionIdAndAccountIdAndEntryType(UUID transactionId, UUID accountId, LedgerEntry.Type entryType);

        /** Accounts whose stored balance differs from the signed sum of their ledger entries (should always be empty). */
        @Query("select a.id as accountId, a.accountNumber as accountNumber, a.balance as balance, "
                + "coalesce(sum(case when e.entryType = com.fintechdemo.platform.transaction.LedgerEntry.Type.DEBIT "
                + "then 0 - e.amount else e.amount end), 0) as ledgerSum "
                + "from Account a left join LedgerEntry e on e.accountId = a.id "
                + "group by a.id, a.accountNumber, a.balance "
                + "having a.balance <> coalesce(sum(case when e.entryType = com.fintechdemo.platform.transaction.LedgerEntry.Type.DEBIT "
                + "then 0 - e.amount else e.amount end), 0)")
        List<IntegrityRow> findIntegrityViolations();
    }

    public interface IntegrityRow {
        UUID getAccountId();

        String getAccountNumber();

        BigDecimal getBalance();

        BigDecimal getLedgerSum();
    }

    public interface ReconciliationRepository extends JpaRepository<ReconciliationRecord, UUID> {

        List<ReconciliationRecord> findByStatusOrderByOpenedAtAsc(ReconciliationRecord.Status status, Pageable pageable);

        Page<ReconciliationRecord> findByStatus(ReconciliationRecord.Status status, Pageable pageable);

        Optional<ReconciliationRecord> findFirstByTransactionIdAndStatus(UUID transactionId, ReconciliationRecord.Status status);

        long countByStatus(ReconciliationRecord.Status status);
    }

    public interface OutboxRepository extends JpaRepository<OutboxEvent, UUID> {

        @Query("select e.id from OutboxEvent e where e.status = 'NEW' and e.availableAt <= :now order by e.createdAt asc")
        List<UUID> findDueIds(@Param("now") Instant now, Pageable pageable);

        long countByStatus(OutboxEvent.Status status);

        Page<OutboxEvent> findByStatus(OutboxEvent.Status status, Pageable pageable);
    }
}
