package com.fintechdemo.platform.transaction;

import com.fintechdemo.platform.support.EmbeddedPg;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/**
 * The race-condition scenarios (concurrent withdrawals, daily limit, opposing transfers, deposits, duplicate delivery)
 * on a REAL PostgreSQL 16 - real row locks and MVCC - without needing Docker.
 */
class PostgresConcurrencyIT extends ConcurrencyScenarios {

    @DynamicPropertySource
    static void postgres(DynamicPropertyRegistry registry) {
        EmbeddedPg.register(registry);
    }
}
