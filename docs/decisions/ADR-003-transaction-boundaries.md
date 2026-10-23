# ADR-003: Explicit transaction boundaries; the external call is never inside a database transaction

* **Status:** accepted

## Context
A withdrawal calls an external clearing network that can be slow, fail, or succeed without telling us. A database transaction cannot include that call.
Holding row locks and a pooled connection across a network call risks pool exhaustion and cascading failure.

## Decision
1. All changes to *our* data happen in short local ACID transactions with explicit boundaries (`TransactionTemplate`), `MANDATORY` propagation on code that must never run without one
   (`LedgerService`, `AuditService.record`, `OutboxService.enqueue`).
2. Processing is split: **Tx1** `VALIDATED -> PROCESSING` + (deposit/transfer: apply ledger -> `COMPLETED`; withdrawal: reserve funds); **external call with no transaction open**;
   **Tx2** record the outcome.
3. The result of the external call is classified `Authorized / Declined / NotSent / Unknown`; `Unknown` never refunds and never completes - it goes to reconciliation (funds stay reserved).
4. Business failures inside Tx1 roll it back completely and are then recorded in a fresh transaction; *technical* failures (lock timeout, DB down) propagate so the outbox retries.

## Alternatives
* `@Transactional` on the whole processor including the HTTP call - simple, dangerous (connection/lock hold times = external latency).
* Saga with a broker and compensations for every step - overkill when only one step is external.
* Two-phase commit with the network - not offered by the counter-party and not available over HTTP.

## Consequences
+ locks are held for milliseconds; an outage of the network cannot exhaust the pool; every intermediate state is explicit and queryable;
- more states to reason about and test (`RECONCILIATION_REQUIRED`, reserved funds) - covered by unit, integration and chaos tests;
- a crash between Tx1 and Tx2 leaves `PROCESSING` + reserved funds, handled by the stuck-transaction recovery job.
