package com.fintechdemo.platform.transaction;

import com.fintechdemo.platform.audit.AuditService;
import com.fintechdemo.platform.common.ApiException;
import com.fintechdemo.platform.security.AuthenticatedUser;
import com.fintechdemo.platform.transaction.SupportRepositories.OutboxRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Polls the transactional outbox and delivers events to their handler (at-least-once).
 * <ul>
 *   <li><b>Claim by lease:</b> the claimer bumps {@code attempts} and pushes {@code available_at} into the future in a
 *       short transaction; the optimistic {@code @Version} makes two competing dispatchers collide, so only one wins.
 *       If the winner crashes, the lease expires and the event is delivered again (the handler is idempotent).</li>
 *   <li><b>Retry with exponential backoff</b> on failure; after {@code max-attempts} the event becomes DEAD
 *       (dead-letter) and needs an operator.</li>
 * </ul>
 */
@Service
public class OutboxDispatcher {

    private static final Logger log = LoggerFactory.getLogger(OutboxDispatcher.class);
    private static final Duration LEASE = Duration.ofSeconds(30);
    private static final Duration MAX_BACKOFF = Duration.ofMinutes(5);

    private final OutboxRepository outbox;
    private final TransactionProcessor processor;
    private final ProcessingProperties props;
    private final AuditService audit;
    private final TransactionTemplate tt;
    private final TransactionTemplate readTt;
    private final Clock clock;

    public OutboxDispatcher(OutboxRepository outbox, TransactionProcessor processor, ProcessingProperties props,
                            AuditService audit, TransactionTemplate transactionTemplate,
                            TransactionTemplate readOnlyTransactionTemplate, Clock clock) {
        this.outbox = outbox;
        this.processor = processor;
        this.props = props;
        this.audit = audit;
        this.tt = transactionTemplate;
        this.readTt = readOnlyTransactionTemplate;
        this.clock = clock;
    }

    /** Delivers up to one batch; returns the number of events successfully handled. */
    public int drain() {
        List<UUID> due = readTt.execute(s -> outbox.findDueIds(Instant.now(clock), PageRequest.of(0, props.batchSize())));
        int handled = 0;
        for (UUID id : due == null ? List.<UUID>of() : due) {
            if (dispatch(id)) {
                handled++;
            }
        }
        return handled;
    }

    private boolean dispatch(UUID id) {
        OutboxEvent event;
        try {
            event = tt.execute(s -> {
                Instant now = Instant.now(clock);
                OutboxEvent e = outbox.findById(id).orElse(null);
                if (e == null || e.getStatus() != OutboxEvent.Status.NEW || e.getAvailableAt().isAfter(now)) {
                    return null;
                }
                e.lease(now.plus(LEASE));
                return outbox.saveAndFlush(e);
            });
        } catch (OptimisticLockingFailureException lostRace) {
            return false; // another dispatcher claimed it first
        }
        if (event == null) {
            return false;
        }
        try {
            handle(event);
            tt.executeWithoutResult(s -> outbox.findById(id).ifPresent(e -> e.markDispatched(Instant.now(clock))));
            return true;
        } catch (RuntimeException failure) {
            log.warn("Outbox event {} ({}) failed on attempt {}: {}", id, event.getEventType(), event.getAttempts(),
                    failure.toString());
            tt.executeWithoutResult(s -> outbox.findById(id).ifPresent(e -> {
                Instant now = Instant.now(clock);
                String error = failure.getClass().getSimpleName() + ": " + failure.getMessage();
                if (e.getAttempts() >= props.maxAttempts()) {
                    e.markDead(error, now);
                    audit.record(AuthenticatedUser.system("dispatcher"), "OUTBOX_EVENT_DEAD", "TRANSACTION",
                            e.getAggregateId(), "event=" + e.getEventType() + ", attempts=" + e.getAttempts());
                } else {
                    e.scheduleRetry(now.plus(backoff(e.getAttempts())), error);
                }
            }));
            return false;
        }
    }

    private void handle(OutboxEvent event) {
        if (OutboxService.TRANSACTION_VALIDATED.equals(event.getEventType())) {
            processor.process(event.getAggregateId());
            return;
        }
        throw new IllegalArgumentException("Unknown event type " + event.getEventType());
    }

    Duration backoff(int attempts) {
        long millis = props.backoffBase().toMillis() * (1L << Math.min(Math.max(attempts - 1, 0), 20));
        return Duration.ofMillis(Math.min(millis, MAX_BACKOFF.toMillis()));
    }

    /** Operator action: put a dead-lettered event back in the queue after the cause has been fixed. */
    public void requeue(UUID eventId, AuthenticatedUser actor) {
        tt.executeWithoutResult(s -> {
            OutboxEvent e = outbox.findById(eventId)
                    .orElseThrow(() -> ApiException.notFound("OUTBOX_EVENT_NOT_FOUND", "Outbox event not found"));
            if (e.getStatus() != OutboxEvent.Status.DEAD) {
                throw ApiException.conflict("INVALID_STATE", "Only dead-lettered events can be requeued");
            }
            e.requeue(Instant.now(clock));
            audit.record(actor, "OUTBOX_EVENT_REQUEUED", "TRANSACTION", e.getAggregateId(), "event=" + e.getEventType());
        });
    }
}
