package com.fintechdemo.platform.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static com.fintechdemo.platform.transaction.TransactionStatus.*;

import com.fintechdemo.platform.common.ApiException;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The state machine written out independently of the implementation, then compared pair by pair. */
class TransactionStatusTest {

    private static final Map<TransactionStatus, Set<TransactionStatus>> EXPECTED = Map.of(
            RECEIVED, EnumSet.of(VALIDATED, PENDING_REVIEW, REJECTED, CANCELLED),
            VALIDATED, EnumSet.of(PROCESSING, CANCELLED),
            PENDING_REVIEW, EnumSet.of(VALIDATED, REJECTED, CANCELLED),
            PROCESSING, EnumSet.of(COMPLETED, FAILED, RECONCILIATION_REQUIRED),
            RECONCILIATION_REQUIRED, EnumSet.of(COMPLETED, FAILED),
            COMPLETED, EnumSet.noneOf(TransactionStatus.class),
            REJECTED, EnumSet.noneOf(TransactionStatus.class),
            FAILED, EnumSet.noneOf(TransactionStatus.class),
            CANCELLED, EnumSet.noneOf(TransactionStatus.class));

    @Test
    @DisplayName("every one of the 81 (from,to) pairs behaves as specified")
    void fullTransitionMatrix() {
        for (TransactionStatus from : values()) {
            for (TransactionStatus to : values()) {
                assertThat(from.canTransitionTo(to)).as("%s -> %s", from, to).isEqualTo(EXPECTED.get(from).contains(to));
            }
        }
    }

    @Test
    void terminalStatesAreExactlyTheFinalOnes() {
        assertThat(values()).filteredOn(TransactionStatus::isTerminal).containsExactlyInAnyOrder(COMPLETED, REJECTED, FAILED, CANCELLED);
        assertThat(TransactionStatus.inFlight()).containsExactlyInAnyOrder(RECEIVED, VALIDATED, PROCESSING, PENDING_REVIEW,
                RECONCILIATION_REQUIRED);
    }

    @Test
    void cancellationIsOnlyValidBeforeProcessing() {
        assertThat(values()).filteredOn(TransactionStatus::isCancellable)
                .containsExactlyInAnyOrder(RECEIVED, VALIDATED, PENDING_REVIEW);
    }

    private FinancialTransaction newTx() {
        return new FinancialTransaction(UUID.randomUUID(), "TXN-TEST", TransactionType.DEPOSIT, null, UUID.randomUUID(),
                new BigDecimal("1.0000"), "USD", null, "tester", Instant.EPOCH);
    }

    @Test
    @DisplayName("the entity refuses an illegal move with a 409 and keeps its state")
    void entityRejectsIllegalTransition() {
        FinancialTransaction tx = newTx();
        assertThatThrownBy(() -> tx.transitionTo(COMPLETED, Instant.now()))
                .isInstanceOfSatisfying(ApiException.class, e -> {
                    assertThat(e.getCode()).isEqualTo("INVALID_STATE_TRANSITION");
                    assertThat(e.getStatus().value()).isEqualTo(409);
                });
        assertThat(tx.getStatus()).isEqualTo(RECEIVED);
    }

    @Test
    void entityWalksTheHappyPathAndStampsCompletion() {
        FinancialTransaction tx = newTx();
        tx.transitionTo(VALIDATED, Instant.parse("2026-01-01T00:00:00Z"));
        tx.transitionTo(PROCESSING, Instant.parse("2026-01-01T00:00:01Z"));
        assertThat(tx.getCompletedAt()).isNull();
        tx.transitionTo(COMPLETED, Instant.parse("2026-01-01T00:00:02Z"));
        assertThat(tx.getCompletedAt()).isEqualTo(Instant.parse("2026-01-01T00:00:02Z"));
        assertThatThrownBy(() -> tx.transitionTo(FAILED, Instant.now())).isInstanceOf(ApiException.class);
    }
}
