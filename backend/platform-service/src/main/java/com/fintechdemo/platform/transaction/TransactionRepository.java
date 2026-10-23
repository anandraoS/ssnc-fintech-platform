package com.fintechdemo.platform.transaction;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface TransactionRepository extends JpaRepository<FinancialTransaction, UUID>,
        JpaSpecificationExecutor<FinancialTransaction> {

    /** Total of withdrawals counting against the daily limit for an account since {@code since}. */
    @Query("select coalesce(sum(t.amount), 0) from FinancialTransaction t "
            + "where t.sourceAccountId = :accountId and t.type = 'WITHDRAWAL' and t.createdAt >= :since "
            + "and t.status in :statuses and t.id <> :excludeId")
    BigDecimal sumWithdrawnSince(@Param("accountId") UUID accountId, @Param("since") Instant since,
                                 @Param("statuses") Collection<TransactionStatus> statuses,
                                 @Param("excludeId") UUID excludeId);

    @Query("select count(t) > 0 from FinancialTransaction t where (t.sourceAccountId = :accountId or t.targetAccountId = :accountId) "
            + "and t.status in :statuses")
    boolean existsInFlight(@Param("accountId") UUID accountId, @Param("statuses") Collection<TransactionStatus> statuses);

    List<FinancialTransaction> findByStatusAndUpdatedAtBefore(TransactionStatus status, Instant before, Pageable pageable);

    @Query("select t.status as status, count(t) as total from FinancialTransaction t group by t.status")
    List<StatusCount> countByStatus();

    @Query("select t.type as type, t.currency as currency, count(t) as total, sum(t.amount) as volume "
            + "from FinancialTransaction t where t.createdAt >= :since and t.status = 'COMPLETED' group by t.type, t.currency")
    List<VolumeRow> completedVolumeSince(@Param("since") Instant since);

    @Query("select count(t) from FinancialTransaction t where t.createdAt >= :since and t.status = :status")
    long countSince(@Param("since") Instant since, @Param("status") TransactionStatus status);

    @Query("select t from FinancialTransaction t where t.status = 'COMPLETED' and t.completedAt is not null order by t.completedAt desc")
    List<FinancialTransaction> recentlyCompleted(Pageable pageable);

    interface StatusCount {
        TransactionStatus getStatus();

        long getTotal();
    }

    interface VolumeRow {
        TransactionType getType();

        String getCurrency();

        long getTotal();

        BigDecimal getVolume();
    }
}
