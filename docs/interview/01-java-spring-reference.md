# Java and Spring Boot reference

## JVM and garbage collection

*Analogy:* the heap is a big workshop floor; the garbage collector is a cleaner who walks around removing tools nobody is holding any more. Young objects die fast (most requests create short-lived garbage), so the
floor is divided into a small "young" area that is swept often and cheaply and an "old" area swept rarely and expensively (generational hypothesis).

* **Memory areas:** heap (objects), metaspace (class metadata, native memory), thread stacks, code cache, direct buffers. A container's RSS is *more* than heap - leave headroom (`MaxRAMPercentage=75`).
* **G1 (default):** region-based, mostly concurrent, targets a pause goal (`-XX:MaxGCPauseMillis=200`). Young collections are stop-the-world but short; mixed collections reclaim old regions; **Full GC** is the failure mode (heap too small, humongous allocations, evacuation failure).
  ZGC/Shenandoah: sub-millisecond pauses, larger footprint - use when latency SLOs demand it and measurements show pause-bound behaviour.
* **Diagnosing:** `-Xlog:gc*`, `jvm_gc_pause_seconds` by cause, `jcmd <pid> GC.heap_dump`, JFR (`JFR.start`), MAT dominator tree. *Example (beginner):* heap-after-GC low points rise hourly = leak. *Example (advanced):* "to-space exhausted" = allocation outruns evacuation: reduce allocation or raise the heap before touching flags.
* **Common leak sources in services:** unbounded caches/maps, `ThreadLocal`s on pooled threads, listeners never removed, unpaged queries. **In this project:** list endpoints are paged (cap 100), the rate-limiter map is bounded, heap dump on OOM is enabled in the image.
* **Virtual threads (Java 21):** cheap blocking threads (`spring.threads.virtual.enabled=true`). They remove *thread* scarcity, not *connection* scarcity - the Hikari pool still limits DB concurrency; `synchronized` blocks pin carrier threads in 21.

## Concurrency

*Analogy:* a bank branch with one safe: a lock is the key to the safe; a deadlock is two tellers each holding one key and waiting for the other's.

* **Memory model:** `volatile` gives visibility/ordering for a single variable, not atomic compound actions; `synchronized`/locks give mutual exclusion + happens-before; `java.util.concurrent` atomics use CAS.
* **Race condition vs data race:** a data race is unsynchronised conflicting access; a *race condition* is a logic error that depends on timing - a check-then-act on a balance is a race condition even with fully synchronised accessors. (Therefore the database lock, not a Java `synchronized`, is what protects a balance in a multi-instance deployment.)
* **Deadlock:** needs mutual exclusion, hold-and-wait, no preemption, circular wait. Break circular wait with a **global lock order** (the ledger locks accounts in ascending id order). Detect with thread dumps / the database's detector; bound waits with timeouts.
* **Executors:** size pools for the workload (CPU-bound ~ cores, I/O-bound larger or virtual threads), bound queues, name threads, handle rejection; never use unbounded pools for request work.
* **CompletableFuture / structured concurrency** for fan-out; always set timeouts. **Thread-safety of Spring beans:** singletons must be stateless (or carefully synchronised: `TokenBucketRateLimiter` synchronises per bucket).
* **Testing concurrency:** start threads together with a `CountDownLatch`, one thread per task, assert the final state and invariants, add `@Timeout` (a hung latch is a test bug - one occurred while building this project: a pool smaller than the task count).

## Collections and data structures

| Structure | Use | Complexity / note |
|---|---|---|
| `ArrayList` | default list | O(1) index, amortised O(1) append, O(n) middle insert |
| `LinkedList` | rarely | O(1) at ends, O(n) index; poor cache locality - almost never the right choice |
| `HashMap` | lookup | O(1) average; needs consistent `equals/hashCode`; resize cost; not thread-safe |
| `ConcurrentHashMap` | shared map | lock-striped/CAS; `compute*` operations are atomic per key (used for the rate-limiter buckets and the simulator store) |
| `TreeMap/TreeSet` | sorted | O(log n), range queries |
| `EnumMap/EnumSet` | enum keys | array-backed, fastest (the state machine uses `EnumSet`) |
| `ArrayDeque`, `PriorityQueue` | queues | deque for stacks/queues; heap for scheduling |
| `List.of/Set.of/Map.of` | immutables | no nulls, defensive copying (`copyOf`) |

