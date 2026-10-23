# System design and distributed systems reference

## HLD and LLD - how to structure an answer

**High-level design:** clarify requirements (functional, non-functional, scale, consistency needs) -> estimate load -> draw the context and component diagram -> choose storage and consistency model -> walk the critical flows -> address failure, security, observability -> list trade-offs and what you would do next.
**Low-level design:** pick one component and go deep: classes and responsibilities, state machine, algorithm, data model and SQL, concurrency control, error handling, tests. The ledger/processor design (`hld-and-lld.md`) is a ready example.
*Analogy:* HLD is the city map; LLD is the floor plan of one building.

## Microservices and service boundaries

* **Benefits:** independent deployment and scaling, team autonomy, failure isolation, technology choice. **Costs:** distributed transactions, network failure modes, operational overhead (pipelines, tracing, versioning), data duplication, harder testing.
* **Boundaries follow business capabilities and data ownership** (bounded contexts), not technical layers. A good boundary rarely needs a distributed transaction; if two parts constantly change together or must be atomic, they belong in one service. **Rule used here:** accounts + ledger + transactions share an invariant, so they share a transaction (ADR-001).
* **Smells:** chatty services, shared database tables, synchronous call chains of depth > 2-3, "distributed monolith" (must deploy together), a service with no owner.
* **Evolution:** start modular, extract along seams when a measured need appears (independent scaling, different release cadence, team ownership); strangler-fig pattern for extraction.

## Idempotency

*Analogy:* pressing an elevator button twice does not summon two elevators.

* Naturally idempotent: `GET`, `PUT` (full replace), `DELETE`. `POST` creating a resource is not - make it idempotent with a client-supplied **idempotency key** persisted atomically with the effect (ADR-004).
* Mechanics: unique constraint on `(principal, key)`; store a request fingerprint to detect misuse; return the original response on replay; define retention; scope per principal.
* **Consumers** of at-least-once messages must be idempotent too (status check + unique postings). Idempotent producers/consumers + at-least-once delivery = effectively-once *effects*.
* Pitfall: using a time window ("same amount within 5 s") as the only guard - false positives and negatives.

## Consistency

* **ACID** within one database; **CAP** (during a partition choose consistency or availability); **BASE/eventual consistency** across services. Choose per fact: balances need strong consistency; dashboards and search can lag.
* Patterns: **transactional outbox** (atomic state change + event), **saga** (sequence of local transactions with compensations - orchestration vs choreography), **CQRS/read models** (eventually consistent projections), **reconciliation** (detect and repair drift), **two-phase commit** (rarely the right answer: blocking, coordinator failure, unsupported by most external systems).
* **Read-your-writes:** after a `202` the client polls the resource; the dashboard reads the same database so there is no replica lag in this design; with replicas route post-write reads to the primary or use a version token.

## Concurrency control (at system level)

Optimistic (version check, retry) vs pessimistic (lock) vs serialisable isolation vs single-writer partitioning vs atomic conditional updates; choose by contention level and cost of conflict. For a balance: lock the row, check, change (ADR-005). For idempotency: a unique constraint. For queue claiming: lease + optimistic version or `SKIP LOCKED`.
*Distributed locks* (Redis/ZooKeeper) are a last resort: they cannot give the safety of a database constraint (clock/GC pauses, lock expiry) - use fencing tokens if you must.

## Resilience patterns

| Pattern | Purpose | Detail used here |
|---|---|---|
| **Timeout** | bound waiting | connect 500 ms, read 2 s, pool 3 s, lock 5 s |
| **Retry with exponential backoff + jitter** | ride out transient errors | only for idempotent `authorize`; full jitter (random 0..cap) avoids synchronised retry storms |
| **Circuit breaker** | stop calling a failing dependency | closed -> open (50 % of 10 calls) -> half-open; open = fast `NotSent` + refund |
| **Bulkhead** | isolate resources | async processor keeps external latency off request threads; per-pool limits |
| **Rate limiting / load shedding** | protect capacity | token bucket per subject |
| **Fallback / graceful degradation** | partial service | withdrawals fail safely while deposits and transfers continue |
| **Idempotent retry + dead-letter queue** | no duplicate effects, no lost poison messages | outbox `DEAD` state + alert |
| **Health checks, graceful shutdown** | safe deploys | readiness, preStop, drain |

**Never retry on "unknown" blindly; classify outcomes** (authorized / declined / not sent / unknown) and reconcile.

## API versioning and backward compatibility

URI/header/media-type versioning; additive changes only within a version; tolerant readers; consumer-driven contract tests; deprecation headers and sunset; expand/contract for the data behind it (ADR-007).

## Scalability

Stateless instances behind a load balancer; scale reads with replicas/caches; scale writes by partitioning (shard by account/customer), batching, or single-writer-per-key; remove hot spots (a "house account" every transaction touches); asynchronous processing to smooth bursts; capacity-plan from measurements (arrival rate x service time = concurrency, Little's law).
**In this project:** the database is the scaling limit; per-account serialisation is inherent; the dispatcher is horizontally safe; next steps are parallel workers, a broker relay, partitioned tables.

## Failure handling checklist

For every interaction ask: what is the timeout? is it idempotent? what happens on *unknown*? who is alerted? what does the user see? can it be replayed? what state is left behind if the process dies right here?
Chaos testing (the simulator's `FAIL_5XX`/slow modes) validates the answers.

## Distributed tracing, correlation, observability in design
Correlation id at the edge, propagated in headers, logged everywhere, stored in audit rows; traces for latency attribution; RED/USE metrics; SLOs with error budgets; runbooks linked from alerts.
