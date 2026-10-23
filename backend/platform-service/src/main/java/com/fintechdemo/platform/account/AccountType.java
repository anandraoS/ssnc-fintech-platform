package com.fintechdemo.platform.account;

import java.math.BigDecimal;

/** Account products with their default policy values (synthetic amounts, currency-agnostic). */
public enum AccountType {
    BROKERAGE("0.00", "10000.00"),
    RETIREMENT("0.00", "2000.00"),
    MONEY_MARKET("100.00", "5000.00");

    private final BigDecimal minimumBalance;
    private final BigDecimal defaultDailyWithdrawalLimit;

    AccountType(String minimumBalance, String defaultDailyWithdrawalLimit) {
        this.minimumBalance = new BigDecimal(minimumBalance);
        this.defaultDailyWithdrawalLimit = new BigDecimal(defaultDailyWithdrawalLimit);
    }

    public BigDecimal minimumBalance() {
        return minimumBalance;
    }

    public BigDecimal defaultDailyWithdrawalLimit() {
        return defaultDailyWithdrawalLimit;
    }
}