Pitfalls: mutable keys, `equals` without `hashCode`, `BigDecimal.equals` (scale) vs `compareTo`, modifying a collection while iterating, `Arrays.asList` is fixed-size, streams are single-use and `parallelStream` on the common pool is rarely appropriate in a server.

## Dependency injection and Spring fundamentals

*Analogy:* instead of each class building its own tools, a workshop foreman (the container) hands them the right tools when they arrive.

* Constructor injection (immutability, testability, no hidden dependencies); a single constructor needs no `@Autowired`. Scopes: singleton (default), prototype, request.
* **Resolution:** by type; ties broken by `@Primary`, then `@Qualifier`, then parameter/field **name**. *Gotcha from this project:* with two `TransactionTemplate` beans, marking one `@Primary` would override name matching and silently give the read-only injection point the wrong template.
* **Configuration:** `@ConfigurationProperties` records (typed, validated), profiles, `@ConditionalOnProperty` (the local issuer exists only when enabled), externalised configuration order (env > application-{profile}.yml > application.yml).
* **Lifecycle:** `@PostConstruct`, `SmartLifecycle`, graceful shutdown phases; AOP proxies (transactions, security, async) apply only to calls that go **through the proxy** - self-invocation bypasses them.
* **Auto-configuration:** conditional beans; `--debug` prints the conditions report; back-off semantics (a user-defined `JwtDecoder` makes the issuer-based one back off).

## Spring transactions

* `@Transactional` creates a proxy that begins/commits/rolls back around the method. **Rollback rules:** unchecked exceptions roll back by default, checked do not (unless `rollbackFor`).
* **Propagation:** `REQUIRED` (join or create), `REQUIRES_NEW` (suspend and start a new one - used for audit rows of denials that must survive a rollback), `MANDATORY` (must already exist - used for ledger/audit/outbox code that must never run unprotected), `NOT_SUPPORTED`, `NEVER`, `NESTED` (savepoints).
* **Pitfalls:** self-invocation, `private` methods, exceptions swallowed inside (transaction marked rollback-only), long transactions holding connections, I/O inside a transaction, lazy loading outside it (`open-in-view: false`), `readOnly=true` is a hint (not a security feature).
* **Programmatic `TransactionTemplate`:** when the boundary must wrap *some* statements and exclude others - the processor's external call. Also avoids proxy surprises.
* **Isolation/locking:** see the database chapter. **Events:** `@TransactionalEventListener(AFTER_COMMIT)` for post-commit work - or, for reliability, the outbox (this project) because an after-commit listener can lose the event if the process dies right after commit.

## Hibernate / JPA

* **Entity lifecycle:** transient -> managed (persistence context, dirty checking) -> detached -> removed. `save()` on a managed entity is a no-op for updates; flush happens at commit/query.
* **`isNew` trap:** Spring Data's `save()` calls `persist` when the id is null or the **version attribute is null**, else `merge`. With assigned UUID ids and a *primitive or non-null* version, a brand-new entity is merged, Hibernate sees "version 0 but no row" and throws a stale-state/optimistic failure. *Real bug found here*; fix: wrapper `Long` version.
* **Fetching:** LAZY by default for associations; N+1 arises when iterating lazy associations or running one query per parent - fix with fetch joins, `@EntityGraph`, batch fetching (`default_batch_fetch_size`), or DTO projections. This project avoids associations entirely (ids only) to keep aggregate boundaries explicit.
* **Locking:** `@Version` optimistic; `@Lock(PESSIMISTIC_WRITE)` + `jakarta.persistence.lock.timeout` for `SELECT ... FOR UPDATE` (here with a 5 s bound).
* **Mapping tips:** `@Enumerated(STRING)` (never ordinal), `BigDecimal` with `precision/scale`, `Instant` in UTC, `@Column(updatable=false)` for immutables, `ddl-auto: validate` with Flyway.
* **Specifications/Criteria** for dynamic filters (parameterised - no injection); projections for read models; avoid `findAll()` on growing tables.
* **Batching:** `hibernate.jdbc.batch_size`, `order_updates`; IDENTITY ids disable insert batching (UUID/sequence allow it).

