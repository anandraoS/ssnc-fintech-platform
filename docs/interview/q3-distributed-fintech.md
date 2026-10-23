# Questions: microservices, distributed systems and financial transaction integrity

### Q39. [Scenario] How would you design a highly available financial transaction service?
**Short answer:** stateless service instances across zones, a highly-available database with synchronous replication, idempotent APIs, asynchronous processing with at-least-once delivery and idempotent consumers, explicit failure states and reconciliation, and tested recovery.
**Reasoning and implementation:** (1) *Availability of compute:* >= 2-3 replicas across AZs behind a load balancer, readiness probes, graceful shutdown, rolling deploys with zero unavailable pods, PDBs. (2) *Data:* a Multi-AZ PostgreSQL (synchronous standby, automatic failover, PITR backups); the ledger is the system of record; consistency over availability for money state. (3) *Correctness under retries and crashes:* idempotency keys, transactional outbox, idempotent processor, unique ledger postings. (4) *External dependencies:* timeouts, retry with jitter for idempotent calls, circuit breaker, "unknown" outcomes held for reconciliation. (5) *Operations:* SLOs with error budgets, alerts with runbooks, chaos and failover drills, capacity headroom, backups tested by restoring.
**Alternatives and trade-offs:** active-active multi-region (higher availability, much harder consistency - needs partitioning by customer and conflict-free design); event sourcing; managed services versus self-run.
**Risks and pitfalls:** claiming "exactly-once", forgetting the database as the single point of failure, untested failover, HA that loses acknowledged writes (async replication).
**Likely follow-ups:** "RPO/RTO?"; "what happens during failover to in-flight requests?"; "multi-region?"
**In this project:** stateless replicas, probes/PDB/HPA in the manifests, outbox + reconciliation, the chaos e2e; DB HA described for RDS (not run).

### Q40. [Scenario] How do you handle duplicate transaction submissions?
**Short answer:** require an idempotency key, persist it atomically with the effect under a unique constraint, replay the original result for the same key and payload, and reject reuse with a different payload.
**Reasoning and implementation:** client generates the key once per logical action and reuses it on retries. Server: fast lookup by `(principal, key)`; on miss, one DB transaction inserts the transaction and the idempotency record (unique constraint arbitrates races); the loser's transaction rolls back and it replays the winner's record. A SHA-256 fingerprint detects key reuse with a different body (422). Records are retained for the retry window (7 days) then purged. Downstream, the processor is idempotent (status check + unique ledger postings).
**Alternatives and trade-offs:** time-window deduplication (false positives/negatives), Redis keys (not atomic with DB), exactly-once brokers (do not extend to the database/external effects).
**Risks and pitfalls:** key scope (per principal), regenerating a key on retry (defeats the purpose), caching only successes (replay rejections too).
**Likely follow-ups:** "what if the first request is still in flight when the retry arrives?" (the unique insert blocks until the first commits, then the retry replays).
**In this project:** `TransactionService.submit`, `IdempotencyIT`, SPA `IdempotencyKeys`.

### Q41. [Scenario] How would you guarantee that an account transfer is atomic?
**Short answer:** do the debit, the credit and the ledger entries in one database transaction on one database, with locks and constraints guarding the invariants.
**Reasoning and implementation:** lock both account rows in ascending id order, re-check status and funds, debit and credit, insert two ledger entries (unique per tx/account/type), move the transaction to `COMPLETED`, commit. Any failure rolls everything back; business failures are recorded afterwards in a fresh transaction. The `CHECK balance >= 0`, unique postings and a ledger-integrity check make a half-applied transfer both impossible and detectable.
**Alternatives and trade-offs:** if debit and credit were in different services/databases you would need a saga with compensations (half-applied states become visible and must be reconciled) or 2PC (blocking, rarely available) - the reason accounts and ledger share one service here.
**Risks and pitfalls:** splitting the two updates across transactions "for performance"; auto-commit; locking in inconsistent order; JPA batch updates hiding partial failure.
**Likely follow-ups:** "what if the process crashes between debit and credit?" (the transaction rolls back - neither is applied).
**In this project:** `LedgerService.applyTransfer`, `ConcurrencyScenarios.oppositeTransfersDoNotDeadlock`, money-conservation checks in the baseline.

