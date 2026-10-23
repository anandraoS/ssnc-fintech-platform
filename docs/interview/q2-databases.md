# Questions: databases

### Q25. Explain the SQL isolation levels and which anomalies each allows.
**Short answer:** READ COMMITTED prevents dirty reads; REPEATABLE READ also prevents non-repeatable reads (and phantoms in PostgreSQL); SERIALIZABLE prevents all anomalies including write skew, at the cost of aborts.
**Reasoning and implementation:** the anomalies are dirty read, non-repeatable read, phantom, lost update and write skew. PostgreSQL uses MVCC snapshots: READ COMMITTED takes a new snapshot per statement; REPEATABLE READ one per transaction; SERIALIZABLE adds serialisable snapshot isolation with conflict detection (`40001`, retry). Lost updates under READ COMMITTED are prevented by row locks (`FOR UPDATE`), conditional updates or a version column.
**Alternatives and trade-offs:** raising the isolation level everywhere turns contention into retries; targeted locks give the same safety for the invariants you care about.
**Risks and pitfalls:** assuming `@Transactional` alone prevents lost updates; MySQL REPEATABLE READ gap locks and deadlocks.
**Likely follow-ups:** "what is write skew?" (two transactions read overlapping data and write disjoint rows, violating an invariant); "how does Oracle differ?"
**In this project:** default READ COMMITTED + row locks + constraints (ADR-005, integrity chapter).

### Q26. [Scenario] How would you prevent two concurrent withdrawals from overspending an account?
**Short answer:** serialise on the account row (`SELECT ... FOR UPDATE`), re-check the balance under the lock, change it in the same transaction, and keep a `CHECK (balance >= 0)` as the last line of defence.
**Reasoning and implementation:** read-modify-write without a lock lets both requests read 100 and write 20. With `FOR UPDATE` the second waits (bounded to 5 s), then reads the *new* balance and fails with `INSUFFICIENT_FUNDS`. Validation at submit is advisory; the authoritative check happens inside `LedgerService` under the lock. Prove it with 20 concurrent withdrawals against a balance for 10: exactly 10 complete, balance 0.00, ledger integrity empty - on H2 and on real PostgreSQL.
**Alternatives and trade-offs:** atomic `UPDATE ... SET balance = balance - :x WHERE id = :id AND balance - :x >= :min` (excellent for a single row, but we also need ledger entry, limit and status checks in one critical section); optimistic version + retry (retry storms on hot rows); SERIALIZABLE (aborts everywhere); single-writer queue per account (needs partitioned infrastructure).
**Risks and pitfalls:** checking the balance in the UI/controller only; holding the lock across a network call; inconsistent lock order across accounts.
**Likely follow-ups:** "what if the lock wait times out?" (retryable 503); "how do you scale a hot account?"
**In this project:** `LedgerService.reserveWithdrawal`, `ConcurrencyScenarios.concurrentWithdrawalsNeverOverspend`, mutation check (removing the lock fails 4 of 5 concurrency tests).

### Q27. How would you choose between optimistic and pessimistic locking?
**Short answer:** optimistic when conflicts are rare and retries are cheap; pessimistic when the same row is expected to be contended and the critical section is short.
**Reasoning and implementation:** optimistic (`@Version`, `WHERE version = ?`) holds no lock, so readers and writers proceed; losers retry/fail with 409. Pessimistic (`FOR UPDATE`) makes later requests wait, avoiding wasted work and retry storms but risking lock waits/deadlocks. Decide by conflict probability, cost of conflict, read/write ratio and latency tolerance. Many systems use both: pessimistic for balances, optimistic for status changes and edits.
**Alternatives and trade-offs:** atomic conditional updates, `SKIP LOCKED` queues, advisory locks.
**Risks and pitfalls:** optimistic locking on hot rows (livelock), pessimistic without ordering/timeouts (deadlock, pool exhaustion), forgetting to handle the optimistic exception.
**Likely follow-ups:** "what does the client see on a lost optimistic race?" (409 `CONCURRENT_MODIFICATION`, re-read and retry).
**In this project:** ADR-005; `@Version` on all entities; cancel-vs-process race resolved by `@Version`.

