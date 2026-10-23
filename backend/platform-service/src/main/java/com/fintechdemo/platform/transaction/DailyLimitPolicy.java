package com.fintechdemo.platform.transaction;

import java.math.BigDecimal;

/**
 * Daily withdrawal limit rule: the sum of withdrawals in the rolling 24-hour window plus the requested amount must not
 * exceed the account's limit. Built test-first - see docs/testing/tdd-example.md.
 */
public final class DailyLimitPolicy {

    private DailyLimitPolicy() {
    }

    /**
     * @param dailyLimit       the account's daily limit (>= 0)
     * @param alreadyWithdrawn withdrawals in the rolling window that count against the limit
     * @param requested        the amount of the new withdrawal
     * @return true when accepting {@code requested} would take the total above {@code dailyLimit}
     */
    public static boolean wouldExceed(BigDecimal dailyLimit, BigDecimal alreadyWithdrawn, BigDecimal requested) {
        // compareTo, never equals: 1000.0 and 1000.0000 are the same amount of money
        return alreadyWithdrawn.add(requested).compareTo(dailyLimit) > 0;
    }
}
