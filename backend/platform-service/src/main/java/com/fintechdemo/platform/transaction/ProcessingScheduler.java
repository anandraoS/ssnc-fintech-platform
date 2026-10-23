package com.fintechdemo.platform.transaction;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Background loops. In a multi-instance deployment every instance runs them safely: the outbox claim is a lease with
 * optimistic locking, reconciliation resolves under @Version, and recovery re-checks status inside its transaction.
 */
@Component
public class ProcessingScheduler {

    private static final Logger log = LoggerFactory.getLogger(ProcessingScheduler.class);

    private final OutboxDispatcher dispatcher;
    private final ReconciliationService reconciliation;
    private final TransactionMaintenance maintenance;
    private final ProcessingProperties props;

    public ProcessingScheduler(OutboxDispatcher dispatcher, ReconciliationService reconciliation,
                               TransactionMaintenance maintenance, ProcessingProperties props) {
        this.dispatcher = dispatcher;
        this.reconciliation = reconciliation;
        this.maintenance = maintenance;
        this.props = props;
    }

    @Scheduled(fixedDelayString = "${app.processing.dispatcher-delay}", initialDelayString = "${app.processing.dispatcher-delay}")
    void dispatch() {
        if (props.dispatcherEnabled()) {
            guarded("outbox dispatch", this::drainWithinBudget);
        }
    }

    @Scheduled(fixedDelayString = "${app.processing.reconciler-delay}", initialDelayString = "${app.processing.reconciler-delay}")
    void reconcile() {
        if (props.reconcilerEnabled()) {
            guarded("reconciliation", reconciliation::autoReconcile);
        }
    }

    @Scheduled(fixedDelayString = "${app.processing.maintenance-delay}", initialDelayString = "${app.processing.maintenance-delay}")
    void maintain() {
        if (props.reconcilerEnabled()) {
            guarded("stuck recovery", maintenance::recoverStuckProcessing);
            guarded("idempotency purge", maintenance::purgeExpiredIdempotencyRecords);
        }
    }

    /**
     * Work-conserving loop: keep taking batches while there is work (bounded by a time budget so the scheduler thread is
     * shared fairly), instead of handling one batch per tick. Measured effect: docs/validation/perf-baseline*.json.
     */
    private int drainWithinBudget() {
        long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
        int total = 0;
        int handled;
        do {
            handled = dispatcher.drain();
            total += handled;
        } while (handled > 0 && System.nanoTime() < deadline);
        return total;
    }

    private void guarded(String name, java.util.function.IntSupplier job) {
        try {
            int n = job.getAsInt();
            if (n > 0) {
                log.info("{}: handled {}", name, n);
            }
        } catch (RuntimeException e) {
            log.error("Scheduled job '{}' failed; will retry on next tick", name, e);
        }
    }
}
