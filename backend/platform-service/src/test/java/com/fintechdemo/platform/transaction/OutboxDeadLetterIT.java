package com.fintechdemo.platform.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import com.fintechdemo.platform.support.AbstractIntegrationTest;
import com.fintechdemo.platform.transaction.SupportRepositories.OutboxRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

class OutboxDeadLetterIT extends AbstractIntegrationTest {

    @Autowired OutboxRepository outbox;
    @Autowired @org.springframework.beans.factory.annotation.Qualifier("transactionTemplate") TransactionTemplate tt;

    @Test
    @DisplayName("Scenario: a poison event is retried with backoff, dead-lettered, then requeued by an admin")
    void poisonEventIsDeadLetteredAndCanBeRequeued() throws Exception {
        OutboxEvent poison = tt.execute(s -> outbox.save(new OutboxEvent("TRANSACTION", UUID.randomUUID(), "UNKNOWN_EVENT",
                "{}", Instant.now())));
        UUID id = poison.getId();

        for (int i = 0; i < 6 && outbox.findById(id).orElseThrow().getStatus() == OutboxEvent.Status.NEW; i++) {
            dispatcher.drain();
            Thread.sleep(15); // backoff base is 1 ms in the test profile
        }
        OutboxEvent dead = outbox.findById(id).orElseThrow();
        assertThat(dead.getStatus()).isEqualTo(OutboxEvent.Status.DEAD);
        assertThat(dead.getAttempts()).isEqualTo(3);
        assertThat(dead.getLastError()).contains("Unknown event type");
        assertThat(countAudit("OUTBOX_EVENT_DEAD", dead.getAggregateId().toString())).isEqualTo(1);

        // visible to administrators, hidden from operations analysts
        assertThat(get("/api/v1/ops/outbox?status=DEAD&size=100", admin()).body().toString()).contains(id.toString());
        assertThat(get("/api/v1/ops/health", support()).body().toString()).contains("dead-lettered=");

        Reply requeue = post("/api/v1/ops/outbox/" + id + "/requeue", admin(), "{}");
        assertThat(requeue.status()).isEqualTo(204);
        assertThat(outbox.findById(id).orElseThrow().getStatus()).isEqualTo(OutboxEvent.Status.NEW);
        // requeueing something that is not dead is refused
        assertThat(post("/api/v1/ops/outbox/" + id + "/requeue", admin(), "{}").status()).isEqualTo(409);

        // clean up so other tests see a healthy outbox
        for (int i = 0; i < 6 && outbox.findById(id).orElseThrow().getStatus() != OutboxEvent.Status.DEAD; i++) {
            dispatcher.drain();
            Thread.sleep(15);
        }
        tt.executeWithoutResult(s -> outbox.deleteById(id));
    }

    @Test
    @DisplayName("Scenario: the outbox record is written atomically with the transaction it announces")
    void outboxEventIsWrittenWithTheStateChange() throws Exception {
        UUID account = fundedAccount(ALICE, "USD", "50.00");
        Reply r = submit(alice(), "WITHDRAWAL", account, null, "5.00", "USD");
        Long events = jdbc.queryForObject("select count(*) from outbox_events where aggregate_id = ? and status = 'NEW'",
                Long.class, UUID.fromString(r.text("id")));
        assertThat(events).isEqualTo(1L);
        // a REJECTED transaction announces nothing
        Reply rejected = submit(alice(), "WITHDRAWAL", account, null, "5000.00", "USD");
        Long none = jdbc.queryForObject("select count(*) from outbox_events where aggregate_id = ?", Long.class,
                UUID.fromString(rejected.body().path("details").path("transactionId").asText()));
        assertThat(none).isZero();
        drain();
    }
}
