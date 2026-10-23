# Production runbooks

Every alert in `observability/prometheus/alert-rules.yml` links to a section here (a validation check fails if one is missing).
General first steps for **any** incident: (1) acknowledge, note the time; (2) open the Grafana *Platform overview* dashboard and `GET /api/v1/ops/health`;
(3) find a representative failing request's **correlation id** and follow it through logs, trace and audit trail; (4) decide *stop the bleeding* (scale, roll back,
disable a feature, shed load) before *find the root cause*; (5) communicate; (6) write the post-incident review (template in this folder).

## Platform down
*Alert `PlatformServiceDown`, page.* **Symptoms:** Prometheus cannot scrape; readiness fails; users get 502/503 from the ingress.
1. `kubectl -n investment-platform get pods` / `describe pod` - `CrashLoopBackOff`, `OOMKilled`, `ImagePullBackOff`, failing probes?
2. `kubectl logs --previous` - startup failure causes seen so far: DB unreachable or wrong credentials; **Flyway validation failure** (a migration was edited after release); no `OIDC_ISSUER_URI` (the service fails closed on purpose).
3. A recent deploy? `kubectl rollout history` -> `kubectl rollout undo deployment/platform-service` (the previous version works against the current schema by the expand/contract rule).
4. Database down? see *Database outage* in `performance-troubleshooting.md`.
5. Verify: readiness green, `/ops/health` UP, outbox backlog drains, error rate back to baseline.

## Elevated 5xx
*Alert `HighServerErrorRate`, page.* 1. Dashboard: which `uri` and `status`? 2. Logs filtered by `level=ERROR` and the correlation id from a failing call (the 500 body contains only the id). 3. Common causes:
database connectivity/pool exhaustion (`ConnectionPoolSaturated`), lock timeouts (503 `LOCK_TIMEOUT`), a bad deploy, the clearing network (should surface as FAILED/RECONCILIATION states, *not* 5xx - if it does, that is a bug).
4. Mitigate: roll back the last release; scale out if CPU-bound; check the DB. 5. Add a regression test for the cause.

## Slow API
*Alert `HighApiLatencyP95`, ticket.* Follow the *Elevated API latency* flow in `performance-troubleshooting.md`: which endpoint (histogram by `uri`), DB time vs. app time (traces), slow SQL (`pg_stat_statements`), lock waits, pool wait (`hikaricp_connections_acquire_seconds`), GC pauses, CPU throttling, noisy neighbour.

## Reconciliation backlog
*Alert `ReconciliationBacklog`, ticket (open records for 15 min).* These are withdrawals whose external outcome is unknown; **customer funds are reserved, not lost**.
1. Operations console -> *Investigations -> Reconciliation* lists the records with the reason (`CLEARING_OUTCOME_UNKNOWN`, `PROCESSING_TIMEOUT`).
2. Is the clearing network reachable? `/ops/health` -> `clearing-network`. If the network is down the reconciler cannot ask; wait for recovery (it retries every 15 s).
3. If it is up and records persist: look up the reference in the network's own portal/tools. *Executed* -> resolve **"the network executed it"** (transaction completes). *Not executed* -> resolve **"not executed"** (funds returned).
4. You cannot resolve a transaction you submitted yourself (maker-checker): ask a colleague.
5. Record the decision in the resolution note; it is written to the audit trail.

## Dead-letter outbox events
*Alert `OutboxDeadLetters`, page.* Validated transactions are **not being processed** for the affected ids.
1. `GET /api/v1/ops/outbox?status=DEAD` (admin) shows `last_error` per event.
2. Fix the cause first (bug, data problem, dependency). Requeueing before fixing just dead-letters it again.
3. `POST /api/v1/ops/outbox/{id}/requeue`; watch `platform_outbox_backlog`. The processor is idempotent, so requeueing an event that was actually handled is harmless.
4. If the transaction itself is poisoned (bad data), cancel it (`/transactions/{id}/cancel` if still cancellable) or fail it through reconciliation, and file a defect.