### Q28. How do indexes work, and how do you choose the column order of a composite index?
**Short answer:** a B-tree maps key order to rows; put equality-filtered columns first, then the range/sort column, and only index what queries need.
**Reasoning and implementation:** `(source_account_id, created_at DESC)` serves `WHERE source_account_id = ? ORDER BY created_at DESC LIMIT n` without a sort. A leading column that the query does not constrain makes the index unusable for that query. Selectivity and data distribution matter: the planner may prefer a sequential scan for unselective predicates. Partial indexes cover only interesting rows (`WHERE status IN (...)`).
**Alternatives and trade-offs:** covering indexes (`INCLUDE`) for index-only scans; hash/GIN/BRIN for special cases; every index slows writes and takes space.
**Risks and pitfalls:** functions on indexed columns, leading wildcards, implicit casts, redundant indexes, stale statistics.
**Likely follow-ups:** "why can `OR` on two columns be slow?" (see Q29).
**In this project:** V1/V2 migrations and the captured plans (database chapter, appendix).

### Q29. [Scenario] The account-history query `WHERE source = :id OR target = :id ORDER BY created_at DESC LIMIT 20` is slow for some accounts. How do you analyse it?
**Short answer:** read the `EXPLAIN (ANALYZE)` plan, look at rows removed by the filter, and consider splitting the `OR` or paginating by keyset.
**Reasoning and implementation:** with 100,000 rows the plan for a busy account walks `ix_tx_created` newest-first and filters (20 matches after ~400 entries - cheap); for a sparse account PostgreSQL switches to a bitmap OR of the two account indexes. The risk case is an account whose recent rows are few: the global-index walk discards many rows. Fixes: `UNION ALL` of two indexed queries with `ORDER BY ... LIMIT`, a participants table `(account_id, created_at, transaction_id)`, keyset pagination instead of deep `OFFSET`, `ANALYZE` for fresh statistics.
**Alternatives and trade-offs:** denormalised participant table (faster reads, extra write/consistency work); materialised views.
**Risks and pitfalls:** optimising on tiny data; trusting estimates instead of actuals.
**Likely follow-ups:** "what is keyset pagination?" (`WHERE (created_at, id) < (:c, :i)`).
**In this project:** `PostgresFeaturesIT.queryPlans` regenerates the plans; the database chapter explains them.

### Q30. How do you design safe, zero-downtime schema migrations?
**Short answer:** forward-only, additive steps (expand/contract) so the previous and next application versions both work against the schema during rollout and rollback.
**Reasoning and implementation:** expand (add nullable column/table/index concurrently), deploy code that writes both, backfill in batches, switch reads, contract (drop) in a later release. Flyway versioned migrations are immutable (checksum-validated); privileged migration role separate from the app role; rehearse against production-sized data to measure lock time; avoid `ALTER` that rewrites large tables.
**Alternatives and trade-offs:** blue/green databases (heavy), online schema change tools (gh-ost/pg_repack), Liquibase (richer changelog formats).
**Risks and pitfalls:** editing a released migration (startup failure), long exclusive locks, destructive change in the same release as the code.
**Likely follow-ups:** "how do you roll back?" (application rollback only; schema stays - that is why changes are additive).
**In this project:** `db-migration-guide.md`; a real defect (column too short) was fixed *before* any release by editing V1 - after release a V3 would be required.

