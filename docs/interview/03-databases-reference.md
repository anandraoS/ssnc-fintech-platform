# Databases reference

## SQL essentials (with the project's tables)

```sql
-- joins and aggregation: balance per currency of non-closed accounts
SELECT currency, SUM(balance) FROM accounts WHERE status <> 'CLOSED' GROUP BY currency;
-- window function: running balance per account from the ledger
SELECT account_id, id, SUM(CASE WHEN entry_type='DEBIT' THEN -amount ELSE amount END) OVER (PARTITION BY account_id ORDER BY id) AS running
FROM ledger_entries;
-- anti-join: customers without accounts
SELECT c.* FROM customers c LEFT JOIN accounts a ON a.customer_id = c.id WHERE a.id IS NULL;
-- upsert (PostgreSQL)
INSERT INTO idempotency_records (...) VALUES (...) ON CONFLICT (principal, idempotency_key) DO NOTHING;
-- CTE + keyset pagination
WITH page AS (SELECT * FROM transactions WHERE created_at < :cursor ORDER BY created_at DESC, id DESC LIMIT 20) SELECT * FROM page;
```
Know: `INNER/LEFT` joins, `GROUP BY/HAVING`, subqueries vs joins vs `EXISTS`, `NULL` semantics (`= NULL` is never true; `NOT IN` with NULLs), `DISTINCT`, window functions, CTEs, set operations, `CASE`.

## PostgreSQL specifics

MVCC (each statement sees a snapshot; writers do not block readers; old versions cleaned by `VACUUM`), `TIMESTAMPTZ`, `NUMERIC`, UUID, partial/expression/GIN indexes, `EXPLAIN (ANALYZE, BUFFERS)`, `pg_stat_statements`, `pg_stat_activity`, `pg_blocking_pids`, `SELECT ... FOR UPDATE [NOWAIT|SKIP LOCKED]`, advisory locks, transactional DDL, `CREATE INDEX CONCURRENTLY`, partitioning, `LISTEN/NOTIFY`, `max_connections` and PgBouncer.

## Oracle compatibility (conceptual)

| Area | PostgreSQL | Oracle |
|---|---|---|
| empty string | `''` is a value | `'' IS NULL` |
| pagination | `LIMIT/OFFSET` | `OFFSET .. FETCH NEXT` (12c+), `ROWNUM` (legacy) |
| DDL | transactional | auto-commit |
| partial indexes | yes | function-based index trick |
| isolation | READ COMMITTED (default), REPEATABLE READ, SERIALIZABLE | READ COMMITTED (default), SERIALIZABLE, read-only; consistent reads via undo; `ORA-08177` |
| sequences/identity | identity/sequence | identity (12c+)/sequence |
| booleans | `BOOLEAN` | `NUMBER(1)` (23ai adds `BOOLEAN`) |
| tooling | `EXPLAIN` | `EXPLAIN PLAN`, AWR/ASH, SQL Monitor |
Spring/Hibernate: dialect and driver change, Flyway vendor folder, review native SQL, retest locking.

## MongoDB use cases

Document model fits hierarchical, schema-flexible data (KYC documents, notifications, event payloads, product catalogues) and read-optimised projections; scale-out by sharding; TTL indexes; multi-document ACID transactions exist but are costlier.
Not a fit for a double-entry ledger or strongly relational constraints. Pattern: keep the relational store as the system of record and feed Mongo projections from events.

## Indexes and query plans

*Analogy:* an index is the index at the back of a book - you jump to the page instead of reading every page, but every new page must also be added to the index.
* B-tree: equality, range, sort; **composite index order** = equality columns first, then the range/sort column (`(source_account_id, created_at DESC)`); a leading column that is not filtered makes the index useless.
* **Selectivity:** index helps when it returns a small fraction; PostgreSQL may prefer a sequential scan on small tables (correctly). **Covering** indexes (`INCLUDE`) allow index-only scans. **Partial** indexes shrink to the interesting rows (`status IN (...)`).
* Reading `EXPLAIN`: node types (Seq Scan, Index Scan, Bitmap Heap Scan, Index Only Scan), `Rows Removed by Filter`, estimated vs actual rows (stale statistics -> `ANALYZE`), sort method (disk spill), nested loop vs hash join, loops.
* Anti-patterns: functions on indexed columns (`lower(email)` without an expression index), leading wildcard `LIKE '%x'`, implicit casts, `OR` across different columns, deep `OFFSET`, `SELECT *` on wide rows, over-indexing (write cost, bloat).
* **Project example:** the account-history query with `source = :id OR target = :id` - plan walks `ix_tx_created` for a busy account, switches to a bitmap OR of the two account indexes for a sparse account (captured plans appendix).

## Isolation levels, locking, deadlocks

| Level | Dirty read | Non-repeatable | Phantom | Lost update / write skew |
|---|---|---|---|---|
| READ UNCOMMITTED (PG treats as READ COMMITTED) | no (PG) | yes | yes | yes |
| READ COMMITTED | no | yes | yes | yes (without locks) |
| REPEATABLE READ (PG: snapshot) | no | no | no (PG) | write skew possible; update conflicts abort |
| SERIALIZABLE (PG: SSI) | no | no | no | prevented, at the cost of retries |

* **Row locks:** `FOR UPDATE` (exclusive), `FOR SHARE`, `NOWAIT`, `SKIP LOCKED` (job queues); **table locks** from DDL; **gap/next-key locks** in MySQL REPEATABLE READ.
* **Deadlock:** cyclic waits; the DB aborts one victim (`40P01`). Prevent with consistent lock order, short transactions, bounded `lock_timeout`; handle by retrying the victim.
* **Optimistic vs pessimistic** - see ADR-005. **Long transactions** block vacuum and hold locks: keep them short; no I/O inside.

## Connection pools

HikariCP: `maximumPoolSize` (bounded by DB capacity, not request threads), `minimumIdle`, `connectionTimeout` (fail fast), `maxLifetime` (below infrastructure idle timeouts), `leakDetectionThreshold`. Formula of thumb: `connections ~= (cores x 2) + effective spindles` on the *database* side; replicas x pool <= `max_connections`.
Symptoms of exhaustion: pending threads, acquire time up, timeouts; causes: slow queries, transactions held open, leaks, external calls inside transactions, too many replicas. Mitigations: fix the cause, PgBouncer (transaction pooling), RDS Proxy.

## Schema migrations

Flyway/Liquibase; versioned immutable migrations; checksum validation; expand/contract; backward-compatible changes so rolling deployments and rollbacks work; data backfills in batches; `CREATE INDEX CONCURRENTLY`; separate privileged migration role; test migrations against production-sized data; repeatable migrations for views; baseline for existing databases.
