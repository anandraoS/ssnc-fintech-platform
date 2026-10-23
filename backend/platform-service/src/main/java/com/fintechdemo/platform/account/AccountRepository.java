package com.fintechdemo.platform.account;

import jakarta.persistence.LockModeType;
import jakarta.persistence.QueryHint;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.QueryHints;
import org.springframework.data.repository.query.Param;

public interface AccountRepository extends JpaRepository<Account, UUID>, JpaSpecificationExecutor<Account> {

    /**
     * SELECT ... FOR UPDATE with a bounded wait (5s). A bounded wait turns a lock pile-up into a fast, retryable
     * failure instead of exhausting the connection pool.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @QueryHints(@QueryHint(name = "jakarta.persistence.lock.timeout", value = "5000"))
    @Query("select a from Account a where a.id = :id")
    Optional<Account> lockById(@Param("id") UUID id);

    List<Account> findByCustomerId(UUID customerId);

    @Query("select a.id from Account a where a.customerId = :customerId")
    List<UUID> findIdsByCustomerId(@Param("customerId") UUID customerId);

    @Query("select a.status as status, count(a) as total from Account a group by a.status")
    List<StatusCount> countByStatus();

    @Query("select a.currency as currency, sum(a.balance) as total from Account a where a.status <> 'CLOSED' group by a.currency")
    List<CurrencyTotal> totalBalanceByCurrency();

    @Query("select count(a) from Account a where a.id in :ids and a.status in :statuses")
    long countByIdInAndStatusIn(@Param("ids") Collection<UUID> ids, @Param("statuses") Collection<AccountStatus> statuses);

    interface StatusCount {
        AccountStatus getStatus();

        long getTotal();
    }

    interface CurrencyTotal {
        String getCurrency();

        BigDecimal getTotal();
    }
}
