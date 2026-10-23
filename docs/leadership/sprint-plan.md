# Sprint task breakdown, dependencies and risk register

## Sprint plan (2-week sprints, one team of five; estimates in ideal days)

| Sprint | Goal | Stories (estimate) | Definition of done evidence |
|---|---|---|---|
| **1 Foundation** | walking skeleton with correct money handling | project skeleton + CI (2); domain model, Flyway V1, constraints (3); `MoneyPolicy` + tests (1); customer/account CRUD + lifecycle (4); security chain + JWT + roles (3); error envelope, correlation id (2) | tests green; contract generated; threat model v1 |
| **2 Transactions** | submit -> validate -> process end to end | state machine (2); validator + `AccessPolicy` (3); idempotent submit (3); outbox + dispatcher (3); ledger + ordered locks (3); processor (3); concurrency tests (3); BDD scenarios (2) | invariants asserted under concurrency; idempotency race test |
| **3 Integration and operations** | external network, reconciliation, dashboards | clearing client with retry/jitter/breaker (3); simulator + chaos (2); reconciliation (3); maker-checker (2); Angular shell, guards, interceptors (3); dashboard, investigations, audit (4); metrics + Grafana + alerts (3) | chaos e2e; runbooks for every alert |
| **4 Hardening and launch** | production readiness | rate/size limits (2); PostgreSQL verification + query plans (3); Dockerfiles, compose, k8s, probes (3); security scans in CI (2); performance baseline + k6 (3); docs, ADRs, runbooks (3); release checklist and rollback drill (2) | readiness checklist signed; rollback rehearsed |

Buffer 15 % per sprint. Demo each sprint with the live end-to-end scripts; retrospective actions go to the next sprint backlog.

## Dependencies

| Dependency | Needed by | Risk if late | Mitigation |
|---|---|---|---|
| OIDC identity provider + client registration | Sprint 3 | no real token validation | local issuer (dev only) behind a profile; contract = issuer URL |
| Clearing network sandbox + idempotency/lookup contract | Sprint 3 | integration design unvalidated | simulator with deterministic and chaos behaviours; contract assumptions documented (ADR-011) |
| PostgreSQL instance, backup policy | Sprint 4 | no real-DB verification | embedded PostgreSQL in tests; Testcontainers in CI |
| Security review slot | Sprint 4 | late findings | threat model reviewed from Sprint 1; checklist per PR |
| Kubernetes namespace + secrets store | Sprint 4 | cannot deploy | compose + manifests validated statically; overlay for test |

## Risk register

| # | Risk | Likelihood | Impact | Score | Mitigation | Owner | Evidence/status |
|---|---|---|---|---|---|---|---|
| R1 | Overspend/duplicate under concurrency | M | critical | high | row locks, idempotency, constraints, concurrency tests on real PostgreSQL | tech lead | tests green |
| R2 | Unknown external outcome mishandled (double payout) | M | critical | high | reserve-first, 3-way classification, reconciliation, alerts | tech lead | ADR-011, chaos e2e |
| R3 | Broken object-level authorization | M | critical | high | `AccessPolicy` + BOLA tests, review checklist | security champion | `SecurityIT` |
| R4 | Hot-account lock contention limits throughput | M | medium | medium | bounded waits, metrics, design note for batching | tech lead | baseline shows serial behaviour |
| R5 | In-database queue polling limits throughput | M | medium | medium | work-conserving loop done; parallel workers / broker relay next | dev | measured 23 -> 34 tx/s locally |
| R6 | H2/PostgreSQL behavioural drift | M | medium | medium | PostgreSQL ITs (embedded + Testcontainers) | QA lead | `Postgres*IT` |
| R7 | Dependency vulnerability | H | high | high | scans in CI, pinned versions, Dependabot | devops | CI jobs (not yet run on a runner) |
| R8 | Token theft via XSS | L | high | medium | memory-only token, CSP, no innerHTML | frontend lead | ADR-012 |
| R9 | AI-generated code introduces races/auth gaps | M | high | high | AI review checklists, tests-first, human review mandatory | tech lead | `ai-engineering/` |
| R10 | Schema change breaks rollback | L | high | medium | expand/contract, previous-version compatibility check | dba | release checklist |
| R11 | Skills concentration (one person knows the ledger) | M | medium | medium | pairing, ADRs, runbooks, mentoring plan | EM | docs |
| R12 | Unvalidated assumptions about the network contract | M | high | high | explicit assumptions, contract tests when the sandbox exists | architect | ADR-011 |
