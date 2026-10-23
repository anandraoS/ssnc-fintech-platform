package com.fintechdemo.platform.transaction;

import com.fintechdemo.platform.support.EmbeddedPg;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** Every BDD acceptance scenario of TransactionFlowIT, executed on a REAL PostgreSQL 16 (embedded, no Docker). */
class PostgresFlowIT extends TransactionFlowIT {

    @DynamicPropertySource
    static void postgres(DynamicPropertyRegistry registry) {
        EmbeddedPg.register(registry);
    }
}