### Q42. What is the difference between a database transaction and a distributed workflow, and what can each guarantee?
**Short answer:** a database transaction gives atomicity/isolation within one database; a distributed workflow coordinates several independent systems with explicit states and compensations and can offer only eventual consistency.
**Reasoning and implementation:** you cannot roll back an HTTP call to another company. So local changes are transactional; the external step is modelled as states (`PROCESSING -> COMPLETED | FAILED | RECONCILIATION_REQUIRED`), idempotent calls, retries, compensation (reversal credit) and reconciliation. Delivery guarantees compose as: at-least-once + idempotent consumer = effectively-once *effects*; never claim distributed exactly-once.
**Alternatives and trade-offs:** 2PC/XA (limited support, availability cost), sagas (orchestrated or choreographed), outbox + CDC.
**Risks and pitfalls:** treating timeouts as failure; hiding the unknown state; compensations that can themselves fail (need retries and alerts).
**Likely follow-ups:** "orchestration vs choreography?"
**In this project:** ADR-003, ADR-011, integrity chapter.

### Q43. [Scenario] A call to a third-party payment network times out. What state is the transaction in and what do you do?
**Short answer:** *unknown*; keep the funds reserved, mark `RECONCILIATION_REQUIRED`, and ask the network what happened - never guess.
**Reasoning and implementation:** classify results: authorized/declined (definite), not-sent (connection refused/DNS/4xx/circuit open - provably not executed: refund and fail fast), unknown (read timeout, 5xx after retries - may have executed). For unknown: open a reconciliation record, reconcile automatically with a lookup by our reference (idempotent read), refund after a grace period if the network has no record, alert after 15 minutes, allow manual resolution with maker-checker.
**Alternatives and trade-offs:** assume failure (risk of double payout), assume success (phantom payout), synchronous retries until certain (blocks resources).
**Risks and pitfalls:** refunding on timeout; retrying a non-idempotent call; no alert on stuck records.
**Likely follow-ups:** "what if the network has no lookup API?" (negotiate one, or use settlement reports for daily reconciliation).
**In this project:** `TransactionProcessor`, `ReconciliationService`, chaos e2e (`.66` cents case).

### Q44. Explain the transactional outbox pattern and its alternatives.
**Short answer:** write the event to an outbox table in the same transaction as the state change; a relay delivers it later, so the change and its announcement cannot diverge.
**Reasoning and implementation:** solves the dual-write problem (DB commit succeeded but the message send failed, or vice versa). The dispatcher claims events (lease + version), invokes the handler, marks dispatched, retries with backoff, dead-letters after N attempts. Delivery is at-least-once, so consumers must be idempotent.
**Alternatives and trade-offs:** change-data-capture (Debezium) publishing the table to Kafka (no polling, more infrastructure); listen/notify; "listen to yourself" event publishing (loses events on crash); 2PC (no).
**Risks and pitfalls:** unbounded outbox growth, polling load, ordering assumptions (per aggregate only), non-idempotent handlers.
**Likely follow-ups:** "how do you keep ordering?" (partition by aggregate id; single claimer per aggregate).
**In this project:** `OutboxService`, `OutboxDispatcher`, ADR-006, `OutboxDeadLetterIT`.

### Q45. [Scenario] Messages are redelivered and a handler runs twice. How do you prevent double effects?
**Short answer:** make the handler idempotent: check state first and back it with a unique constraint.
**Reasoning and implementation:** the processor loads the transaction and returns if the status is not `VALIDATED`; the ledger insert is unique per `(transaction_id, account_id, entry_type)`; reversal checks `funds_reserved` and the existing reversal entry. Redelivery after a crash between debit and outcome is handled by recovery, not by re-running the debit.
**Alternatives and trade-offs:** dedup table of processed message ids (extra storage, generic), natural idempotency of the operation.
**Risks and pitfalls:** idempotency by "have I seen this id in memory"; side effects outside the dedup scope (e-mails).
**Likely follow-ups:** "how do you test it?" (process the same id twice - `duplicateDeliveryIsHarmless`).
**In this project:** `TransactionProcessorTest.nonValidatedTransactionIsSkipped`, `ConcurrencyScenarios.duplicateDeliveryIsHarmless`.

