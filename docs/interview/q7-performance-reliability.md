# Questions: performance and reliability

### Q109. [Scenario] How would you investigate a slow Spring Boot API?
**Short answer:** go top-down from the user-visible symptom to the saturated resource and the responsible code, measuring at each step, then fix one thing and re-measure.
**Reasoning and implementation:** (1) which endpoint and which percentile (`http_server_requests` by `uri`; fat tail = queueing/GC/locks, uniform = work per request); (2) a trace to split time into application, database and remote calls; (3) resource saturation: Hikari pending/acquire time, thread pool, GC pauses, CPU throttling; (4) database: `pg_stat_statements`, `EXPLAIN (ANALYZE, BUFFERS)`, lock waits; (5) code: profile with JFR/async-profiler; (6) fix (index, paging, N+1, timeouts, batching) and compare before/after under the same load; (7) add an alert/regression test.
**Alternatives and trade-offs:** adding caches or instances first (can hide the cause), APM tools for automatic tracing.
**Risks and pitfalls:** optimising without a baseline, averages instead of percentiles, tiny test data.
**Likely follow-ups:** "p99 is high but p50 is fine?"; "how do you correlate a user report with a trace?" (correlation id).
**In this project:** `performance-troubleshooting.md`, correlation ids, captured plans, baseline script.

### Q110. [Scenario] How would you troubleshoot a database connection-pool bottleneck?
**Short answer:** confirm saturation (`active == max`, `pending > 0`), then find *why connections are held* before touching pool size.
**Reasoning and implementation:** metrics: `hikaricp_connections_active/pending/acquire`; database: `pg_stat_activity` (long-running statements, `idle in transaction`), blocking locks; application: thread dump (threads waiting in `getConnection`, others inside a remote call?), leak-detection log. Typical causes: slow queries, a transaction wrapping an HTTP call (the anti-pattern), lock waits, a leak, too many replicas. Fix the cause; scale replicas only if the DB has headroom; consider PgBouncer.
**Alternatives and trade-offs:** larger pool (moves the bottleneck to the DB), per-feature pools/bulkheads.
**Risks and pitfalls:** treating symptoms; `REQUIRES_NEW` inside loops doubling connection demand.
**Likely follow-ups:** "how big should the pool be?"
**In this project:** runbook "connection pool exhaustion", troubleshooting exercise 1, `ConnectionPoolSaturated` alert.

### Q111. How do you investigate high JVM memory usage or frequent garbage collection?
**Short answer:** classify (leak vs under-sizing vs allocation churn), capture evidence (heap-after-GC trend, GC log, heap dump, JFR), fix the root cause, verify with load.
**Reasoning and implementation:** heap-after-GC low points rising = leak -> heap dump + MAT dominator tree; frequent young GCs = high allocation rate -> JFR allocation profiling, reduce churn; Full GC/humongous allocations = size or large arrays; non-heap growth -> native memory tracking/metaspace/direct buffers; container limit vs `MaxRAMPercentage`.
**Alternatives and trade-offs:** change collector (G1/ZGC) after reducing allocation; bigger heap buys time.
**Risks and pitfalls:** tuning flags blindly; analysing the wrong build; dumps containing PII (handle carefully).
**Likely follow-ups:** "what does `to-space exhausted` mean?"
**In this project:** runbook sections "high memory" and "excessive GC".

### Q112. [Scenario] CPU is low but latency is high and requests queue up. What is happening?
**Short answer:** the service is waiting, not computing: thread or connection starvation, lock waits, or a slow dependency.
**Reasoning and implementation:** thread dumps show many threads `WAITING` (pool, lock, socket); check `hikaricp_connections_pending`, lock waits in the database, remote-call latency and timeouts, Tomcat thread saturation; confirm with traces. Fix with timeouts, bulkheads/async processing, shorter critical sections, right-sized pools.
**Alternatives and trade-offs:** virtual threads (remove thread scarcity, not connection scarcity), more instances (if the bottleneck is per-instance).
**Risks and pitfalls:** scaling out against a database bottleneck (makes it worse).
**Likely follow-ups:** "how do you prove it is the database?"
**In this project:** performance guide "thread starvation".

### Q113. How do you load-test correctly and avoid misleading results?
**Short answer:** use realistic workloads and an open-loop (arrival-rate) generator, warm up, measure percentiles, check invariants, and report the environment honestly.
**Reasoning and implementation:** closed-loop tools (fixed VUs) slow down when the system slows, hiding latency (*coordinated omission*); use constant/ramping arrival rate; separate the generator from the system; test with production-like data volumes and database; verify correctness during load (balance never negative, money conserved); record environment and versions; repeat runs.
**Alternatives and trade-offs:** replaying production traffic, chaos plus load.
**Risks and pitfalls:** laptop numbers presented as capacity, tiny datasets, caches warmed unrealistically.
**Likely follow-ups:** "what is Little's law?" (concurrency = rate x latency).
**In this project:** k6 arrival-rate scenarios; the local baseline is labelled "developer machine, not a benchmark" and includes invariant checks.

