---
applyTo: "backend/**/db/**/*.sql"
---
Follow `ai-engineering/context/db-migration-guide.md`.
- New file `V<next>__description.sql`; **never modify an existing migration**.
- Additive first (nullable column / new table / `CREATE INDEX CONCURRENTLY` in the PostgreSQL folder); destructive changes only in a later release after the rollback window.
- Money columns `NUMERIC(19,4)`; constraints (`CHECK`, `UNIQUE`, `FOREIGN KEY`) are part of the design, not an afterthought.
- Put PostgreSQL-only features in `db/migration/postgresql` and an honest equivalent (or a comment) in `db/migration/h2`.
- Seed data lives in `db/seed` and is synthetic only.
