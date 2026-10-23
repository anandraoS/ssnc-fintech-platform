package com.fintechdemo.platform.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Written FIRST (TDD red phase) for the "daily withdrawal limit" feature.
 * Acceptance criteria: docs/testing/tdd-example.md.
 */
class DailyLimitPolicyTest {

    private static BigDecimal d(String v) {
        return new BigDecimal(v);
    }

    @Test
    @DisplayName("a withdrawal below the remaining allowance is allowed")
    void belowLimitIsAllowed() {
        assertThat(DailyLimitPolicy.wouldExceed(d("1000.00"), d("0.00"), d("999.99"))).isFalse();
    }

    @Test
    @DisplayName("a withdrawal that exactly reaches the limit is allowed")
    void exactlyAtLimitIsAllowed() {
        assertThat(DailyLimitPolicy.wouldExceed(d("1000.00"), d("400.00"), d("600.00"))).isFalse();
    }

    @Test
    @DisplayName("one cent over the limit is rejected")
    void oneCentOverIsRejected() {
        assertThat(DailyLimitPolicy.wouldExceed(d("1000.00"), d("400.00"), d("600.01"))).isTrue();
    }

    @Test
    @DisplayName("earlier withdrawals in the window count against the limit")
    void cumulativeWithdrawalsCount() {
        assertThat(DailyLimitPolicy.wouldExceed(d("1000.00"), d("950.00"), d("100.00"))).isTrue();
    }

    @Test
    @DisplayName("a zero limit blocks every withdrawal")
    void zeroLimitBlocksEverything() {
        assertThat(DailyLimitPolicy.wouldExceed(d("0.00"), d("0.00"), d("0.01"))).isTrue();
    }

    @Test
    @DisplayName("comparison ignores BigDecimal scale (1000.0 equals 1000.0000)")
    void scaleDoesNotMatter() {
        assertThat(DailyLimitPolicy.wouldExceed(d("1000.0"), d("0"), d("1000.0000"))).isFalse();
    }
}