## REST APIs and exception handling

*Analogy:* an API is a restaurant menu: stable names, clear descriptions, and the kitchen can change as long as the dishes do not.

* Resource nouns, HTTP verbs, status codes (the API chapter table), idempotency of `GET/PUT/DELETE`, *not* of `POST` (hence idempotency keys), content negotiation, pagination, filtering, versioning, HATEOAS (rarely worth it), conditional requests (`ETag`/`If-Match` for lost-update protection - an alternative to a `version` field in the body).
* **Validation:** Bean Validation on DTOs (`@Valid`), custom constraints, group-level validation (`@AssertTrue` for cross-field rules), validate at the boundary and again in the domain.
* **Error handling:** one `@RestControllerAdvice`, stable machine-readable `code`, safe `message`, correlation id, logging once. Map technical exceptions (optimistic lock -> 409, lock timeout -> 503 with `Retry-After`, constraint violation -> 409); never leak internals. RFC 7807 `application/problem+json` is the standard envelope many teams adopt - this project uses a simpler custom envelope with the same ideas.
* **Jackson:** strict (`FAIL_ON_UNKNOWN_PROPERTIES`), `BigDecimal` as string (`@JsonFormat(shape=STRING)`), `Instant` ISO-8601, never serialise entities.

## Security (Spring Security 6)

* Filter chain: `SecurityFilterChain` bean; `oauth2ResourceServer().jwt()`; `@EnableMethodSecurity` + `@PreAuthorize("hasRole(...)")`; custom `AuthenticationEntryPoint`/`AccessDeniedHandler` for JSON errors; `SessionCreationPolicy.STATELESS`.
* **JWT validation:** signature (JWKS), `exp/nbf`, `iss`, optionally `aud`; map claims to authorities with a converter; never trust claims the IdP did not sign.
* **CSRF:** needed for cookie-based sessions, unnecessary for header-bearer APIs - a conscious, documented decision. **CORS:** allow-list, not `*`, no credentials. **Headers:** CSP, HSTS, `X-Content-Type-Options`, frame options, referrer policy.
* **Object-level authorization** is a *domain* rule (`AccessPolicy`) - annotations alone cannot express "this customer's account". Passwords: BCrypt/Argon2 (the demo issuer uses BCrypt and a decoy hash for constant-ish login time).

## Testing

JUnit 5 (`@Test`, `@DisplayName`, parameterised tests, `@Timeout`), AssertJ (fluent assertions), Mockito (mocks/spies/`InOrder`; use sparingly), Spring Boot Test (`@SpringBootTest`, `MockMvc`, slices), Testcontainers/embedded PostgreSQL for real database behaviour,
`@DynamicPropertySource` for wiring ports, `spring-security-test` or real tokens. **Test pyramid:** many fast unit tests, fewer integration tests, few end-to-end tests. **Flaky tests** come from time, shared state, ordering and concurrency - fix the cause.

## Performance

Measure first (profilers, JFR, async-profiler, metrics); fix algorithmic and I/O problems before micro-optimising; N+1 and unbounded results dominate real services; connection-pool and timeout design matter more than JVM flags; cache after the query is right; use
backpressure and bounded queues; keep transactions short. **Latency percentiles** (p95/p99) tell the user's story, averages hide tails; beware *coordinated omission* when load testing (use arrival-rate executors).
