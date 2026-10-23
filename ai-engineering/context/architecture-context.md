# Architecture context (for assistants)

Read these before designing anything: `docs/architecture/02-architecture-overview.md`, `04-transaction-integrity-and-concurrency.md`, ADR-001, 003, 004, 005, 011.

**Shape:** modular monolith `platform-service` (modules customer, account, transaction, audit, ops, security, clearing, common) + `clearing-simulator`. REST `/api/v1`, PostgreSQL via JPA + Flyway, async processing through a transactional outbox, Angular SPA.

**Flow of a money movement:** `POST /transactions` (idempotent) -> one DB transaction: persist, validate, outbox event, audit -> `202` -> dispatcher leases the event -> `TransactionProcessor`
(Tx1 begin/reserve -> external call outside any transaction -> Tx2 outcome) -> `COMPLETED | FAILED | RECONCILIATION_REQUIRED`.

**Invariants (must hold after every operation):** balance >= minimum >= 0; balance == signed sum of ledger entries; a (principal, key) is applied once; a ledger posting is applied once per (tx, account, type);
a transfer's debit and credit commit together; legal state transitions only; every change and every denial audited.

**Dependency direction:** web -> services -> repositories; transaction -> account -> customer; account reaches transaction only through the `AccountClosureGuard` port. No cycles.

**Where logic lives:** pure rules in `TransactionValidator`/`AccessPolicy`/`DailyLimitPolicy`/`MoneyPolicy`; balance mutation only in `LedgerService`; orchestration in `TransactionProcessor`; HTTP translation in controllers.

**Do not:** add a message broker, cache or Spring Cloud component without an ADR; call external systems inside a transaction; mutate balances outside `LedgerService`; expose entities; edit released migrations.
