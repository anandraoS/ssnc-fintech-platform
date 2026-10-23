# Business problem and project objectives

## The business problem

A financial-services organisation runs several internal applications (advisor desktops, a customer portal, operations tooling,
reporting). Each of them needs the same things from a shared back end:

* a **single source of truth** for customers, investment accounts and balances;
* a **safe way to submit money movements** - deposits, withdrawals and transfers - that cannot overspend an account, cannot be
  applied twice when a client retries, and cannot leave a transfer half-applied;
* **explicit business rules** (account status, ownership, currency, funds, limits, review thresholds) enforced in one place;
* **auditability**: who did what, to which record, when, and from which request;
* **operational visibility**: is the platform healthy, what is stuck, what failed, what needs a human decision?

The platform in this repository - *Enterprise Investment Account and Transaction Management Platform* - is a deliberately realistic
but **synthetic** answer to that problem. It was designed to demonstrate the engineering expected of a senior or lead Java
full-stack engineer at a financial-technology company, **without** claiming to reproduce any real vendor's proprietary system.
All customers, account numbers and balances are fictional; no real money is moved, no real brokerage is contacted.

## Objectives

| # | Objective | Where it is demonstrated |
|---|---|---|
| 1 | Correct money handling: `BigDecimal` with a written rounding policy, DB `CHECK` constraints, string money in the API | `MoneyPolicy`, `V1__core_schema.sql`, `MoneyPolicyTest` |
| 2 | Transactional integrity under concurrency: row locks in a fixed order, idempotency keys, outbox, ledger | `LedgerService`, `TransactionService`, `ConcurrencyScenarios`, ADR-003/004/005 |
| 3 | Safe integration with an external system that cannot join our DB transaction | `TransactionProcessor`, `RestClearingClient`, `ReconciliationService`, ADR-006 |
| 4 | Defence in depth: JWT, roles, object-level authorization, audit, rate/size limits, masking | `SecurityConfig`, `AccessPolicy`, `SecurityIT`, threat model |
| 5 | A professional Angular client: role-aware routes, typed API layer, interceptors, accessible forms, honest state handling | `frontend/` |
| 6 | Quality engineering: layered tests, TDD example, BDD scenarios, contract test, E2E | `docs/testing`, `tests/`, `*IT.java` |
| 7 | Delivery and operations: CI/CD with security gates, containers, Kubernetes, observability, runbooks | `.github`, `infrastructure`, `observability`, `docs/operations` |
| 8 | Technical leadership artefacts: ADRs, HLD/LLD, risk register, review checklists, mentoring material | `docs/decisions`, `docs/leadership` |
| 9 | Responsible AI-assisted development: instructions, spec-driven slice, review recipes | `ai-engineering/`, `specs/` |

## Assumptions

1. **Synthetic everything.** Customers, taxpayer fragments, balances and the external "clearing network" are simulated. Dummy
   credentials exist only in the `local` profile and are supplied through environment variables, never committed.
2. **Currencies** are USD, EUR, GBP and INR (two minor-unit digits); amounts are stored as `NUMERIC(19,4)` for headroom.
3. **Withdrawals leave the platform** (a payout through the external clearing network); deposits and internal transfers do not.
   That asymmetry is what makes the failure-handling design interesting and honest.
4. **One customer owns an account; transfers stay inside one customer.** (Cross-customer transfers would add payee management
   and sanctions screening that are out of scope.)
5. **Identity provider is external.** Production-style validation uses an OIDC issuer; a local issuer exists only so the demo
   runs without infrastructure.
6. **PostgreSQL** is the system of record (ADR-002). H2 in PostgreSQL mode is a zero-install convenience for local runs and fast
   tests; the PostgreSQL behaviour is verified separately against a real PostgreSQL server.
7. **Single deployable (modular monolith)** plus one small simulator service (ADR-001).

## What this is not

This is an **educational, interview-oriented implementation**. A production financial-services system would additionally need,
at minimum: a security and compliance review (SOC 2 / PCI DSS scope assessment, data-protection impact assessment), real
KYC/AML and sanctions screening, regulatory reporting and record-retention rules, a formally reviewed key-management and
secrets design, penetration testing, disaster-recovery rehearsals with agreed RPO/RTO, capacity testing on production-like
infrastructure, segregation of duties in the delivery pipeline, and a governance process around the AI tooling. The
"known limitations" chapter lists the gaps this repository knows about.
