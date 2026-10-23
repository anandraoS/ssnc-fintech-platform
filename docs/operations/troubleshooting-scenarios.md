# Troubleshooting scenarios

Realistic production problems for this platform, each with symptoms, investigation, resolution and the regression guard.
(The five full *exercises* with code, trade-offs and regression tests are in `docs/leadership/troubleshooting-exercises.md`.)

| # | Scenario | First clue | Investigation | Resolution | Guard |
|---|---|---|---|---|---|
| 1 | **Customer says money was taken twice** | two similar rows in history | compare `Idempotency-Key`s (audit `TRANSACTION_SUBMITTED` details), references, amounts; check `idempotency_records` | if same key -> a replay returned the original (no duplicate); if two keys -> the client created two logical requests; the ledger shows exactly what was posted | `IdempotencyIT`, e2e duplicate scenario |
| 2 | **Balance looks wrong** | support reports a mismatch | `GET /ops/accounts/{id}/ledger` vs `balance`; run `/ops/ledger-integrity` | integrity check empty -> the balance is the sum of postings; explain via ledger entries and reserved withdrawals (`funds_reserved`, `RECONCILIATION_REQUIRED`) | ledger integrity asserted in every concurrency test |
| 3 | **Withdrawal stuck in `RECONCILIATION_REQUIRED`** | alert after 15 min | attempts + audit trail; network reachability; look up the reference | resolve per runbook; if the network is down wait for the reconciler | `unknownOutcome*` ITs, chaos e2e |
| 4 | **Spike of 503 `LOCK_TIMEOUT`** | error-rate alert | blocking-locks query; which account; who holds the lock | find the long lock holder (external call inside a transaction? a stuck session?), kill it, fix the code path | bounded lock wait; `LedgerServiceTest` lock order |
| 5 | **Queue not draining after a deploy** | `platform_outbox_backlog` rising | dispatcher logs, `app.processing.dispatcher-enabled`, dead letters, DB latency | enable dispatcher / fix cause / requeue dead letters | `OutboxDeadLetterIT`, `OutboxDispatcherTest` |
| 6 | **Login works, every API call returns 401** | after an IdP change | token `iss` vs `OIDC_ISSUER_URI`, clock skew, JWKS reachability from the pod | align issuer/URL, fix NTP/egress | `SecurityIT` token validation tests |
| 7 | **Dashboard says "DEGRADED: outbox dead-lettered=3"** | health component | `GET /ops/outbox?status=DEAD` -> `last_error` | fix cause, requeue | alert `OutboxDeadLetters` |
| 8 | **Users report slowness only for one account** | p95 fine, one account slow | lock wait chain on that account; many parallel requests on a hot account | expected serialisation; if abusive -> rate limit/suspend; if legitimate -> batching design | concurrency tests; ADR-005 consequences |
| 9 | **Pods restart every few minutes** | `OOMKilled` | heap-after-GC, RSS vs limit, heap dump | right-size limit or fix the leak | JVM heap alert |
| 10 | **Flyway fails at startup in one environment** | `Validate failed: checksum mismatch` | someone edited an applied migration | restore the original file, add a *new* migration for the change | `validate-on-migrate`, review rule "never edit a released migration" |
