package com.fintechdemo.platform.transaction;

import com.fintechdemo.platform.transaction.SupportRepositories.OutboxRepository;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OutboxService {

    public static final String TRANSACTION_VALIDATED = "TRANSACTION_VALIDATED";

    private final OutboxRepository outbox;
    private final Clock clock;

    public OutboxService(OutboxRepository outbox, Clock clock) {
        this.outbox = outbox;
        this.clock = clock;
    }

    /** MANDATORY: the event is only valid if it commits atomically with the state change that produced it. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void enqueue(String eventType, UUID transactionId, String payload) {
        outbox.save(new OutboxEvent("TRANSACTION", transactionId, eventType, payload, Instant.now(clock)));
    }
}
