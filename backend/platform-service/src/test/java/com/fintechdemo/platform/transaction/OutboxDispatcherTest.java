package com.fintechdemo.platform.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fintechdemo.platform.audit.AuditService;
import com.fintechdemo.platform.support.NoOpTransactions;
import com.fintechdemo.platform.transaction.SupportRepositories.OutboxRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.orm.ObjectOptimisticLockingFailureException;

class OutboxDispatcherTest {

    private static final Instant NOW = Instant.parse("2026-01-01T00:00:00Z");
    private OutboxRepository outbox;
    private TransactionProcessor processor;
    private AuditService audit;
    private OutboxDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        outbox = mock(OutboxRepository.class);
        processor = mock(TransactionProcessor.class);
        audit = mock(AuditService.class);
        ProcessingProperties props = new ProcessingProperties(true, Duration.ofMillis(500), 10, 3, Duration.ofSeconds(2),
                Duration.ofMinutes(5), true, Duration.ofSeconds(15), Duration.ofSeconds(30), Duration.ofHours(1));
        dispatcher = new OutboxDispatcher(outbox, processor, props, audit, NoOpTransactions.template(),
                NoOpTransactions.template(), Clock.fixed(NOW, ZoneOffset.UTC));
    }

    private OutboxEvent event(String type) {
        OutboxEvent e = new OutboxEvent("TRANSACTION", UUID.randomUUID(), type, "{}", NOW.minusSeconds(10));
        when(outbox.findDueIds(any(), any())).thenReturn(List.of(e.getId()));
        when(outbox.findById(e.getId())).thenReturn(Optional.of(e));
        when(outbox.saveAndFlush(any())).thenAnswer(inv -> inv.getArgument(0));
        return e;
    }

    @Test
    void successfulDeliveryMarksTheEventDispatched() {
        OutboxEvent e = event(OutboxService.TRANSACTION_VALIDATED);
        assertThat(dispatcher.drain()).isEqualTo(1);
        verify(processor).process(e.getAggregateId());
        assertThat(e.getStatus()).isEqualTo(OutboxEvent.Status.DISPATCHED);
        assertThat(e.getAttempts()).isEqualTo(1);
    }

    @Test
    @DisplayName("a failed delivery is rescheduled with backoff while attempts remain")
    void failureIsRetriedLater() {
        OutboxEvent e = event(OutboxService.TRANSACTION_VALIDATED);
        doThrow(new IllegalStateException("db down")).when(processor).process(e.getAggregateId());
        assertThat(dispatcher.drain()).isZero();
        assertThat(e.getStatus()).isEqualTo(OutboxEvent.Status.NEW);
        assertThat(e.getAvailableAt()).isEqualTo(NOW.plus(Duration.ofSeconds(2))); // base * 2^0
        assertThat(e.getLastError()).contains("db down");
        verify(audit, never()).record(any(), anyString(), anyString(), any(), any());
    }

    @Test
    @DisplayName("after max attempts the event is dead-lettered and audited")
    void poisonEventBecomesDead() {
        OutboxEvent e = event(OutboxService.TRANSACTION_VALIDATED);
        doThrow(new IllegalStateException("boom")).when(processor).process(e.getAggregateId());
        for (int i = 0; i < 3; i++) {
            e.scheduleRetry(NOW.minusSeconds(1), null); // make it due again, as time would
            dispatcher.drain();
        }
        assertThat(e.getStatus()).isEqualTo(OutboxEvent.Status.DEAD);
        assertThat(e.getAttempts()).isEqualTo(3);
        verify(audit).record(any(), eq("OUTBOX_EVENT_DEAD"), eq("TRANSACTION"), eq(e.getAggregateId()), anyString());
    }

    @Test
    void unknownEventTypesAreNotSilentlyDropped() {
        OutboxEvent e = event("SOMETHING_NEW");
        dispatcher.drain();
        assertThat(e.getStatus()).isEqualTo(OutboxEvent.Status.NEW);
        assertThat(e.getLastError()).contains("Unknown event type");
        verify(processor, never()).process(any());
    }

    @Test
    @DisplayName("losing the claim race (optimistic lock) means another dispatcher owns the event: do nothing")
    void lostClaimRaceIsIgnored() {
        OutboxEvent e = event(OutboxService.TRANSACTION_VALIDATED);
        when(outbox.saveAndFlush(any())).thenThrow(new ObjectOptimisticLockingFailureException(OutboxEvent.class, e.getId()));
        assertThat(dispatcher.drain()).isZero();
        verify(processor, never()).process(any());
    }

    @Test
    void eventsStillLeasedByAnotherWorkerAreSkipped() {
        OutboxEvent e = event(OutboxService.TRANSACTION_VALIDATED);
        e.lease(NOW.plusSeconds(30)); // another worker holds the lease
        assertThat(dispatcher.drain()).isZero();
        verify(processor, never()).process(any());
    }

    @Test
    void backoffDoublesAndIsCapped() {
        assertThat(dispatcher.backoff(1)).isEqualTo(Duration.ofSeconds(2));
        assertThat(dispatcher.backoff(2)).isEqualTo(Duration.ofSeconds(4));
        assertThat(dispatcher.backoff(3)).isEqualTo(Duration.ofSeconds(8));
        assertThat(dispatcher.backoff(30)).isEqualTo(Duration.ofMinutes(5));
    }
}