### Q46. When should you use microservices versus a modular monolith?
**Short answer:** start with a modular monolith; extract services when independent scaling, team ownership or release cadence justifies the distributed-systems cost - and never split things that share an invariant.
**Reasoning and implementation:** the costs of microservices (network failure, distributed transactions, N pipelines, observability, contract management) must be paid by a benefit you can name. Boundaries follow business capabilities and data ownership. Keep module dependencies one-directional so extraction is possible later.
**Alternatives and trade-offs:** a monolith with a separate worker deployment (cheap first step), serverless functions for edge tasks.
**Risks and pitfalls:** "distributed monolith"; shared database across services; premature splitting; resume-driven architecture.
**Likely follow-ups:** "how would you extract the first service?" (outbox dispatcher/reporting).
**In this project:** ADR-001 and the migration path.

### Q47. How do you define service boundaries and data ownership?
**Short answer:** by business capability and by who changes which data together; each datum has exactly one owning service.
**Reasoning and implementation:** event-storm the domain, find aggregates and invariants, keep an invariant inside one boundary, expose other services' data via APIs/events (not shared tables), version contracts, and make cross-boundary consistency eventual and observable (reconciliation). Anti-signals: two services editing the same table, long synchronous chains, joint deployments.
**Alternatives and trade-offs:** shared-library "domain" modules (couples releases), data mesh for analytics.
**Risks and pitfalls:** boundaries by technical layer ("DAO service"), chatty fine-grained services.
**Likely follow-ups:** "what about reporting across services?" (read models/CQRS).
**In this project:** table ownership in the architecture chapter; `AccountClosureGuard` keeps account independent of transaction persistence.

### Q48. What is a saga and when would you not use one?
**Short answer:** a sequence of local transactions where each step has a compensating action; use it when a business process spans services that cannot share a transaction - and avoid creating that situation when a single transaction would do.
**Reasoning and implementation:** orchestration (a coordinator drives steps and compensations) vs choreography (services react to events). Requirements: idempotent steps and compensations, durable saga state, timeouts, visibility, handling of compensation failure (retry + alert). Example here (single external step): reserve funds (local) -> external call -> complete or reverse - a minimal saga.
**Alternatives and trade-offs:** one transaction in a monolith; 2PC; TCC (try-confirm-cancel).
**Risks and pitfalls:** compensations that cannot undo (e-mail sent), isolation anomalies (others see intermediate state - e.g. reserved funds), complexity explosion.
**Likely follow-ups:** "how do you show intermediate state to users?" (explicit statuses).
**In this project:** ADR-003/011.

### Q49. [Scenario] Design retry behaviour for a flaky downstream API.
**Short answer:** retry only idempotent calls, a few times, with exponential backoff and full jitter, a timeout per attempt, an overall deadline, and a circuit breaker; classify the final failure honestly.
**Reasoning and implementation:** delay = random(0, min(cap, base x 2^attempt)); 3 attempts; connect 500 ms / read 2 s; breaker opens at 50 % failures over 10 calls and half-opens after 10 s; metrics for retries/breaker state; after exhaustion return *unknown* (not failed) when the request may have executed.
**Alternatives and trade-offs:** hedged requests (lower tail latency, extra load), retry budgets (limit retries to a % of traffic), queue-and-retry later (asynchronous).
**Risks and pitfalls:** retry storms (no jitter), amplification across layers (each layer retrying), retrying non-idempotent calls.
**Likely follow-ups:** "why full jitter?" (decorrelates clients; best recovery behaviour in published analyses); "retry budgets?"
**In this project:** `RetryExecutor`, `RestClearingClientTest`, `RetryAndRateLimitTest`.

