package com.fintechdemo.platform.account;

import java.util.EnumSet;
import java.util.Set;

/** Account lifecycle: PENDING_ACTIVATION -> ACTIVE <-> SUSPENDED, and ACTIVE/SUSPENDED/PENDING -> CLOSED (terminal). */
public enum AccountStatus {
    PENDING_ACTIVATION, ACTIVE, SUSPENDED, CLOSED;

    public Set<AccountStatus> allowedNext() {
        return switch (this) {
            case PENDING_ACTIVATION -> EnumSet.of(ACTIVE, CLOSED);
            case ACTIVE -> EnumSet.of(SUSPENDED, CLOSED);
            case SUSPENDED -> EnumSet.of(ACTIVE, CLOSED);
            case CLOSED -> EnumSet.noneOf(AccountStatus.class);
        };
    }

    public boolean canTransitionTo(AccountStatus next) {
        return allowedNext().contains(next);
    }
}
