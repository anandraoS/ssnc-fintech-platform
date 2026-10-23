# Troubleshooting exercises

Six exercises for practising production investigation. Each states the **problem**, the **investigation** (what to look at, in order), the **solution**, the **trade-offs** and the **regression tests**.

## Exercise 1 - p95 latency explodes at peak, database is idle

**Problem.** At 09:00 p95 goes from 80 ms to 12 s; CPU is low; the database dashboard looks calm; no errors for the first minutes, then timeouts.
**Investigation.** (1) Latency by `uri`: all endpoints, so a shared resource. (2) `hikaricp_connections_pending` > 0 and `active == max`: **pool exhaustion**. (3) Thread dump: request threads `WAITING` in `HikariPool.getConnection`; the connection holders are in `RestClient`/socket read - a transaction wraps an HTTP call. (4) `pg_stat_activity`: many `idle in transaction`. (5) The clearing network is slow today.
**Solution.** Remove the remote call from the transaction (reserve funds, commit, call, commit); keep a hard read timeout (2 s) and the circuit breaker; alert on pool pending and acquire-time p95.
**Trade-offs.** Extra states (`RECONCILIATION_REQUIRED`) and a reconciler; bounded blast radius. Increasing the pool "to fix it" would only move the failure to PostgreSQL's `max_connections`.
**Regression tests.** `TransactionProcessorTest.withdrawalAuthorized` (reserve precedes call), chaos e2e, alert `ConnectionPoolSaturated`.

## Exercise 2 - intermittent duplicate deposits

**Problem.** Support sees pairs of identical deposits a few seconds apart, only for mobile users on poor networks.
**Investigation.** Compare the pair: different transaction ids, different or missing idempotency keys? Audit trail `TRANSACTION_SUBMITTED` details and correlation ids: two requests. Client log: the first request timed out, the app retried **with a freshly generated key**.
**Solution.** Client must generate the key once per *logical* action and reuse it on retry (`IdempotencyKeys`); the server already refuses to accept a missing key; add the key to the UI's retry path. Server side nothing was wrong - the replay protection worked for same-key retries.
**Trade-offs.** A user pressing the button twice deliberately is *meant* to create two payments; idempotency distinguishes retries from intents only via the key.
**Regression tests.** `IdempotencyIT` (replay, concurrent, key reuse), SPA specs "reuses the SAME key when retrying an unchanged payload" and "new key when the payload is edited".

## Exercise 3 - sporadic deadlock errors on transfers

**Problem.** `deadlock detected` from PostgreSQL a few times an hour; the affected transfers succeed on retry.
**Investigation.** The PostgreSQL log prints both statements and lock targets: two `UPDATE accounts` on rows A and B in opposite order. Find the code path: a new batch job that applies transfers from a file, locking source first. Compare with `LedgerService.applyTransfer`, which sorts the ids.
**Solution.** Route the batch through `LedgerService` (single place that orders locks); never add a second path that mutates balances; keep lock waits bounded and treat deadlock victims as retryable.
**Trade-offs.** A total lock order is cheap and complete for a known set of rows; ad-hoc "retry on deadlock" alone hides the bug and costs throughput.
**Regression tests.** `LedgerServiceTest.locksInAscendingIdOrder`, `ConcurrencyScenarios.oppositeTransfersDoNotDeadlock` on H2 and PostgreSQL.

## Exercise 4 - heap grows until the pod is OOM-killed

**Problem.** Pods restart every ~6 hours with `OOMKilled`; heap-after-GC rises steadily.
**Investigation.** Heap dump (`jcmd GC.heap_dump`) -> MAT dominator tree: a huge `ArrayList<FinancialTransaction>` retained by a request thread; the code is `repo.findAll()` in a new "export" endpoint. RSS vs heap vs limit tells whether it is heap or native.
**Solution.** Page every list endpoint (cap 100), stream exports or use keyset batches, add a test that asserts the page cap, add a heap-high alert.
**Trade-offs.** Exports become multi-request or asynchronous jobs.
**Regression tests.** `ApiContractIT.pagination` (page-size cap), code-review checklist item "unbounded result sets".

## Exercise 5 - reconciliation backlog after a network blip

**Problem.** After a 4-minute provider incident, 37 withdrawals are `RECONCILIATION_REQUIRED` and customers call support about reduced balances.
**Investigation.** Confirm funds are *reserved, not lost* (`funds_reserved`, ledger entries `DEBIT`). Provider back? The auto-reconciler resolves records whose lookup returns a definite answer; records the provider never saw are refunded after the grace period (30 s). Anything left needs the provider's portal.
**Solution.** Let the reconciler work; manually resolve the remainder (maker-checker); tell support the script ("funds are held, resolved within minutes"); afterwards check ledger integrity.
**Trade-offs.** Conservative holding reduces customers' available balance temporarily, in exchange for never double-paying.
**Regression tests.** `TransactionFlowIT.unknownOutcomeIsReconciledAutomatically`, `unknownOutcomeResolvedManually`, chaos e2e "every held transaction is resolved automatically".

## Exercise 6 - every request returns 401 right after an identity-provider key rotation

**Problem.** After the IdP rotated its signing keys, valid tokens are rejected with `INVALID_TOKEN` for ~10 minutes, then it recovers by itself.
**Investigation.** Decode the token header (`kid` unknown to the service); check JWKS reachability from the pod; the resource server caches the key set and re-fetches on unknown `kid` (rate-limited) - a network policy blocked egress to the IdP so the refresh failed until the cache expired.
**Solution.** Allow egress to the IdP in the NetworkPolicy, alert on JWKS fetch failures, keep the IdP overlapping old and new keys during rotation.
**Trade-offs.** Longer JWKS cache = fewer calls but slower rotation pick-up.
**Regression tests.** `SecurityIT` token validation tests (tampered/forged/expired -> 401 with the standard envelope); `validate-infra.py` keeps the NetworkPolicy reviewed.
