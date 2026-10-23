# Questions: Java and Spring Boot

### Q1. How does the JVM manage memory, and what happens during garbage collection?
**Short answer:** objects live on the heap, split (conceptually) into young and old generations; G1 collects young regions frequently with short stop-the-world pauses and reclaims old regions in mixed collections; a Full GC is the failure mode.
**Reasoning and implementation:** most objects die young, so a small frequently-collected young area is cheap. Survivors are copied between survivor regions and promoted. Besides the heap the process holds metaspace, thread stacks, code cache and direct buffers, so container memory must exceed the heap (`MaxRAMPercentage=75`). Evidence comes from `-Xlog:gc*`, `jvm_gc_pause_seconds`, JFR and heap dumps.
**Alternatives and trade-offs:** ParallelGC (throughput, longer pauses), ZGC/Shenandoah (very low pauses, more memory and CPU). Pick by SLO: latency-bound services may justify ZGC, but only after measurement.
**Risks and pitfalls:** tuning flags before reducing allocation; ignoring non-heap memory so the pod is OOMKilled although the heap looks fine; humongous allocations.
**Likely follow-ups:** "how do you find a memory leak?" (heap-after-GC trend, heap dump, dominator tree); "G1 vs ZGC?"
**In this project:** `platform-service.Dockerfile` sets `MaxRAMPercentage=75`, `ExitOnOutOfMemoryError`, heap dump to `/tmp`; the `JvmHeapHigh` and `LongGcPauses` alerts link to runbook sections.

### Q2. [Scenario] Pods are OOMKilled every six hours. How do you investigate?
**Short answer:** separate heap growth from native/non-heap growth, capture a heap dump, find the retained set, fix the cause, and verify with the same load.
**Reasoning and implementation:** (1) chart `jvm_memory_used_bytes{area="heap"}` low points and `process_resident_memory` against the limit - rising low points = leak, flat-but-high = under-sized; (2) `jcmd <pid> GC.heap_dump` (or the automatic dump) into Eclipse MAT: dominator tree and leak suspects; (3) typical culprit in a service: an unpaged `findAll()` in a new endpoint, a cache without eviction, a static collection; (4) fix (paging, eviction, streaming), add a test that asserts the page cap, keep an alert on heap; (5) repeat the load test and watch the heap-after-GC line stay flat.
**Alternatives and trade-offs:** raising the limit buys time but hides a leak; restarting on a schedule is a mitigation, not a fix.
**Risks and pitfalls:** analysing a dump from a different version than production; forgetting thread stacks and direct buffers when many threads/Netty buffers exist.
**Likely follow-ups:** "what if the heap is fine but RSS grows?" (native memory tracking, metaspace, direct buffers, glibc arenas); "how do you do this without downtime?"
**In this project:** troubleshooting exercise 4 and the `high-memory` runbook; page size capped at 100 by configuration.

### Q3. Explain the Java memory model and why `synchronized` in the application does not protect a bank balance in a multi-instance deployment.
**Short answer:** the JMM defines visibility and ordering between threads of **one JVM**; a balance shared by several application instances needs a lock that lives where all instances can see it - the database.
**Reasoning and implementation:** `synchronized` establishes mutual exclusion and happens-before only inside the JVM. With two pods, each has its own monitor; both can read the same row and both write. The authoritative serialisation point is the database: `SELECT ... FOR UPDATE` (pessimistic), a version column (optimistic), or an atomic conditional `UPDATE`. A unique constraint arbitrates creation races.
**Alternatives and trade-offs:** distributed locks (Redis/ZooKeeper) add failure modes (expiry during GC pause) and cannot match the safety of a database constraint; single-writer partitioning avoids contention but needs partitioned infrastructure.
**Risks and pitfalls:** assuming a single instance "for now"; Hibernate first-level cache hiding concurrent changes; thinking `@Transactional` alone provides isolation from other readers.
**Likely follow-ups:** "what does `volatile` guarantee?"; "what is a happens-before edge?"
**In this project:** `LedgerService` locks rows (`AccountRepository.lockById`), `ConcurrencyScenarios` runs 20 competing threads.