### Q31. How would you size and troubleshoot a database connection pool?
**Short answer:** size by what the database can run concurrently, not by request threads; troubleshoot by looking at pending threads, acquire time and what active connections are doing.
**Reasoning and implementation:** start near `cores x 2` per database instance shared across all replicas (`replicas x pool <= max_connections`), set a short `connectionTimeout` (3 s) so exhaustion fails fast, enable leak detection. Exhaustion symptoms: `hikaricp_connections_pending > 0`, acquire-time p95 rising. Investigate `pg_stat_activity` (`active`, `idle in transaction`), locks, slow queries, and whether any transaction wraps I/O.
**Alternatives and trade-offs:** PgBouncer/RDS Proxy (transaction pooling), virtual threads (do not remove the pool limit).
**Risks and pitfalls:** raising the pool to "fix" slow queries; `REQUIRES_NEW` inside loops consuming two connections per request.
**Likely follow-ups:** "what does `idle in transaction` tell you?"
**In this project:** `application.yml` Hikari settings, `ConnectionPoolSaturated` alert, runbook and troubleshooting exercise 1.

### Q32. [Scenario] A withdrawal request hangs for 30 seconds, then returns `503 LOCK_TIMEOUT`. What happened and what do you do?
**Short answer:** another transaction holds the account's row lock for too long; find the holder, understand why, and fix the code path or kill the session.
**Reasoning and implementation:** the lock wait is bounded (5 s in code; here it was exceeded by queued waiters). Query `pg_stat_activity` joined with `pg_blocking_pids` to find the head blocker and its statement/state. Common causes: a transaction doing I/O while holding the lock, an abandoned session `idle in transaction`, a batch job locking many accounts. Mitigate (terminate the blocker), then fix (shorten the critical section, remove I/O, ordered locks).
**Alternatives and trade-offs:** `NOWAIT` + client retry; shorter lock timeout to shed load faster.
**Risks and pitfalls:** killing the wrong session; raising timeouts (worse pile-ups).
**Likely follow-ups:** "how would you alert on this?" (lock-wait metric, 503 rate).
**In this project:** `ServerErrorIT.lockTimeoutIs503`, blocking-locks query in the database chapter.

