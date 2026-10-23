# Performance-review checklist

- [ ] **Queries:** every list is paged and sorted by a whitelisted, indexed property; no N+1 (fetch plan / batch size); no `findAll()` on growing tables; `EXPLAIN (ANALYZE)` checked for new shapes (see the captured plans); `OR` across two columns considered for `UNION ALL`/keyset.
- [ ] **Transactions & locks:** short; no I/O inside; lock order fixed; waits bounded; no lock held while calling out; contention hot spots identified.
- [ ] **Connections:** pool sized for the DB, not for threads; timeouts set; no leaks; per-replica x replicas <= `max_connections`.
- [ ] **Remote calls:** connect/read timeouts, retries only for idempotent calls with jitter and a cap, circuit breaker, bulkhead (async), no unbounded fan-out.
- [ ] **Memory:** bounded collections and result sets; streaming for exports; caches bounded with eviction; large payloads not logged.
- [ ] **CPU/allocation:** no heavy work in loops/hot paths; avoid repeated serialisation; pure functions cache-friendly.
- [ ] **API:** payload size reasonable, compression where useful, pagination caps, conditional requests where valuable.
- [ ] **Frontend:** `OnPush`, `track`, lazy routes, bundle budgets, no polling storms (the dashboard refreshes every 15 s only while visible).
- [ ] **Evidence:** a before/after measurement for any optimisation (`performance/local-baseline.mjs` or k6); no claimed gain without numbers; results labelled with the environment.
- [ ] **Observability:** the new path has metrics (rate, errors, duration) and an alert if it can saturate something.