### Q4. What is a deadlock and how do you prevent it in a transfer between two accounts?
**Short answer:** two transactions each hold a lock the other needs; prevent it by acquiring locks in a single global order.
**Reasoning and implementation:** transfer A->B locks A then B; transfer B->A locks B then A; each waits forever (until the database's detector aborts one). If every operation locks the lower id first, a cycle is impossible. Add bounded lock waits (`lock.timeout=5000`) so contention becomes a retryable error, and keep critical sections short.
**Alternatives and trade-offs:** lock a single "account pair" row (extra contention); optimistic retries (livelock risk); `NOWAIT` + retry.
**Risks and pitfalls:** one new code path that locks in a different order reintroduces the bug; ids compared with the wrong ordering function (any total order works if used *consistently*; `UUID.compareTo` is signed - fine, as long as all code uses it).
**Likely follow-ups:** "how would you detect a deadlock in production?" (database log shows both statements, `pg_locks`); "what is livelock?"
**In this project:** `LedgerService.applyTransfer`, `LedgerServiceTest.locksInAscendingIdOrder`, `ConcurrencyScenarios.oppositeTransfersDoNotDeadlock` (H2 and PostgreSQL), mutation check: removing the sort fails the unit test.

### Q5. Compare `ArrayList`, `LinkedList`, `HashMap`, `ConcurrentHashMap` and `EnumMap`. When do you use each?
**Short answer:** `ArrayList` by default, `HashMap` for lookup, `ConcurrentHashMap` for shared mutable maps, `EnumMap/EnumSet` for enum keys, `LinkedList` almost never.
**Reasoning and implementation:** `ArrayList` has contiguous memory (cache friendly) and O(1) index access; `LinkedList` pays per-node overhead and O(n) index; `HashMap` is O(1) average but needs correct `equals/hashCode` and is not thread-safe; `ConcurrentHashMap` uses CAS and fine-grained locking and offers atomic `compute*` operations; `EnumMap` is a plain array indexed by ordinal - the state machine uses `EnumSet`.
**Alternatives and trade-offs:** `TreeMap` for ordering/ranges (O(log n)); immutable `List.of` for safety; `CopyOnWriteArrayList` for rarely-written listener lists.
**Risks and pitfalls:** mutable keys; iterating while modifying; assuming `HashMap` ordering; check-then-put races on a plain map.
**Likely follow-ups:** "how does HashMap resolve collisions?" (buckets, treeification at 8); "why is `BigDecimal` a bad key?" (`equals` is scale-sensitive).
**In this project:** `TokenBucketRateLimiter` uses `ConcurrentHashMap.computeIfAbsent`; `TransactionStatus.allowedNext()` returns `EnumSet`.

### Q6. How does dependency injection work in Spring and what are the injection pitfalls?
**Short answer:** the container constructs beans and supplies their dependencies (by type, then qualifier/name); constructor injection is preferred.
**Reasoning and implementation:** beans are registered from component scanning/`@Bean` methods; the container resolves constructor parameters by type; ambiguity is resolved by `@Primary`, then `@Qualifier`, then parameter name. Constructor injection makes dependencies explicit, immutable and testable without a container.
**Alternatives and trade-offs:** field injection (hides dependencies, hard to test), setter injection (optional dependencies), service locator (avoid).
**Risks and pitfalls:** circular dependencies (design smell - break with a port/interface, as `AccountClosureGuard` does); `@Primary` silently overriding name matching (a real near-miss with two `TransactionTemplate` beans); prototype beans injected into singletons; proxies and self-invocation.
**Likely follow-ups:** "what happens at startup if no `JwtDecoder` exists?" (fails closed); "how do you override a bean in tests?"
**In this project:** `AppConfig` documents the two-template rule; `AccountClosureGuard` breaks the account<->transaction cycle.

### Q7. How do Spring transactions work, and what are the common ways they silently fail?
**Short answer:** `@Transactional` wraps a bean in a proxy that opens/commits/rolls back a transaction around the call; anything that bypasses the proxy bypasses the transaction.
**Reasoning and implementation:** the proxy binds a connection to the thread; unchecked exceptions mark rollback; propagation decides join vs new. Self-invocation (`this.other()`), `private`/`final` methods and calls from non-managed objects skip the proxy. Swallowing an exception inside leaves the transaction rollback-only or, worse, commits partial work.
**Alternatives and trade-offs:** `TransactionTemplate` (explicit, no proxy surprises, can wrap part of a method), AOP-based declarative style (concise, hides boundaries).
**Risks and pitfalls:** I/O inside a transaction; lazy loading outside it; `readOnly` mistaken for security; long transactions holding connections.
**Likely follow-ups:** "difference between REQUIRED and REQUIRES_NEW?"; "what is `MANDATORY` good for?"
**In this project:** `LedgerService`, `AuditService.record` and `OutboxService.enqueue` are `MANDATORY` so a missing boundary fails loudly; `TransactionProcessor` uses `TransactionTemplate` because the external call must sit *between* two transactions.

### Q8. [Scenario] A teammate says "I annotated the service method `@Transactional` but the audit row is still written when the request fails." What do you check?
**Short answer:** is the audit write in a *separate* transaction (`REQUIRES_NEW`) or did the exception get swallowed, or is the call self-invoked?
**Reasoning and implementation:** check propagation on `AuditService`; if it is `REQUIRES_NEW` the row commits independently by design (denials must be audited even though the request rolls back). If it was meant to roll back, look for `catch` blocks converting exceptions into return values, calls via `this.`, and whether the exception type rolls back by default (checked exceptions do not). A debugger on `TransactionSynchronizationManager.isActualTransactionActive()` or transaction logging (`logging.level.org.springframework.transaction=TRACE`) shows boundaries.
**Alternatives and trade-offs:** if audit must be atomic with the change use `REQUIRED`/`MANDATORY`; if it must survive failure use `REQUIRES_NEW` (costs an extra connection - a pool-sizing consideration).
**Risks and pitfalls:** `REQUIRES_NEW` inside a loop under a small pool can deadlock the pool (outer holds one connection, inner needs another).
**Likely follow-ups:** "how many connections does a request hold in that case?"
**In this project:** `recordIndependent` (`REQUIRES_NEW`) for `ACCESS_DENIED`; `record` (`MANDATORY`) for state changes.

### Q9. Explain the Hibernate first-level cache, dirty checking and the N+1 problem.
**Short answer:** the persistence context caches loaded entities per transaction and flushes changes by comparing snapshots; N+1 is one query for parents plus one per child collection access.
**Reasoning and implementation:** within a transaction `findById` twice returns the same instance; modifications are detected at flush (before commit/queries). N+1 appears when iterating lazy associations; fix with fetch joins, `@EntityGraph`, batch fetching (`default_batch_fetch_size`) or DTO projections. Detect with SQL logging/`hibernate.generate_statistics` and tests that count statements.
**Alternatives and trade-offs:** avoid associations (this project stores ids and loads explicitly), read-model queries (jOOQ/native), caching.
**Risks and pitfalls:** `EAGER` mappings causing cartesian products; `open-in-view` hiding lazy loads in controllers; large persistence contexts in batch jobs (clear/flush).
**Likely follow-ups:** "difference between `save`, `persist`, `merge`?"; "why did `save()` throw an optimistic-locking exception for a new entity?"
**In this project:** entities reference other aggregates by id; wrapper `Long` version avoids the merge trap.

### Q10. [Scenario] `repository.save(new Entity())` throws `ObjectOptimisticLockingFailureException` on the first insert. Why?
**Short answer:** Spring Data decided the entity was *not new* (assigned id and a non-null/primitive version), called `merge`, and Hibernate found no row with that version.
**Reasoning and implementation:** `isNew` uses the version attribute when present: a **wrapper** `Long` that is null means new -> `persist`; a primitive `long` (always 0) or a getter that returns 0 for null makes it look existing. Fix: wrapper `Long version`, or implement `Persistable<ID>`, or let the database generate ids. Verify with a test inserting a fresh entity.
**Alternatives and trade-offs:** `Persistable` makes intent explicit at the cost of boilerplate; generated ids avoid the issue but change locality/portability.
**Risks and pitfalls:** "fixing" by catching the exception; adding `@Version` later to an existing entity without migration.
**Likely follow-ups:** "what does `@Version` do on update?" (adds `WHERE version = ?`, increments, throws on 0 rows).
**In this project:** the bug appeared on the first integration run (every submit returned `409`); the wrapper-version comment in `Customer/Account/FinancialTransaction` records why.

### Q11. How do you design exception handling for a REST API?
**Short answer:** one `@RestControllerAdvice` mapping every exception to a stable, safe error envelope; business errors carry a code; unexpected errors are generic and logged once with a correlation id.
**Reasoning and implementation:** an `ApiException(status, code, message)` for domain failures; handlers for validation (itemised violations), malformed JSON (never echo the payload), media type, optimistic lock (409), lock timeout (503 + `Retry-After`), security (403), and a catch-all (500, generic message). Filters outside MVC use the same envelope writer.
**Alternatives and trade-offs:** RFC 7807 problem details (standard, slightly more verbose); exceptions-as-flow-control versus result types for expected business outcomes.
**Risks and pitfalls:** leaking stack traces/SQL; inconsistent shapes between filters and controllers; logging the same exception at every layer.
**Likely follow-ups:** "which status for a business rule violation?" (422 vs 400/409 discussion).
**In this project:** `GlobalExceptionHandler`, `ErrorResponses`, `ServerErrorIT` (a fake JDBC URL and password never reach the client).

### Q12. What is the difference between authentication and authorization in Spring Security, and where do object-level checks belong?
**Short answer:** authentication establishes *who*, authorization decides *what* - and "what" has a role layer (annotations) and an object layer (domain policy).
**Reasoning and implementation:** the resource-server filter validates the JWT and builds an `Authentication`; `@PreAuthorize("hasRole('ADMIN')")` guards endpoints; but "may this customer see *this* account" depends on data, so it belongs in a pure `AccessPolicy` called by services with the loaded object.
**Alternatives and trade-offs:** `@PostAuthorize`/`PermissionEvaluator` (fine, but logic scattered in expressions), ABAC engines (OPA/Cedar) for larger rule sets, gateway-only checks (cannot see domain data).
**Risks and pitfalls:** relying on "authenticated" as authorization (BOLA); leaking existence with 403; testing only the happy path.
**Likely follow-ups:** "how do you test it exhaustively?" (the policy is pure: matrix tests).
**In this project:** `AccessPolicy` + `AccessPolicyTest` + 18 `SecurityIT` tests.

### Q13. [Scenario] A security reviewer says customers can read each other's transactions through `/transactions/{id}`. How do you confirm and fix it?
**Short answer:** reproduce with two customers, add a failing test, add an object-level check, return 404 and audit the attempt.
**Reasoning and implementation:** authenticate as Alice, request Bob's transaction id: if it returns 200, BOLA is confirmed. Write the test first (`SecurityIT.customerCannotTouchOthersTransactions`). Fix in the service: load, compute the owners of source/target accounts, call `AccessPolicy.canViewTransaction`; if false record an independent `ACCESS_DENIED` audit event and respond 404. Audit other endpoints that take ids (cancel, attempts, audit, ledger, search filters) - the same flaw is rarely single.
**Alternatives and trade-offs:** 403 is also defensible but confirms existence; database row-level security as a second layer (PostgreSQL RLS) - stronger but needs per-request context plumbing.
**Risks and pitfalls:** fixing one endpoint and missing list/search endpoints; relying on UI hiding.
**Likely follow-ups:** "how do you prevent regressions?" (a test per endpoint, review checklist, shared policy).
**In this project:** `TransactionService.requireVisible`, `SecurityIT`.

### Q14. How do you validate input in a Spring Boot API beyond `@NotNull`?
**Short answer:** layered validation: syntactic (Bean Validation on DTOs), semantic/business (domain rules), and storage constraints.
**Reasoning and implementation:** DTO records with `@Valid`: sizes, patterns (allow-list for free text), `@Digits`, enums, UUIDs; cross-field rules with `@AssertTrue`; strict JSON (unknown properties rejected) to stop mass assignment; business validation in a pure validator returning all violations; database `CHECK`/`UNIQUE` as the last line; return all violations with field names.
**Alternatives and trade-offs:** custom constraint annotations for reusable rules; programmatic validation for rules needing I/O.
**Risks and pitfalls:** validating only in the UI; deny-list regexes; echoing invalid payloads in errors; trusting `Content-Length`.
**Likely follow-ups:** "validation vs authorization order?" (authenticate -> authorize -> validate business rules that depend on data).
**In this project:** `SubmitTransactionRequest` (`accountsConsistentWithType`), `TransactionValidator`, constraints in V1.

### Q15. What is a good unit test, and how do you decide between mocking and using real objects?
**Short answer:** a good test fails when the code is wrong, is deterministic, and checks behaviour at the right level; mock *collaborators with side effects*, use real small objects otherwise.
**Reasoning and implementation:** pure logic needs no mocks (validator, policy). Orchestration with branches on outcomes (processor) uses mocks to force each branch (`Declined`, `Unknown`) and verifies only interactions that *are* the behaviour (no refund on `Unknown`; reserve before authorize). Use real `Account`/`FinancialTransaction` rather than mocking them. Check by deleting a line and seeing the test fail.
**Alternatives and trade-offs:** fakes (in-memory implementations) over mocks for stateful collaborators; integration tests for wiring.
**Risks and pitfalls:** over-mocking (tests restate the implementation); verifying every call; sleeping in tests.
**Likely follow-ups:** "how do you test code that uses `TransactionTemplate`?" (a no-op transaction manager).
**In this project:** `TransactionProcessorTest`, `LedgerServiceTest`, `NoOpTransactions`.

### Q16. How do you make time-dependent and random-dependent code testable?
**Short answer:** inject the clock, random source and sleeper.
**Reasoning and implementation:** `Clock` bean (`Clock.systemUTC()` in production, `Clock.fixed` in tests), `RandomGenerator` and a `Sleeper` functional interface in `RetryExecutor` so tests assert delays without sleeping; the rate limiter takes a nano-clock supplier so refill is tested by advancing a counter.
**Alternatives and trade-offs:** libraries that mock static time (fragile), `Thread.sleep` in tests (slow and flaky).
**Risks and pitfalls:** `Instant.now()` scattered in domain code; time zones (store UTC); tests that pass only at certain times of day.
**Likely follow-ups:** "how do you test a scheduler?" (call the method directly; make intervals configurable).
**In this project:** `RetryAndRateLimitTest`, `Clock` in services.

### Q17. [Scenario] A scheduled job processes a queue but under load the backlog grows although CPU is idle. Diagnose.
**Short answer:** the job's *scheduling pattern* limits throughput (one batch per tick), or work is serialised on a hot resource; measure, then make it work-conserving or parallel.
**Reasoning and implementation:** compute the ceiling: batch 20 per 500 ms = 40/s at best; measured drain was ~23 tx/s because per-transaction latency plus the tick gap. Change to a work-conserving loop (keep draining while work exists, with a time budget) - measured ~34 tx/s on the same machine; next steps: parallel workers (safe thanks to lease + optimistic version), `SKIP LOCKED`, or a broker relay. Verify with the same load script before/after.
**Alternatives and trade-offs:** more instances (scale-out) vs smarter polling; push (LISTEN/NOTIFY, broker) vs poll.
**Risks and pitfalls:** unbounded loops starving other scheduled tasks (time budget), double processing without idempotency.
**Likely follow-ups:** "how do you make sure two workers do not process the same event?" (lease + `@Version`).
**In this project:** `ProcessingScheduler.drainWithinBudget`, `docs/validation/perf-baseline*.json`.

### Q18. How do you externalise configuration and keep secrets out of the application?
**Short answer:** typed properties with safe defaults, overridden by environment variables; secrets come from a secret store at runtime.
**Reasoning and implementation:** `application.yml` holds defaults and every tunable is `${ENV:default}`; `@ConfigurationProperties` records bind and validate; profiles switch behaviour (`local` seeds and the demo issuer); production profile has no issuer so the app fails closed without `OIDC_ISSUER_URI`; secrets live in Secrets Manager/Vault, surfaced as Kubernetes Secrets and referenced with `secretKeyRef`.
**Alternatives and trade-offs:** Spring Cloud Config/Vault integration (more moving parts), mounted files vs env (files avoid process listings; env is simpler).
**Risks and pitfalls:** defaults that are secrets; profile-specific behaviour that weakens security in production; secrets in logs/actuator `env`.
**Likely follow-ups:** "how do you rotate a DB password?" (dual-user overlap + rolling restart).
**In this project:** `.env.example` (placeholders), compose `:?` required variables, `external-secret.example.yaml`.

### Q19. What do you expose through Actuator and how do you protect it?
**Short answer:** health (liveness/readiness), info and Prometheus metrics only, on a separate management port in containers, never through the ingress.
**Reasoning and implementation:** `management.endpoints.web.exposure.include=health,info,prometheus`, probes enabled, `show-details: never`, management port 9090 (NetworkPolicy allows only the monitoring namespace), no `env/heapdump/threaddump` exposure. A *business* health view is a separate staff-only endpoint.
**Alternatives and trade-offs:** securing actuator with a role on the main port (credentials for Prometheus scraping), service-mesh policy.
**Risks and pitfalls:** exposing `env`/`heapdump` (secrets, memory), putting dependency checks in the liveness probe (restart storms).
**Likely follow-ups:** "difference between liveness and readiness?"
**In this project:** `scripts/check-management-port.mjs` proved actuator answers on the management port and 404s on the public one.

### Q20. How do you configure graceful shutdown and why does it matter?
**Short answer:** stop accepting new requests, finish in-flight work within a bounded time, then exit - so deployments do not break requests.
**Reasoning and implementation:** `server.shutdown=graceful`, `spring.lifecycle.timeout-per-shutdown-phase=20s`, scheduler `await-termination`; in Kubernetes add `preStop: sleep 10` so the load balancer deregisters before SIGTERM, and a `terminationGracePeriodSeconds` larger than both. The processor is also crash-safe (outbox redelivery, recovery), so a hard kill loses no money.
**Alternatives and trade-offs:** connection draining at the proxy; shorter grace for faster deploys.
**Risks and pitfalls:** grace period shorter than the drain; long-running background jobs ignoring interruption.
**Likely follow-ups:** "what happens to a request that arrives after SIGTERM?"
**In this project:** `application.yml`, `platform-service.yaml` (`terminationGracePeriodSeconds: 45`).

### Q21. [Scenario] Explain how you would add a new transaction type (e.g. "fee") without breaking existing behaviour.
**Short answer:** extend the closed set deliberately and let the compiler and tests show every place that must change.
**Reasoning and implementation:** add the enum value; the exhaustive `switch` statements in validator/ledger/processor fail to compile until handled; add DB `CHECK` update via a new migration (expand: widen constraint), validator rules, ledger postings and entry types, API DTO rules (`accountsConsistentWithType`), UI form rules, BDD scenario and tests (unit, integration, concurrency if balances change); keep the API additive (new enum value is a *client-visible* change - document tolerant-reader expectations).
**Alternatives and trade-offs:** strategy per type with registration (more open, less exhaustive checking), or a type table in the DB.
**Risks and pitfalls:** forgetting the DB constraint or the frontend; clients with exhaustive enums breaking on a new value.
**Likely follow-ups:** "is adding an enum value a breaking change?"
**In this project:** `TransactionType`, `TransactionValidator.validate` switch, `ck_tx_type`.

### Q22. What are Java records and sealed interfaces good for, and where do you use them?
**Short answer:** records are immutable data carriers with generated `equals/hashCode/toString`; sealed interfaces model closed alternatives that the compiler can check exhaustively.
**Reasoning and implementation:** DTOs, results and config are records (less boilerplate, immutability); `ClearingResult` is a sealed interface with `Authorized | Declined | NotFound | NotSent | Unknown`, so the processor's pattern-matching `switch` has no `default` and a new variant fails compilation until handled.
**Alternatives and trade-offs:** Lombok (annotation processing, less explicit), enums with fields (no per-variant data), class hierarchies with visitors (verbose).
**Risks and pitfalls:** records are shallowly immutable (mutable components), JPA entities cannot be records, serialisation of records needs a recent Jackson.
**Likely follow-ups:** "what is pattern matching for switch?"
**In this project:** `ClearingClient.ClearingResult`, DTO records in `*Dtos`.

### Q23. How would you profile and fix a slow Spring Boot endpoint?
**Short answer:** find where the time goes (trace/metrics), then fix the biggest contributor with a before/after measurement.
**Reasoning and implementation:** (1) `http_server_requests` by `uri` and percentile; (2) a trace to split time into DB, remote call and application; (3) database: statement timings, `EXPLAIN ANALYZE`, N+1 counts; (4) resource saturation: pool pending, threads, GC, CPU throttling; (5) JFR/async-profiler for CPU; (6) fix (index/paging/batching/cache/timeouts) and re-measure.
**Alternatives and trade-offs:** caching first (hides a bad query), scaling out (only helps if the bottleneck is per-instance).
**Risks and pitfalls:** optimising without a baseline; testing on tiny data; averages instead of percentiles.
**Likely follow-ups:** "p99 is bad but p50 fine?" (queuing, GC, lock waits, noisy neighbours).
**In this project:** `performance-troubleshooting.md`, captured query plans, baseline script.

### Q24. [Scenario] Your service starts but every API call returns 401 after a deployment. What are the likely causes?
**Short answer:** token validation configuration: issuer, keys, clock, audience or egress to the identity provider.
**Reasoning and implementation:** decode a token (header `kid`, `iss`, `exp`) and compare with `OIDC_ISSUER_URI`; check the pod can reach the JWKS endpoint (NetworkPolicy/egress/DNS/TLS trust); check clock skew (NTP); check role-claim mapping (401 vs 403 distinction); confirm the active profile did not enable the local issuer or remove the decoder. The service is fail-closed, so a missing validator crashes at startup rather than returning 200s.
**Alternatives and trade-offs:** shorter JWKS cache for faster key rotation vs more IdP calls.
**Risks and pitfalls:** "fixing" by disabling validation; logging tokens while debugging.
**Likely follow-ups:** "how do you roll keys at the IdP safely?" (publish new key, switch signing, retire old after TTL).
**In this project:** troubleshooting exercise 6; `SecurityIT` token tests.
