package com.fintechdemo.platform.transaction;

import java.util.EnumSet;
import java.util.Set;

/**
 * Transaction lifecycle. The only legal moves are the ones listed in {@link #allowedNext()}; everything else is a
 * programming error or a concurrent-modification attempt and is rejected by {@code FinancialTransaction#transitionTo}.
 * <pre>
 * RECEIVED -> VALIDATED -> PROCESSING -> COMPLETED
 *    |            |            |-> FAILED
 *    |            |            '-> RECONCILIATION_REQUIRED -> COMPLETED | FAILED
 *    |-> PENDING_REVIEW -> VALIDATED | REJECTED | CANCELLED
 *    |-> REJECTED
 *    '-> CANCELLED   (also from VALIDATED)
 * </pre>
 */
public enum TransactionStatus {
    RECEIVED, VALIDATED, PROCESSING, COMPLETED, REJECTED, FAILED, PENDING_REVIEW, RECONCILIATION_REQUIRED, CANCELLED;

    public Set<TransactionStatus> allowedNext() {
        return switch (this) {
            case RECEIVED -> EnumSet.of(VALIDATED, PENDING_REVIEW, REJECTED, CANCELLED);
            case VALIDATED -> EnumSet.of(PROCESSING, CANCELLED);
            case PENDING_REVIEW -> EnumSet.of(VALIDATED, REJECTED, CANCELLED);
            case PROCESSING -> EnumSet.of(COMPLETED, FAILED, RECONCILIATION_REQUIRED);
            case RECONCILIATION_REQUIRED -> EnumSet.of(COMPLETED, FAILED);
            case COMPLETED, REJECTED, FAILED, CANCELLED -> EnumSet.noneOf(TransactionStatus.class);
        };
    }

    public boolean canTransitionTo(TransactionStatus next) {
        return allowedNext().contains(next);
    }

    public boolean isTerminal() {
        return allowedNext().isEmpty();
    }

    /** Cancellation is only valid before processing starts. */
    public boolean isCancellable() {
        return canTransitionTo(CANCELLED);
    }

    public static Set<TransactionStatus> inFlight() {
        EnumSet<TransactionStatus> set = EnumSet.noneOf(TransactionStatus.class);
        for (TransactionStatus s : values()) {
            if (!s.isTerminal()) {
                set.add(s);
            }
        }
        return set;
    }
}
