package com.fintechdemo.platform.common;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Currency;
import java.util.Set;

/**
 * Single place that defines how money is represented and rounded.
 * <ul>
 *   <li>Always {@link BigDecimal}, never float/double.</li>
 *   <li>Storage scale is 4 (NUMERIC(19,4)); presentation scale is the currency's minor-unit digits.</li>
 *   <li>Customer input with more fractional digits than the currency allows is REJECTED, not silently rounded.</li>
 *   <li>Where rounding is unavoidable the policy is HALF_EVEN (banker's rounding) to avoid systematic bias.</li>
 *   <li>Comparisons use {@code compareTo}; {@code equals} is scale-sensitive (2.0 != 2.00).</li>
 * </ul>
 */
public final class MoneyPolicy {

    public static final int STORAGE_SCALE = 4;
    public static final RoundingMode ROUNDING = RoundingMode.HALF_EVEN;
    private static final Set<String> SUPPORTED = Set.of("USD", "EUR", "GBP", "INR");

    private MoneyPolicy() {
    }

    public static boolean isSupported(String currency) {
        return currency != null && SUPPORTED.contains(currency);
    }

    public static Set<String> supportedCurrencies() {
        return SUPPORTED;
    }

    /** Number of fractional digits of the currency (2 for USD/EUR/GBP/INR). */
    public static int minorUnits(String currency) {
        if (!isSupported(currency)) {
            throw new IllegalArgumentException("Unsupported currency: " + currency);
        }
        return Currency.getInstance(currency).getDefaultFractionDigits();
    }

    /** True when the amount has no more fractional digits than the currency permits (trailing zeros ignored). */
    public static boolean hasValidPrecision(BigDecimal amount, String currency) {
        return amount.stripTrailingZeros().scale() <= minorUnits(currency);
    }

    /** Normalizes to the storage scale. Only call this after precision was validated. */
    public static BigDecimal toStorage(BigDecimal amount) {
        return amount.setScale(STORAGE_SCALE, ROUNDING);
    }

    /** Scale used in API responses (currency minor units). Exact for any amount that passed validation. */
    public static BigDecimal toDisplay(BigDecimal amount, String currency) {
        return amount.setScale(minorUnits(currency), ROUNDING);
    }

    /** Money-safe percentage (basis points), rounded HALF_EVEN to the currency's minor units. */
    public static BigDecimal percentageOf(BigDecimal base, int basisPoints, String currency) {
        return base.multiply(BigDecimal.valueOf(basisPoints))
                .divide(BigDecimal.valueOf(10_000), minorUnits(currency), ROUNDING);
    }

    /**
     * Splits an amount into {@code parts} shares without losing or creating a cent: the remainder cents are
     * distributed one by one from the first share. Sum of shares always equals the input.
     */
    public static java.util.List<BigDecimal> allocate(BigDecimal amount, int parts, String currency) {
        if (parts <= 0) {
            throw new IllegalArgumentException("parts must be positive");
        }
        int scale = minorUnits(currency);
        BigDecimal unit = BigDecimal.ONE.movePointLeft(scale);
        BigDecimal base = amount.divide(BigDecimal.valueOf(parts), scale, RoundingMode.DOWN);
        BigDecimal remainder = amount.subtract(base.multiply(BigDecimal.valueOf(parts)));
        int extraUnits = remainder.divide(unit, 0, RoundingMode.UNNECESSARY).intValueExact();
        java.util.List<BigDecimal> shares = new java.util.ArrayList<>(parts);
        for (int i = 0; i < parts; i++) {
            shares.add(i < extraUnits ? base.add(unit) : base);
        }
        return shares;
    }
}