### Q114. [Scenario] Your optimisation "should" improve throughput. How do you prove it did?
**Short answer:** measure before and after with the same workload and environment, change one thing, repeat, and report variance and caveats.
**Reasoning and implementation:** the dispatcher change (drain while work exists instead of one batch per tick) was measured on the same machine with the same script: before ~23 transactions/s processed, after ~34 transactions/s; both numbers kept in the repository with the caveat that the machine was also running other workloads; the correctness invariants (balance equals submissions, ledger integrity) were checked in both runs.
**Alternatives and trade-offs:** statistical comparison over several runs, controlled hardware.
**Risks and pitfalls:** attributing noise to the change; comparing different loads (here the submitted counts differed, so the drain *rate* rather than elapsed time was compared).
**Likely follow-ups:** "what would you do next?" (parallel workers, SKIP LOCKED, broker).
**In this project:** `docs/validation/perf-baseline-before-drain-loop.json` vs `perf-baseline.json`.

### Q115. What is the difference between availability, reliability and resilience, and how do you measure them?
**Short answer:** availability = fraction of time the service works; reliability = consistent correct behaviour over time; resilience = ability to absorb and recover from faults. Measure with SLIs/SLOs and error budgets.
**Reasoning and implementation:** SLIs: successful requests, latency percentiles, correctness checks (ledger integrity = 0 violations), freshness (reconciliation age); SLOs set targets (99.9 %); error budgets guide release pace; resilience is demonstrated by fault injection and game days; MTTR matters as much as MTBF.
**Alternatives and trade-offs:** synthetic probes vs real-user metrics.
**Risks and pitfalls:** measuring uptime of the process rather than user success; alert fatigue.
**Likely follow-ups:** "what is an error budget policy?"
**In this project:** `docs/operations/slo.md` (illustrative targets).

### Q116. [Scenario] The database goes down for five minutes. What should happen and what do you verify afterwards?
**Short answer:** requests fail fast, readiness fails to drain traffic, no data is lost, and processing resumes automatically; verify integrity and backlog afterwards.
**Reasoning and implementation:** connection acquisition times out in 3 s; API returns 5xx/503 quickly; readiness goes red; the outbox lives in the DB so queued work waits; on return Hikari reconnects, the dispatcher resumes, stuck `PROCESSING` rows move to reconciliation after 5 minutes, idempotent retries by clients are safe. Verify: ledger integrity, outbox backlog and dead letters, reconciliation count, error-rate recovery; write the post-incident review.
**Alternatives and trade-offs:** read replicas for degraded read-only service, retry buffers at the edge.
**Risks and pitfalls:** connection storms on recovery (cap pools, jitter), assuming failover is transparent without testing.
**Likely follow-ups:** "RPO/RTO?"; "how do you practise this?" (game day).
**In this project:** performance guide "database outage".

### Q117. How do health checks, readiness and liveness differ, and what should each include?
**Short answer:** liveness answers "restart me?" (process is wedged), readiness answers "send me traffic?" (can serve now), startup protects slow initialisation.
**Reasoning and implementation:** liveness should be cheap and independent of dependencies (otherwise a database outage restarts every pod); readiness may include essential dependencies (database) but not optional ones; an additional business health view (staff dashboard) shows degraded components without affecting traffic routing.
**Alternatives and trade-offs:** deep health endpoints (useful for humans, dangerous as probes).
**Risks and pitfalls:** restart storms, readiness flapping.
**Likely follow-ups:** "should readiness include the external network?" (no - degrade, do not remove capacity for deposits).
**In this project:** actuator probes on the management port plus `/ops/health`.

### Q118. [Scenario] A downstream provider is slow (p95 8 s) but not failing. How do you keep your service healthy?
**Short answer:** enforce timeouts, isolate the call from request threads, shed or fail fast via the circuit breaker, and degrade only the affected capability.
**Reasoning and implementation:** read timeout 2 s with bounded retries; withdrawals are asynchronous (request threads return `202` immediately), so slowness does not consume API capacity; slow timeouts count as breaker failures and open it, after which withdrawals fail fast and are refunded while deposits/transfers continue; ops dashboard shows degraded health; reconciliation resolves in-flight unknowns later.
**Alternatives and trade-offs:** adaptive concurrency limits, bulkheads with separate pools, caching provider responses where valid.
**Risks and pitfalls:** unbounded queues in front of the slow provider; retries multiplying load.
**Likely follow-ups:** "what if it is slow but succeeds?" (timeouts treat it as unknown - reconciliation completes it).
**In this project:** chaos e2e (`SLOW`/`FAIL_5XX` modes), `RestClearingClient`.