### Q33. What is the difference between `UNIQUE` constraints, application checks and idempotency keys?
**Short answer:** only a database constraint can decide a race between application instances; application checks are optimisations, idempotency keys *use* a unique constraint.
**Reasoning and implementation:** "select then insert" is a race; two instances both see "no row" and insert. A `UNIQUE (principal, key)` makes the second insert fail atomically; the application catches the violation, rolls back, and replays the winner's result.
**Alternatives and trade-offs:** `INSERT ... ON CONFLICT DO NOTHING` (PostgreSQL), distributed locks (weaker).
**Risks and pitfalls:** catching the violation inside the same transaction and continuing (the transaction is aborted/rollback-only); not scoping keys by principal.
**Likely follow-ups:** "why roll back the whole transaction?" (the loser's other rows - outbox, audit - must not survive).
**In this project:** `TransactionService.submit`, `IdempotencyIT.concurrentSameKeyCreatesOneTransaction`.

### Q34. When would you use MongoDB or another document store alongside PostgreSQL?
**Short answer:** for flexible-schema documents and read-optimised projections, never as the system of record for the ledger.
**Reasoning and implementation:** KYC document metadata, notification payloads, event/audit sinks with TTL, and denormalised customer-activity views fit documents. Feed them from events (outbox) so the relational store stays authoritative and projections can be rebuilt.
**Alternatives and trade-offs:** PostgreSQL JSONB (one system, good enough for many cases), Elasticsearch for search.
**Risks and pitfalls:** dual writes without an outbox, treating a projection as truth, multi-document transactions as a crutch.
**Likely follow-ups:** "how do you keep them consistent?" (idempotent projectors, rebuild from the log).
**In this project:** conceptual only (database chapter); no Mongo code.

### Q35. How would you port this design to Oracle?
**Short answer:** change the dialect/driver and Flyway vendor folder, then fix the semantic differences: empty strings are NULL, no partial indexes, DDL auto-commits, different pagination syntax and booleans.
**Reasoning and implementation:** `'' IS NULL` affects validation/uniqueness; partial unique index becomes a function-based unique index on a `CASE` expression; `LIMIT/OFFSET` becomes `FETCH NEXT`; boolean as `NUMBER(1)`; `RAW(16)` for UUIDs; plans via `EXPLAIN PLAN`/AWR; deadlock and isolation behave similarly at READ COMMITTED. Retest the concurrency suite on Oracle.
**Alternatives and trade-offs:** keep PostgreSQL where allowed; use Oracle-compatible abstractions (JPA) but own the migration folder per vendor.
**Risks and pitfalls:** native SQL left in code; assuming migrations are atomic.
**Likely follow-ups:** "what does `ORA-08177` mean?" (serialisation failure).
**In this project:** `docs/architecture/06-database.md` (Oracle section) - conceptual, not executed.

### Q36. [Scenario] A migration that added a `NOT NULL` column locked the table for minutes in production. How do you avoid that?
**Short answer:** add the column nullable, backfill in batches, add the constraint in a validated-in-two-steps way, and do it across releases.
**Reasoning and implementation:** PostgreSQL 11+ adds a column with a constant default instantly, but a volatile default or a `NOT NULL` check on existing rows scans the table under a strong lock. Safer: `ADD COLUMN ... NULL`; deploy code writing it; backfill with small batches (`UPDATE ... WHERE id BETWEEN`); `ADD CONSTRAINT ... CHECK (col IS NOT NULL) NOT VALID` then `VALIDATE CONSTRAINT` (weaker lock); finally `SET NOT NULL`. Create indexes with `CONCURRENTLY`.
**Alternatives and trade-offs:** maintenance window (simplest, but downtime), online migration tools.
**Risks and pitfalls:** running migrations inside the application at startup on every replica (race, long locks) - run them as a controlled job.
**Likely follow-ups:** "what lock does `CREATE INDEX` take?"
**In this project:** guidance in the migration guide and release checklist.

### Q37. How do you design data retention for audit, idempotency and transaction data?
**Short answer:** keep each class of data for as long as its purpose requires, with cheap archival for the long-lived ones.
**Reasoning and implementation:** idempotency keys: days (longest client retry window) with a purge job; audit: years (regulatory), append-only, partitioned by month, cold partitions archived; transactions/ledger: partition by time, archive after the reporting window; PII: minimise, mask, support erasure by design; outbox: delete dispatched rows after N days.
**Alternatives and trade-offs:** soft delete (complex queries), separate archive database.
**Risks and pitfalls:** deleting audit data needed for investigations; unbounded growth of the outbox; partitions without maintenance.
**Likely follow-ups:** "how does GDPR erasure interact with an immutable audit trail?" (store identifiers not PII; crypto-shredding).
**In this project:** `TransactionMaintenance.purgeExpiredIdempotencyRecords`, append-only audit trigger.

### Q38. [Scenario] The ledger and a customer's balance disagree by 0.01. How do you find the cause?
**Short answer:** run the integrity query, locate the account, and walk the ledger entries and transactions to find the posting that broke the invariant.
**Reasoning and implementation:** `GET /ops/ledger-integrity` (or the SQL: balance vs signed sum) identifies the account; list its ledger entries with `balance_after` to find where the running balance diverges; match entries to transactions and their states (a `RECONCILIATION_REQUIRED` withdrawal has a `DEBIT` and no payout; a reversal exists once). Causes: a code path that changes the balance without a ledger entry, rounding applied on one side, a manual SQL change. The database constraints (unique postings, non-negative balance) narrow the suspects.
**Alternatives and trade-offs:** periodic automated integrity checks and alerts (cheap, recommended).
**Risks and pitfalls:** "fixing" by editing the balance (breaks the audit story) instead of posting a correcting entry.
**Likely follow-ups:** "how do you prevent it?" (single mutation path, tests asserting the invariant after every scenario).
**In this project:** `OpsService.ledgerIntegrity`, asserted after every concurrency and e2e scenario.
