# Database migration guidance

* Flyway, versioned `V<n>__snake_case.sql`. **Released migrations are immutable** (checksums are validated at startup). Fix forward with a new version.
* Layout: `db/migration/common` (portable), `db/migration/postgresql`, `db/migration/h2`, `db/seed` (synthetic, local/test only). If PostgreSQL gets a feature H2 cannot express, add the honest H2 equivalent or a comment and a test that proves the PostgreSQL one.
* **Expand/contract:** (1) add nullable column/new table/index; (2) deploy code writing both; (3) backfill in batches; (4) switch reads; (5) later release: drop the old shape. Rename = add + copy + drop, never `ALTER ... RENAME` in the same release as the code.
* Indexes on large tables: `CREATE INDEX CONCURRENTLY` (PostgreSQL folder, outside a transaction). `NOT NULL` via add-nullable -> backfill -> `SET NOT NULL`. Avoid table rewrites and long exclusive locks.
* Design constraints deliberately: `NOT NULL`, `CHECK`, `UNIQUE`, FKs. A constraint is a free invariant test that also protects against bugs in code you have not written yet.
* Money `NUMERIC(19,4)`; timestamps `TIMESTAMP WITH TIME ZONE` (UTC); enums as `VARCHAR` + `CHECK` - **size the column for the longest value** (a real defect here: `VARCHAR(20)` for a 22-character enum).
* Every migration PR: query plan for new query shapes (`EXPLAIN (ANALYZE, BUFFERS)`), rollback note (the previous application version must work against the new schema), second reviewer.
* Verify on PostgreSQL: `mvn verify` runs the Postgres ITs (embedded PostgreSQL); check `PostgresFeaturesIT` still passes.
