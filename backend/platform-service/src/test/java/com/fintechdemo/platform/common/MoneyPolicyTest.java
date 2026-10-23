package com.fintechdemo.platform.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class MoneyPolicyTest {

    @Test
    @DisplayName("float arithmetic is wrong for money; BigDecimal is exact")
    void whyNotDouble() {
        assertThat(0.1 + 0.2).isNotEqualTo(0.3);
        assertThat(new BigDecimal("0.1").add(new BigDecimal("0.2"))).isEqualByComparingTo("0.3");
    }

    @Test
    @DisplayName("precision beyond the currency's minor units is invalid (never silently rounded)")
    void precisionValidation() {
        assertThat(MoneyPolicy.hasValidPrecision(new BigDecimal("10.50"), "USD")).isTrue();
        assertThat(MoneyPolicy.hasValidPrecision(new BigDecimal("10.5000"), "USD")).isTrue(); // trailing zeros are harmless
        assertThat(MoneyPolicy.hasValidPrecision(new BigDecimal("10.505"), "USD")).isFalse();
        assertThat(MoneyPolicy.hasValidPrecision(new BigDecimal("10"), "INR")).isTrue();
    }

    @Test
    @DisplayName("storage scale is 4 and display scale follows the currency")
    void scales() {
        assertThat(MoneyPolicy.toStorage(new BigDecimal("12.5")).scale()).isEqualTo(4);
        assertThat(MoneyPolicy.toDisplay(new BigDecimal("12.5000"), "USD")).hasToString("12.50");
        assertThat(MoneyPolicy.minorUnits("EUR")).isEqualTo(2);
    }

    @Test
    @DisplayName("rounding is HALF_EVEN (banker's rounding): ties go to the even neighbour")
    void halfEven() {
        assertThat(new BigDecimal("2.345").setScale(2, MoneyPolicy.ROUNDING)).hasToString("2.34");
        assertThat(new BigDecimal("2.355").setScale(2, MoneyPolicy.ROUNDING)).hasToString("2.36");
        assertThat(MoneyPolicy.percentageOf(new BigDecimal("100.00"), 125, "USD")).hasToString("1.25"); // 1.25 %
        assertThat(MoneyPolicy.percentageOf(new BigDecimal("0.10"), 500, "USD")).hasToString("0.00");   // 0.005 is a tie -> even (0)
        assertThat(MoneyPolicy.percentageOf(new BigDecimal("0.30"), 500, "USD")).hasToString("0.02");   // 0.015 is a tie -> even (2)
    }

    @Test
    @DisplayName("equals() is scale-sensitive, compareTo() is not - money comparisons must use compareTo")
    void equalsVersusCompareTo() {
        assertThat(new BigDecimal("2.0").equals(new BigDecimal("2.00"))).isFalse();
        assertThat(new BigDecimal("2.0").compareTo(new BigDecimal("2.00"))).isZero();
    }

    @Test
    @DisplayName("allocation never loses or creates a cent")
    void allocate() {
        List<BigDecimal> shares = MoneyPolicy.allocate(new BigDecimal("100.00"), 3, "USD");
        assertThat(shares).containsExactly(new BigDecimal("33.34"), new BigDecimal("33.33"), new BigDecimal("33.33"));
        assertThat(shares.stream().reduce(BigDecimal.ZERO, BigDecimal::add)).isEqualByComparingTo("100.00");
        assertThat(MoneyPolicy.allocate(new BigDecimal("0.05"), 2, "USD")).containsExactly(new BigDecimal("0.03"), new BigDecimal("0.02"));
        assertThatThrownBy(() -> MoneyPolicy.allocate(BigDecimal.ONE, 0, "USD")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @DisplayName("only supported currencies are accepted")
    void currencies() {
        assertThat(MoneyPolicy.isSupported("USD")).isTrue();
        assertThat(MoneyPolicy.isSupported("JPY")).isFalse();
        assertThat(MoneyPolicy.isSupported(null)).isFalse();
        assertThatThrownBy(() -> MoneyPolicy.minorUnits("JPY")).isInstanceOf(IllegalArgumentException.class);
    }
}
