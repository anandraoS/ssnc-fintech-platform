package com.fintechdemo.platform.ops;

import com.fintechdemo.platform.transaction.SupportRepositories.OutboxRepository;
import com.fintechdemo.platform.transaction.SupportRepositories.ReconciliationRepository;
import com.fintechdemo.platform.clearing.ClearingClient;
import com.fintechdemo.platform.transaction.OutboxEvent;
import com.fintechdemo.platform.transaction.ReconciliationRecord;
import com.fintechdemo.platform.transaction.TransactionStatus;
import com.fintechdemo.platform.transaction.TransactionType;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import org.springframework.stereotype.Component;

/**
 * Business metrics exposed to Prometheus (names use dots; the Prometheus registry converts them to underscores):
 * <ul>
 *   <li>{@code platform.transactions.submitted} counter {type,result}</li>
 *   <li>{@code platform.transactions.finished} counter {type,status}</li>
 *   <li>{@code platform.transactions.end_to_end} timer {type} (submit to terminal state)</li>
 *   <li>{@code platform.reconciliation.open}, {@code platform.outbox.backlog}, {@code platform.outbox.dead} gauges</li>
 *   <li>{@code platform.clearing.circuit.open} gauge (1 when the breaker is not CLOSED)</li>
 * </ul>
 * Hikari pool, JVM, HTTP latency percentiles and error rates come from Spring Boot's auto-configured binders.
 */
@Component
public class PlatformMetrics {

    private final MeterRegistry registry;

    public PlatformMetrics(MeterRegistry registry, ReconciliationRepository reconciliation, OutboxRepository outbox,
                           ClearingClient clearing) {
        this.registry = registry;
        // gauges query the DB at scrape time - cheap COUNTs on indexed columns; cache or push if scrape rate grows
        Gauge.builder("platform.reconciliation.open", reconciliation,
                r -> r.countByStatus(ReconciliationRecord.Status.OPEN)).register(registry);
        Gauge.builder("platform.outbox.backlog", outbox, o -> o.countByStatus(OutboxEvent.Status.NEW)).register(registry);
        Gauge.builder("platform.outbox.dead", outbox, o -> o.countByStatus(OutboxEvent.Status.DEAD)).register(registry);
        Gauge.builder("platform.clearing.circuit.open", clearing, c -> "CLOSED".equals(c.circuitState())
                || "NOT_APPLICABLE".equals(c.circuitState()) ? 0 : 1).register(registry);
    }

    public void submitted(TransactionType type, String result) {
        registry.counter("platform.transactions.submitted", "type", type.name(), "result", result).increment();
    }

    public void finished(TransactionType type, TransactionStatus status, Duration endToEnd) {
        registry.counter("platform.transactions.finished", "type", type.name(), "status", status.name()).increment();
        if (endToEnd != null && !endToEnd.isNegative()) {
            Timer.builder("platform.transactions.end_to_end").tag("type", type.name())
                    .publishPercentileHistogram().register(registry).record(endToEnd);
        }
    }
}
