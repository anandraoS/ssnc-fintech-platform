# Performance and reliability investigation guide

General method: **observe -> hypothesise -> measure -> change one thing -> re-measure**. Start from the user-visible symptom (latency, errors), find the
saturated resource (CPU, memory, threads, connections, locks, I/O), then the code or query responsible. Never tune without a baseline; never claim an improvement without a
re-measurement (the repository's own example: the dispatcher change moved drain rate from ~23 to ~34 transactions/s on the *same* machine, measured in `docs/validation/perf-baseline*.json`).

## High JVM memory usage
1. Distinguish *footprint* from *leak*: heap-after-GC trend (`jvm_memory_used_bytes{area="heap"}` low points) rising across hours = leak; flat but high = under-sized.
2. Container view: `process_resident_memory` vs. the pod limit - heap is only part of RSS (metaspace, thread stacks, direct buffers, code cache). `MaxRAMPercentage=75` leaves 25 % for non-heap.
3. Evidence: heap dump (`jcmd <pid> GC.heap_dump /tmp/h.hprof`) -> Eclipse MAT "Leak suspects"/dominator tree. Typical findings in this kind of service: unbounded query results (`findAll()` without paging), caches without eviction, per-request objects held by static fields, large audit/log strings.
4. Fix, then verify by repeating the load while watching the heap-after-GC line.

## Excessive garbage collection
* Symptoms: `jvm_gc_pause_seconds_sum` rate high, latency spikes aligned with pauses, CPU in GC threads.
* Read the GC log (`-Xlog:gc*`) or the metric labels: frequent young collections = high allocation rate; Full GC / humongous allocations = heap too small or large arrays; "to-space exhausted" = evacuation failure.
* Order of action: reduce allocation (avoid per-request large collections, streaming instead of materialising, paging), right-size heap and pod, *then* consider collector flags. G1 is the default and is right for most services; ZGC/Shenandoah only with evidence of pause-bound latency SLOs.

## Thread starvation
* Symptoms: requests queue, CPU low, `jvm_threads_live` at the Tomcat max (`server.tomcat.threads.max` = 100), `http.server.requests` rising with flat throughput.
* Take 2-3 thread dumps 10 s apart (`jcmd <pid> Thread.print`); look for many threads `WAITING` on the same monitor, on a Hikari `getConnection`, or inside a remote call.
* Causes: pool exhaustion (threads wait for connections), a slow dependency without a timeout (every request thread blocks), synchronized sections, blocking calls on shared pools.
* Fixes: bounded timeouts everywhere (done: connect 500 ms / read 2 s / pool 3 s / lock 5 s), bulkheads (the asynchronous processor isolates the external call from request threads), right-size pools, virtual threads (`spring.threads.virtual.enabled`) only after pool limits are understood - they remove thread scarcity but not connection scarcity.

## Slow SQL
1. Find it: `pg_stat_statements` (mean/total time, calls), slow-query log (`log_min_duration_statement`), traces. 2. `EXPLAIN (ANALYZE, BUFFERS)` on the exact statement with real parameters. 3. Look for: sequential scans on large tables, `Rows Removed by Filter` >> rows returned, sorts spilling to disk, nested loops with huge outer sets, stale statistics (`ANALYZE`), bloat.
4. Fixes in order: correct predicate/index (composite order matching the filter then the sort), keyset pagination instead of deep `OFFSET`, split `OR` across indexes with `UNION ALL`, avoid N+1 (`default_batch_fetch_size`, fetch joins), cache only after the query is right. The captured plans in the database chapter show the OR-predicate trade-off concretely.

## Connection-pool exhaustion
See the runbook section; investigative questions: is `active == max` with `pending > 0`? what are the active sessions doing (`pg_stat_activity`)? are transactions held open across slow work (the anti-pattern ADR-003 forbids)? is the pool size justified (concurrent DB capacity, not request volume)? Enable `leak-detection-threshold`; track `hikaricp_connections_acquire_seconds` p95 as an early warning (it rises before errors appear).

## Lock contention
* Symptoms: latency that grows with concurrency on the *same* account, `LOCK_TIMEOUT` 503s, long `Lock` waits in `pg_stat_activity`.
* Find the head of the chain with the blocking-locks query (database chapter); examine what the lock holder is doing - a lock should be held for milliseconds. Long holders = work done inside the transaction that should not be (external call, large computation, user think time).
* Remedies: shorten the critical section, move non-essential work (audit enrichment, notifications) out, reduce hot-row contention (per-account serial processing is inherent; a hot "house" account needs a different design such as sharded counters or batching), keep lock order consistent, keep lock waits bounded.

## Elevated API latency
Top-down: (1) which endpoint (`http_server_requests` by `uri`); (2) percentile vs. average (a fat tail = queuing or GC; uniformly slow = work per request); (3) trace: where is the time - DB, external call, application; (4) saturation signals - pool pending, threads, CPU throttling (a CPU **limit** causes throttling; the manifests set none for that reason), GC; (5) recent change / traffic shape; (6) fix and re-measure. USE (utilisation, saturation, errors) for resources, RED (rate, errors, duration) for endpoints.

## Database outage
Expected behaviour: connections fail within 3 s, readiness fails (traffic drains from the pod), requests return 5xx/503 quickly, **no data is lost** (the outbox lives in the database; submitted-but-unprocessed work resumes). On recovery Hikari reconnects, the dispatcher resumes, stuck `PROCESSING` rows move to reconciliation after 5 minutes. Procedure: confirm at the provider (RDS events), fail over (Multi-AZ is automatic), watch connection storms on recovery (jittered reconnects; the pool is capped), verify ledger integrity and the outbox backlog. Practise with a game day (stop PostgreSQL in the test environment).

## Partial service failures
The clearing network is the partial-failure case: **slow** (latency up, circuit may open), **flaky** (retries with jitter absorb it), **down** (breaker open -> fast `CLEARING_UNAVAILABLE`), **lying by omission** (timeouts -> `RECONCILIATION_REQUIRED`). The chaos end-to-end scenario (`e2e-api.mjs --with-chaos`) exercises all four against the simulator. Design questions to ask of any dependency: what is its timeout, is the call idempotent, what does the caller do on *unknown*, is there a fast-fail path, and who gets paged?

## Measured results versus targets
Only `docs/validation/perf-baseline*.json` contains measurements (developer machine, H2, not a benchmark). `TARGETS` in `performance/k6/lib.js` and the alert thresholds are illustrative starting points to be tuned from real production-like measurements.
