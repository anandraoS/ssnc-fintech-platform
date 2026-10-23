# Code-review scenarios

Seven realistic pull requests. Each has the **problem**, the **investigation** (how a reviewer finds it), the **solution**, the **trade-offs** and the **regression tests** (existing in this repository where noted).

## 1. "Check the balance, then update it" (race condition)

**Problem.** A PR adds withdrawals like this:
```java
Account a = accounts.findById(id).orElseThrow();
if (a.getBalance().compareTo(amount) < 0) throw insufficientFunds();
a.setBalance(a.getBalance().subtract(amount));      // read-modify-write, no lock
accounts.save(a);
```
**Investigation.** Ask: *what if two requests run this at the same moment?* Both read 100, both pass the check for 80, both write 20: 160 left the account. It passes every single-threaded unit test. Look for the missing lock/version, run two threads (the repository's concurrency test), read the DB constraints (`balance >= 0` would turn this into an error, but only for the second writer *after* money logic already assumed success).
**Solution.** Take the row lock before reading (`accounts.lockById` -> `SELECT ... FOR UPDATE`), check and change inside the same transaction, keep the invariant also in a `CHECK` constraint; this is `LedgerService.reserveWithdrawal`.
**Trade-offs.** Pessimistic locking serialises per account (lock waits, deadlock risk -> ordered locks, bounded timeout) in exchange for simplicity and no retry storms; the alternative `UPDATE ... WHERE balance >= :x` is fine for a single row but cannot also enforce the ledger/limit/status checks in one critical section.
**Regression tests.** `ConcurrencyScenarios.concurrentWithdrawalsNeverOverspend` (H2 *and* PostgreSQL), `SchemaConstraintsIT.balanceCannotGoNegative`.

## 2. Controller loads by id without an ownership check (BOLA)

**Problem.** `@GetMapping("/accounts/{id}") Account get(@PathVariable UUID id) { return repo.findById(id).orElseThrow(); }` - and it returns the entity.
**Investigation.** For every `{id}` ask *whose is it?* There is no comparison with the caller's customer. Also: it serialises an entity (leaks fields; lazy-loading surprises) and returns `500` for unknown ids. Try it: authenticate as customer A, request customer B's id.
**Solution.** Go through a service that loads the object and calls `AccessPolicy.canViewAccount(user, account.customerId)`; return `404` plus an independent `ACCESS_DENIED` audit row; map to a DTO (`AccountService.requireVisible`, `toResponse`).
**Trade-offs.** `404` instead of `403` hides existence (good) but makes debugging slightly harder (hence the audit event). Centralising the check costs one extra lookup per request - negligible.
**Regression tests.** `SecurityIT.customerCannotReadOthersAccounts`, `searchesAreScoped`, `cannotSubmitAgainstOthersAccounts`; `AccessPolicyTest`.

## 3. `double` for fees and totals

**Problem.** `double fee = amount.doubleValue() * 0.0125; BigDecimal.valueOf(fee)` and `if (total == 100.0)`.
**Investigation.** Grep for `double`, `float`, `doubleValue`, `Math.round` near money. Demonstrate: `0.1 + 0.2 != 0.3`; `new BigDecimal("2.0").equals(new BigDecimal("2.00"))` is false.
**Solution.** `MoneyPolicy.percentageOf(base, basisPoints, currency)` with `HALF_EVEN` and the currency's scale; `compareTo` for comparisons; allocation that preserves cents (`allocate`). Money in JSON as strings.
**Trade-offs.** `BigDecimal` is slower and verbose (irrelevant at this volume); minor-unit `long` is an alternative with its own awkwardness for fractional rates.
**Regression tests.** `MoneyPolicyTest` (float vs decimal, HALF_EVEN ties, allocation, equals vs compareTo), `DailyLimitPolicyTest.scaleDoesNotMatter`, `AccountDtos` string serialisation (`ApiContractIT.moneyIsAString`).

## 4. `@Transactional` around a REST call

**Problem.** `@Transactional void process(id) { debit(); clearing.authorize(); markCompleted(); }`
**Investigation.** Draw the timeline: the row lock and a pooled connection are held for the *duration of an HTTP call*, retries and timeouts included. Under a slow dependency the pool drains (`hikaricp_connections_pending > 0`), every request thread waits, the whole API stalls although the database is idle. Also: if the call succeeds but the commit fails, money left without a record.
**Solution.** Split the boundaries (ADR-003): commit "funds reserved", call with no transaction open, commit the outcome; classify the result (`Unknown` -> reconciliation). See `TransactionProcessor`.
**Trade-offs.** More states and a reconciliation path; far shorter lock/connection hold times and honest handling of uncertainty.
**Regression tests.** `TransactionProcessorTest` (order: reserve before authorize; Unknown does not refund), `TransactionFlowIT.unknownOutcome*`, chaos e2e (breaker opens, pool unaffected).

## 5. Retrying a non-idempotent call

**Problem.** `@Retryable` on a `POST /payouts` client method "to be resilient".
**Investigation.** Ask what a *timeout* means: the request may have executed. A retry then pays twice. Check whether the remote operation is keyed by a stable id, whether retries have backoff **and jitter**, whether there is a cap and a circuit breaker.
**Solution.** Only retry because `authorize` is idempotent on our `reference` (the contract); `RetryExecutor` with exponential backoff and full jitter, bounded attempts; classify post-retry failure as `Unknown`, never as "failed"; breaker to stop hammering.
**Trade-offs.** Retries add latency and load during an outage (breaker mitigates); relying on the remote's idempotency is a contract assumption that must be verified with the provider (ADR-011).
**Regression tests.** `RestClearingClientTest` (retries 503s, UNKNOWN after exhaustion, NotSent only for pre-delivery failures, breaker short-circuit), `RetryAndRateLimitTest` (jitter bounds, no retry of non-retryable errors).

## 6. Entity exposed over the API + mass assignment

**Problem.** `@PostMapping Customer create(@RequestBody Customer c)`.
**Investigation.** The client can set `status`, `version`, `id`, `createdAt`; the response leaks internals (tax id, version); schema changes break clients; unknown fields are silently accepted.
**Solution.** Request/response DTOs with Bean Validation, a service mapping layer, `FAIL_ON_UNKNOWN_PROPERTIES`, masked responses by role.
**Trade-offs.** Mapping boilerplate (records keep it short); a stable contract and an enforced boundary in exchange.
**Regression tests.** `SecurityIT.inputHardening` (mass-assignment attempt -> 400), `piiMasking`, `ApiContractIT.validationEnvelope`.

## 7. Swallowed exception and a "temporary" `catch (Exception e) { log.warn(...) }`

**Problem.** The processor catches everything, logs, and returns - the outbox event is then marked dispatched and the transaction sits in `VALIDATED` forever.
**Investigation.** Follow what each exception *means*: business failures must produce a terminal state; technical failures must *propagate* so the retry mechanism runs; and a catch that logs-and-continues turns both into silent data loss. Check metrics: backlog constant, no failures counted.
**Solution.** `TransactionProcessor` catches **only** `ApiException` (business) and records `FAILED`; everything else propagates to the dispatcher, which retries with backoff and dead-letters after N attempts (alert).
**Trade-offs.** Noisier logs while an outage lasts; no lost work.
**Regression tests.** `TransactionProcessorTest.technicalFailuresPropagate`, `.ledgerBusinessFailureFailsTransaction`, `OutboxDispatcherTest` (retry vs dead letter), `OutboxDeadLetterIT`.