### Q50. How does a circuit breaker work and what do you do while it is open?
**Short answer:** it counts failures in a sliding window; above a threshold it opens and rejects calls immediately for a cool-down, then half-opens to probe.
**Reasoning and implementation:** protects the caller's threads/connections and gives the dependency time to recover. While open the platform answers withdrawals with a fast `CLEARING_UNAVAILABLE` and refunds (the request was provably not sent), deposits and transfers continue, health shows `DEGRADED`, an alert fires. After the cool-down a probe call decides whether to close.
**Alternatives and trade-offs:** bulkheads, rate limiting, load shedding, fallback data.
**Risks and pitfalls:** thresholds too sensitive (flapping) or too lax; counting client errors as failures; hiding open state from operators.
**Likely follow-ups:** "which exceptions count as failures?" (transport failures only).
**In this project:** `ClearingConfig` (Resilience4j), `platform_clearing_circuit_open` gauge, chaos e2e.

### Q51. How do you design backward-compatible REST APIs?
**Short answer:** only additive changes within a version, tolerant readers, contract tests, and a deprecation process for breaking changes.
**Reasoning and implementation:** allowed: add optional request fields, add response fields, add endpoints, add error codes; breaking: remove/rename, change types/scale/meaning, new required input, tighter validation, new status codes for existing flows. Detect drift automatically (OpenAPI diff in CI), version in the URI (`/api/v1`), support old and new side by side, announce with `Deprecation`/`Sunset` headers, monitor usage per client, then remove.
**Alternatives and trade-offs:** header/media-type versioning, date-based versions, consumer-driven contracts (Pact).
**Risks and pitfalls:** "additive" enum values breaking strict clients; changing money scale; silently changing defaults.
**Likely follow-ups:** "is adding a new enum value breaking?" (depends on client tolerance - document it).
**In this project:** ADR-007, `ApiContractIT`, CI `git diff --exit-code specs/openapi.json`.

### Q52. [Scenario] How would you secure a multi-tenant financial application?
**Short answer:** make the tenant a first-class, server-derived part of every request and enforce isolation in several layers: token claims, authorization policy, query scoping, and ideally database row-level security.
**Reasoning and implementation:** (1) tenant id comes from the validated token, never from the request body; (2) every query is scoped by tenant (a mandatory filter/specification, or PostgreSQL RLS with `SET LOCAL app.tenant`); (3) object-level checks on every id; (4) per-tenant rate limits and quotas; (5) separate encryption keys per tenant for sensitive data; (6) audit includes tenant; (7) tests that attempt cross-tenant access on *every* endpoint; (8) consider silo (database per tenant) vs pool (shared schema) vs bridge (schema per tenant) by risk/cost.
**Alternatives and trade-offs:** DB-per-tenant (strongest isolation, highest cost, operational scale issues), schema-per-tenant, shared tables with RLS (best density, requires discipline).
**Risks and pitfalls:** missing a filter on one query (BOLA across tenants), caches keyed without tenant, background jobs without tenant context, noisy neighbours.
**Likely follow-ups:** "how do you test isolation?"; "how do you handle a super-admin?"
**In this project:** the customer-scoping model (`customer_id` claim, `AccessPolicy`, forced scope in searches) is the single-level version of this design; multi-tenancy itself is out of scope.

### Q53. [Scenario] Two microservices must both update data for one business operation. What do you do?
**Short answer:** first ask whether they should be one service; if not, use the outbox + idempotent consumers (+ saga/compensation) and make intermediate states explicit.
**Reasoning and implementation:** the initiating service commits its change and an outbox event atomically; the second service consumes idempotently and acknowledges; failure of the second step triggers a compensating action or a visible `PENDING`/`FAILED` state with reconciliation; use timeouts and alerts for stuck workflows; never use a distributed lock as the consistency mechanism.
**Alternatives and trade-offs:** merge the services; synchronous call with compensation (simpler, couples availability); 2PC where genuinely supported.
**Risks and pitfalls:** hidden coupling, lost messages (dual write), duplicate effects.
**Likely follow-ups:** "how do you test it?" (fault injection between steps).
**In this project:** the external clearing step is exactly this situation, solved with reservation + reconciliation.

