# Java / Spring Boot backend architecture

## Technology choices (pinned)

| Concern | Choice | Notes |
|---|---|---|
| Language/runtime | Java 21 (LTS) | records for DTOs and results, sealed interface for `ClearingResult`, pattern-matching `switch`, text blocks |
| Framework | Spring Boot 3.5.16 | Spring MVC (servlet), Spring Security 6, Spring Data JPA/Hibernate 6, Bean Validation, Actuator |
| Persistence | PostgreSQL (prod), H2 PostgreSQL-mode (local/tests), Flyway 11 | `ddl-auto: validate` |
| Resilience | hand-written `RetryExecutor` (backoff + full jitter), Resilience4j `CircuitBreaker` | one small library instead of the full starter: fewer moving parts |
| API docs | springdoc-openapi 2.8 | contract committed and tested |
| Observability | Micrometer + Prometheus registry, Micrometer Tracing (OpenTelemetry bridge), ECS structured logs | |
| Tests | JUnit 5, Mockito, AssertJ, Spring Boot Test, Testcontainers, embedded PostgreSQL (test scope) | |
| Build | Maven 3.9, surefire (`*Test`) + failsafe (`*IT`), JaCoCo | |

Spring Cloud is **not** used: with one deployable there is no config server, discovery or gateway to justify it (ADR-001). Redis,
Kafka and RabbitMQ are **not** used either - the in-database outbox gives reliable asynchronous processing with one fewer system to run,
and ADR-006 records when a broker (and a Redis-backed rate limiter) would be introduced. Fewer dependencies is a design decision here.

## Package structure (modular monolith)

```
com.fintechdemo.platform
  common/        ApiException, ApiError, GlobalExceptionHandler, MoneyPolicy, filters (correlation id, size limit), PageableSupport, Masking
  security/      SecurityConfig, AccessPolicy (pure), AuthenticatedUser, RateLimitFilter, local issuer (profile-gated)
  customer/      Customer (entity), CustomerService, CustomerController, DTOs
  account/       Account (entity with debit/credit invariants), AccountService, controller, AccountClosureGuard (port)
  transaction/   FinancialTransaction + TransactionStatus (state machine), TransactionValidator (pure), DailyLimitPolicy (pure),
                 TransactionService (submit/review/cancel/query), LedgerService, TransactionProcessor, OutboxService/Dispatcher,
                 ReconciliationService, TransactionMaintenance, ProcessingScheduler, repositories
  clearing/      ClearingClient (port + sealed result), RestClearingClient, InProcessClearingClient, RetryExecutor, ClearingConfig
  audit/         AuditEvent (immutable), AuditService
  ops/           OpsService (read models), OpsController, PlatformMetrics
  config/        AppConfig (Clock, TransactionTemplates, OpenAPI definition)
```

Dependency direction: `web -> services -> repositories`; `transaction -> account -> customer`; `account` reaches `transaction` only through the
`AccountClosureGuard` port (dependency inversion), so there is no package cycle. Controllers translate and delegate; entities carry invariants
(`Account.debit` refuses to go below the minimum balance; `FinancialTransaction.transitionTo` refuses illegal moves) but are never serialised.

## Patterns used (and why)

| Pattern | Where | Why |
|---|---|---|
| **State machine** | `TransactionStatus`, `AccountStatus` | legal moves in one place, tested exhaustively |
| **Port and adapter** | `ClearingClient` -> `RestClearingClient` / `InProcessClearingClient` / test double | the domain does not know HTTP; swap for tests and local runs |
| **Strategy/policy objects (pure functions)** | `TransactionValidator`, `AccessPolicy`, `DailyLimitPolicy`, `MoneyPolicy` | rules without I/O are trivially unit-testable |
| **Transactional outbox** | `OutboxService` / `OutboxDispatcher` | atomic "state change + announcement" without distributed transactions |
| **Idempotent receiver** | `TransactionProcessor`, idempotency keys | at-least-once delivery without duplicate effects |
| **Compensation** | `LedgerService.reverseWithdrawal` | undo reserved funds when an external step fails |
| **Template method via `TransactionTemplate`** | `TransactionProcessor`, `TransactionService.submit` | explicit, visible transaction boundaries (and no `@Transactional` self-invocation pitfalls) |
| **Specification** | `CustomerService/AccountService/TransactionService.search`, audit search | composable, parameterised filters (no string-built SQL) |
| **Facade / DTO** | controllers + `*Dtos` | stable public contract independent of persistence |
| **Dependency inversion** | `AccountClosureGuard` | keeps module dependencies one-directional |
| **Circuit breaker / retry with jitter** | `RestClearingClient` | failure isolation |

SOLID in practice: single-responsibility (the `LedgerService` is the *only* code that mutates balances; the validator only decides; the processor only
orchestrates), open/closed (a new transaction type touches the validator, ledger and processor switch - and the compiler's exhaustive `switch` flags every
place), Liskov (all `ClearingClient` implementations honour the three-way result contract), interface segregation (small ports), dependency inversion (above).

## Transaction boundaries in code

* `@Transactional(propagation = MANDATORY)` on `LedgerService`, `AuditService.record`, `OutboxService.enqueue`: these *cannot* be called without an
  enclosing transaction - a missing boundary fails loudly in tests instead of silently committing a half-change.
* `AuditService.recordIndependent` (`REQUIRES_NEW`) for access denials, because the request is about to throw and roll back.
* Programmatic `TransactionTemplate`s (`transactionTemplate`, `readOnlyTransactionTemplate`) for the processor and submit, where the boundary must
  be *around some statements but not others* (the external call).
* A detail that bit during development and is documented in the code: both templates are injected **by parameter name**; marking one `@Primary`
  would win over name matching and silently hand the read-write template to the read-only injection points.
* Another real one: entities use a **wrapper `Long` version** because Spring Data decides "new vs. existing" from a null version; a primitive (or a getter that
  hides null) made `save()` merge a brand-new entity, which Hibernate reported as an optimistic-locking failure.

## Configuration

`application.yml` holds safe defaults and every tunable as an environment variable (`DB_*`, `CLEARING_URL`, `RATE_LIMIT_*`, `OIDC_ISSUER_URI`,
`MANAGEMENT_SERVER_PORT`, `TRACING_SAMPLING`, ...). Profiles: `local` (seed data, local issuer, public API docs), `postgres` (PostgreSQL driver/dialect), and
none for production-style runs (OIDC issuer required: the application **fails to start** without any `JwtDecoder`, i.e. it fails closed).
`@ConfigurationProperties` records (`ClearingProperties`, `ProcessingProperties`, `TransactionProperties`, `SecurityProperties`) make settings typed and testable.

## Graceful shutdown

`server.shutdown=graceful`, `spring.lifecycle.timeout-per-shutdown-phase=20s`, scheduler `await-termination`: on `SIGTERM` the server stops accepting
new requests, finishes in-flight work and background batches, then exits. The processor is crash-safe anyway (outbox redelivery + recovery), so a hard kill
loses no money - graceful shutdown just avoids needless retries.
