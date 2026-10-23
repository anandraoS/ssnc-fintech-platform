# ADR-004: Idempotency keys enforced by a database unique constraint

* **Status:** accepted

## Context
Clients retry (timeouts, double clicks, flaky networks); gateways replay. A money movement must be applied at most once per logical request.

## Decision
`POST /transactions` requires an `Idempotency-Key` header. The record `(principal, key) -> transaction, SHA-256(request)` lives in `idempotency_records` with
`UNIQUE(principal, idempotency_key)` and is inserted in the **same transaction** as the transaction row, the outbox event and the audit rows.
A fast read handles the common replay; a unique violation (concurrent twin) rolls the whole attempt back and the loser replays the winner's result.
Same key + different payload -> `422 IDEMPOTENCY_KEY_REUSED`. Records are kept for 7 days.

## Alternatives
* In-memory/Redis key cache - not atomic with the database write; loses keys on restart; adds a system.
* Natural-key deduplication (same amount/accounts within N seconds) - false positives (two legitimate equal payments); kept only as a possible *review* signal.
* Server-generated ids with client polling - does not solve duplicate creation.

## Consequences
+ correctness does not depend on the pre-check - the constraint decides races, across any number of instances; replay returns the identical outcome (including rejections);
- one extra index and a purge job; the retention window defines how long a client may safely retry;
- the key namespace is per principal (a leaked key cannot replay someone else's request).
