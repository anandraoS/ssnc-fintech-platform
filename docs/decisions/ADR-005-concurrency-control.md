# ADR-005: Pessimistic row locks (ordered) for balances, optimistic versioning elsewhere

* **Status:** accepted

## Context
Balances are hot rows; concurrent withdrawals must not overspend; opposing transfers must not deadlock; other entities see rare conflicts.

## Decision
* Balance changes: `SELECT ... FOR UPDATE` on the account rows (5 s bounded wait), re-check status/funds/daily limit **under the lock**, then mutate; multi-account operations lock in **ascending id order**.
* Everything else: `@Version` optimistic locking (cancel vs process, double approval, double resolution, profile edits) -> `409 CONCURRENT_MODIFICATION`.
* Database constraints as the last line (`CHECK balance >= 0`, unique ledger postings).
* Default isolation (READ COMMITTED); no blanket SERIALIZABLE.

## Alternatives
| Option | Verdict |
|---|---|
| Optimistic locking on balances with retries | retry storms under contention; starvation; more complex client-visible failures |
| `UPDATE accounts SET balance = balance - :x WHERE id = :id AND balance - :x >= :min` (atomic conditional update) | a good alternative for the single-row case; chosen *against* because we also need the ledger entry, the daily-limit sum and status checks in the same critical section, and the lock model generalises to transfers |
| SERIALIZABLE isolation | correct but turns contention into aborts and retries everywhere |
| Single-writer queue per account | highest throughput per account, but needs a partitioned broker - overkill here |

## Consequences
+ simple reasoning ("hold the row, check, change"); invariants proven by concurrency tests on H2 and on real PostgreSQL;
- lock waits are possible (bounded; become retryable 503, never a pool pile-up); a future code path that locks in a different order could deadlock -> all mutations go through `LedgerService` and the order is unit-tested;
- throughput per *account* is serial by nature (per-account TPS bounded by the transaction time, tens of ms).