### Q54. How do you achieve eventual consistency and keep users informed?
**Short answer:** make asynchronous states first-class resources and give clients a way to observe progress.
**Reasoning and implementation:** `202 Accepted` with a resource URL, explicit statuses (`VALIDATED`, `PROCESSING`, `RECONCILIATION_REQUIRED`), polling/server-sent events/webhooks, idempotent retries, dashboards showing stuck work, SLOs on end-to-end latency. For read models, show "as of" timestamps and handle read-your-writes by reading from the primary or using version tokens.
**Alternatives and trade-offs:** synchronous completion (simpler client, couples latency to slowest dependency).
**Risks and pitfalls:** hiding intermediate states; unbounded staleness without alerts.
**Likely follow-ups:** "polling vs push?"
**In this project:** transaction status endpoint, 15-second dashboard refresh, end-to-end latency histogram.

### Q55. [Scenario] A customer says a withdrawal reduced their balance but the money never arrived. How do you investigate?
**Short answer:** follow the transaction through its states, attempts and audit trail, check the reconciliation record and the network's own record.
**Reasoning and implementation:** find the transaction by reference; check status: `RECONCILIATION_REQUIRED` means funds are reserved while the outcome is unknown; `COMPLETED` means the network authorized (check authorization id in the attempt detail and the network's settlement); `FAILED` should show a reversal credit in the ledger. Verify ledger entries (`DEBIT` then maybe `REVERSAL_CREDIT`) and the integrity check. Resolve manually if needed (maker-checker), then reply to the customer with the facts.
**Alternatives and trade-offs:** reconcile against the network's daily settlement file as a second detection net.
**Risks and pitfalls:** editing balances directly; promising refunds before the facts are known.
**Likely follow-ups:** "how long can funds stay reserved?" (alert after 15 minutes; policy for escalation).
**In this project:** `transactions/{id}/attempts`, `/audit`, `/ops/reconciliations`, runbook.

### Q56. What consistency guarantees does the dashboard have and why is that acceptable?
**Short answer:** it reads the same database as the API, so it is strongly consistent for what it shows at query time, but values are computed from a snapshot that may be seconds old and aggregates are not transactional with writes.
**Reasoning and implementation:** counts and sums run as separate queries (each statement sees a committed snapshot), so a transaction may be counted as `PROCESSING` in one query and `COMPLETED` in another; for operational awareness that is fine, for financial reporting you would use a consistent snapshot (`REPEATABLE READ` read-only) or a dedicated reporting store.
**Alternatives and trade-offs:** replicas (lag), materialised views, event-fed read models.
**Risks and pitfalls:** treating dashboard numbers as accounting truth.
**Likely follow-ups:** "how would you make it consistent?"
**In this project:** `OpsService.summary`.

### Q57. How do you handle cancellation vs processing races?
**Short answer:** make the state transition itself the arbiter with an optimistic version so exactly one of "cancel" and "start processing" wins.
**Reasoning and implementation:** both operations load the transaction at version *n* and attempt to write a transition (`VALIDATED -> CANCELLED` or `-> PROCESSING`); the second update fails the `WHERE version = n` check. The loser of cancel gets 409; the loser of processing finds a non-`VALIDATED` status on retry and skips. Tests: cancel then drain leaves the transaction cancelled and the balance untouched.
**Alternatives and trade-offs:** row lock on the transaction (more blocking), cancel as a request that the worker honours (eventual).
**Risks and pitfalls:** cancelling after funds are reserved (not allowed by the state machine).
**Likely follow-ups:** "why not allow cancel in `PROCESSING`?" (external effects may be in flight).
**In this project:** `TransactionStatus.isCancellable`, `TransactionFlowIT.cancellation`.

### Q58. [Scenario] Operations asks for a maker-checker control on large transactions. How do you implement it?
**Short answer:** a review threshold sends large submissions to `PENDING_REVIEW`; approval requires a different authenticated operator than the submitter; everything is audited.
**Reasoning and implementation:** validator returns `REVIEW`; state machine allows `PENDING_REVIEW -> VALIDATED | REJECTED | CANCELLED`; `AccessPolicy.canReview` requires an operator role and `subject != submittedBy` (applies to admins as well); approval writes `reviewedBy`, the outbox event and an audit row; tests cover self-approval (403), customer (403), second operator (OK).
**Alternatives and trade-offs:** multi-level approvals, dual control with time windows, amount tiers per role.
**Risks and pitfalls:** shared accounts defeating maker-checker; approving a stale request (re-validate at approval - processing re-checks authoritative rules anyway).
**Likely follow-ups:** "what about collusion?" (separation of duties + audit analytics).
**In this project:** `TransactionService.approve`, `AccessPolicyTest.makerChecker`, e2e scenario.

### Q59. How do you scale a system where one account is extremely hot?
**Short answer:** accept serial processing per account but shrink the critical section, or restructure the hot spot (batching, sharded counters, partitioned queues).
**Reasoning and implementation:** the row lock serialises per account; per-account throughput = 1 / (critical-section time). Measure it; remove I/O from the lock; batch many small postings into one transaction per account per tick; for a house/fee account use sub-accounts (shards) whose totals are aggregated; or route by account id to a single-writer partition.
**Alternatives and trade-offs:** optimistic with retries (poor under hot contention), eventual-consistent counters (not for balances that gate spending).
**Risks and pitfalls:** hidden hot rows (shared totals, sequence rows), premature sharding.
**Likely follow-ups:** "what do you monitor?" (lock waits, per-account queue depth).
**In this project:** baseline scenario "concurrent withdrawals on one account"; risk R4.

### Q60. What is reconciliation and how often should it run?
**Short answer:** comparing two sources of truth and repairing differences; continuous for unknown outcomes, periodic for end-to-end consistency.
**Reasoning and implementation:** *Event-driven:* the open-records reconciler every 15 s. *Periodic:* daily ledger-vs-balance integrity and a settlement-file comparison against the network; mismatches raise tickets. Always prefer *detect and alert* before *auto-correct*; corrections are new postings, never edits.
**Alternatives and trade-offs:** real-time verification (costly), sampling.
**Risks and pitfalls:** auto-fixing errors you do not understand; no ownership for exceptions.
**Likely follow-ups:** "what do you do with unexplained differences?"
**In this project:** `ReconciliationService.autoReconcile`, `/ops/ledger-integrity`.

### Q61. How do you design for partial failure of a dependency you do not control?
**Short answer:** assume it will be slow, wrong, or down; bound waiting, isolate it, degrade gracefully, and make every outcome representable.
**Reasoning and implementation:** timeouts and breaker; async processing so request threads are not tied up; separate failure states for *not sent* and *unknown*; keep unaffected capabilities (deposits/transfers) working; health and alerts; a simulator with chaos modes to rehearse; documented runbooks.
**Alternatives and trade-offs:** queue and retry later (customer waits), alternative provider (cost/complexity).
**Risks and pitfalls:** happy-path-only integration tests; missing timeouts.
**Likely follow-ups:** "how do you test it?" (fault injection).
**In this project:** `clearing-simulator` chaos modes and `e2e-api.mjs --with-chaos`.

### Q62. What would you change first if this platform had to handle 100x the load?
**Short answer:** measure to find the first bottleneck; expect it to be the database and the single-threaded in-database queue.
**Reasoning and implementation:** (1) parallel outbox workers (`SKIP LOCKED`) and a broker relay; (2) read replicas for dashboards/history; (3) partition large tables; (4) keyset pagination and the participants table; (5) shard by customer if one primary is not enough; (6) cache reference data; (7) tune pools and use PgBouncer; (8) load-test with arrival-rate tools on production-like hardware; (9) per-account batching for hot accounts.
**Alternatives and trade-offs:** CQRS/event sourcing, specialised stores for read models.
**Risks and pitfalls:** scaling before measuring; breaking invariants while sharding.
**Likely follow-ups:** "how do you keep transfers atomic across shards?" (route by customer; cross-shard transfers use a saga with reservation).
**In this project:** risk register R4/R5 and the dispatcher measurement (23 -> 34 tx/s locally).
