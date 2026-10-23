# ADR-002: PostgreSQL as the primary relational database

* **Status:** accepted

## Context
Financial state needs strong consistency, constraints and predictable locking. The assignment allows PostgreSQL or MySQL and wants the choice justified, with a
discussion of Oracle for enterprise use.

## Decision
PostgreSQL 16 in deployment; H2 (PostgreSQL mode) for zero-install local runs and fast tests; Flyway for migrations with a `{vendor}` folder for database-specific DDL.

## Why PostgreSQL over MySQL
Partial and expression indexes (one OPEN reconciliation per transaction; a tiny "attention" index), transactional DDL (atomic migrations), richer `CHECK` constraints,
`SELECT ... FOR UPDATE SKIP LOCKED`, `pg_stat_statements`/`EXPLAIN (ANALYZE, BUFFERS)` ergonomics, MVCC without gap-lock surprises at READ COMMITTED.

## Alternatives
* **MySQL/InnoDB** - fine technically; weaker partial-index story; gap locks at REPEATABLE READ are a common source of unexpected deadlocks.
* **Oracle** - common in enterprises; the design ports (see database chapter: `'' IS NULL`, no partial indexes, DDL auto-commit, `FETCH FIRST`). Not added as a second running database - no implementation need.
* **MongoDB** - unsuited for the ledger; fits read models/projections (documented, not implemented).

## Consequences
+ constraints are a second line of defence (negative balance, double posting, duplicate keys are *impossible*, not just unlikely);
- H2 cannot express every PostgreSQL feature, so PostgreSQL-specific behaviour is tested on a real PostgreSQL (embedded locally, Testcontainers in CI);
- two vendor folders must be kept in step (a test asserts the PostgreSQL one ran against PostgreSQL).