## Outbox backlog
*Alert `OutboxBacklogGrowing`, page (> 100 pending for 5 min).* Work is arriving faster than it is processed (or the dispatcher is not running).
1. Is `app.processing.dispatcher-enabled` true in every pod? Are scheduled jobs failing (`ERROR Scheduled job 'outbox dispatch' failed`)?
2. Processing time per transaction (`platform_transactions_end_to_end_seconds`), DB latency, lock contention on a hot account (one popular account serialises its own transactions).
3. Scale out replicas (safe: lease + optimistic locking) - or run a dedicated worker deployment (ADR-001 migration path).
4. Last resort: `POST /ops/processing/drain` (admin) runs one synchronous pass.

## Transaction failures
*Alert `HighTransactionFailureRate`, page (> 10 % FAILED for 10 min).* Break down by `failureCode` in the dashboard/`/ops/summary` and the Investigations page:
`INSUFFICIENT_FUNDS` at processing time = normal contention; `CLEARING_DECLINED` = network policy/risk; `CLEARING_UNAVAILABLE` = network or circuit breaker (see next section); `*_NOT_ACTIVE` = account/customer status changes; anything else = defect.
Confirm refunds happened (`/ops/ledger-integrity` must be empty).

## Clearing network outage
*Alert `ClearingCircuitOpen`, page.* **Expected behaviour:** requests fail fast as `CLEARING_UNAVAILABLE` with funds returned; those already in flight become `RECONCILIATION_REQUIRED` (funds reserved) and resolve automatically after recovery.
1. Confirm at the provider's status page; check egress/DNS/VPN. 2. Do **not** restart the platform to "reset" the breaker - it half-opens by itself after 10 s and closes on success.
3. Communicate to support: withdrawals are failing safely, no customer money is lost, deposits and transfers are unaffected. 4. After recovery verify the reconciliation backlog drains and the ledger integrity check is empty.

## Connection pool exhaustion
*Alert `ConnectionPoolSaturated`, page (threads waiting for a connection).* 1. `hikaricp_connections_active == max`, `pending > 0`, acquire time rising. 2. **Why are connections held?** slow queries or long transactions (look at `pg_stat_activity` for `state = 'active'`/`idle in transaction`), lock waits (see the blocking-locks query in the database chapter), a connection leak (`leak-detection-threshold` logs a stack trace after 30 s), or genuine load.
3. Mitigate: kill the blocking session if safe; scale replicas *only if the database has headroom* (each replica adds `DB_POOL_MAX` connections); never raise the pool above what PostgreSQL can run concurrently. 4. Remember: an external call must never run inside a transaction (ADR-003) - if the pool saturates when the clearing network is slow, that rule has been broken.

## High memory
*Alert `JvmHeapHigh`, ticket.* 1. Is it growth (leak) or a high steady state? Look at the heap after GC (`jvm_memory_used_bytes` low points). 2. Heap dump on OOM is enabled (`-XX:+HeapDumpOnOutOfMemoryError`, `/tmp`); for a live pod use `jcmd <pid> GC.heap_dump` and open in Eclipse MAT: look for retained sets (large `ArrayList` of entities from an unbounded query, caches, `ThreadLocal`s).
3. Typical causes here: an unpaged query, a huge page size, an unbounded map (the rate limiter is bounded), large JSON in logs. 4. Mitigate with a rolling restart while the cause is fixed.

## Excessive GC
*Alert `LongGcPauses`, ticket.* 1. `jvm_gc_pause_seconds` by `cause`/`action`; G1 young pauses are normal, frequent **Full GC** or "to-space exhausted" are not. 2. Allocation rate vs. heap size (the pod memory limit of 768 MiB with `MaxRAMPercentage=75` leaves little room: raise the limit before tuning flags). 3. Check for allocation hot spots in a flight-recorder profile (`jcmd <pid> JFR.start duration=60s`). 4. Tune last (`-XX:MaxGCPauseMillis`), after reducing allocation.

## Operational how-tos
| Task | How |
|---|---|
| Rolling restart | `kubectl -n investment-platform rollout restart deployment/platform-service` |
| Roll back | `kubectl -n investment-platform rollout undo deployment/platform-service` |
| Scale | `kubectl scale deployment/platform-service --replicas=4` (the HPA will take over again) |
| See who did what | `GET /api/v1/ops/audit-events?entityId=<id>`; correlation id search in logs |
| Verify money integrity | `GET /api/v1/ops/ledger-integrity` must return `[]` |
| Suspend a misbehaving account | `POST /api/v1/accounts/{id}/suspend` with a reason (audited) |
