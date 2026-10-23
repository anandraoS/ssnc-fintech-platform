package com.fintechdemo.platform.account;

import java.util.UUID;

/**
 * Port implemented by the transaction module: the account module asks "is anything still in flight?" without
 * depending on transaction persistence (keeps the module dependency one-directional: transaction -> account).
 */
public interface AccountClosureGuard {

    boolean hasInFlightTransactions(UUID accountId);
}
