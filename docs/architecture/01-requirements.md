# Functional and non-functional requirements

## Roles

| Role | Can | Cannot |
|---|---|---|
| `CUSTOMER` | see own customer record, accounts, balances, history; submit deposit/withdrawal/transfer on **own** accounts; cancel own pending transactions | see anyone else's data; use staff pages; approve anything |
| `SUPPORT_AGENT` | look up customers (PII masked), accounts, transactions, attempts, audit trail, dashboard | change anything; submit money movements |
| `OPERATIONS_ANALYST` | everything a support agent can, plus: create customers, open/activate/suspend accounts, submit on a customer's behalf, approve/reject transactions **submitted by someone else**, resolve reconciliation records | close accounts, suspend customers, platform administration |
| `ADMIN` | everything operations can, plus: suspend/reactivate customers, close accounts, drain/requeue outbox events, view dead letters | approve a transaction they submitted (maker-checker applies to everyone) |

## Functional requirements

| ID | Requirement | Realised by |
|---|---|---|
| F1 | Manage customer profiles (create, update, suspend, reactivate, search) | `CustomerService`, `CustomerController` |
| F2 | Multiple accounts per customer; types `BROKERAGE`, `RETIREMENT`, `MONEY_MARKET`; currency per account | `Account`, `AccountType` |
| F3 | Account lifecycle: `PENDING_ACTIVATION -> ACTIVE <-> SUSPENDED -> CLOSED`; activation requires an active customer; closing requires zero balance and nothing in flight | `AccountStatus`, `AccountService` |
| F4 | Paginated, filterable, sortable account and transaction searches | `AccountService.search`, `TransactionService.search`, `PageableSupport` |
| F5 | View balances (ledger, minimum, available) and transaction history | `AccountController`, `TransactionController` |
| F6 | Submit deposits, withdrawals and internal transfers | `TransactionService.submit` |
| F7 | Validate: account status, ownership/authorization, amount, currency, available balance, daily limit, duplicates, permitted state transitions | `TransactionValidator`, `AccessPolicy`, `TransactionStatus`, idempotency table |
| F8 | Nine-state lifecycle `RECEIVED, VALIDATED, PROCESSING, COMPLETED, REJECTED, FAILED, PENDING_REVIEW, RECONCILIATION_REQUIRED, CANCELLED` with explicit transitions | `TransactionStatus`, `FinancialTransaction.transitionTo` |
| F9 | Large transactions (>= 50,000) require an independent approver (maker-checker) | `TransactionService.approve`, `AccessPolicy.canReview` |
| F10 | Cancel a transaction only before processing starts | `TransactionStatus.isCancellable` |
| F11 | Atomic balance updates; a transfer is all-or-nothing; no overdraft | `LedgerService`, `ck_accounts_balance_nonneg` |
| F12 | Idempotent submission with `Idempotency-Key`; duplicate detection; replay | `IdempotencyRecord`, `TransactionService` |
| F13 | Uncertain external outcomes are held and reconciled (automatically, then manually) | `ReconciliationService`, `TransactionMaintenance` |
| F14 | Audit every important change and every access denial | `AuditService`, `audit_events` |
| F15 | Operations dashboard: summaries, volumes, statuses, pending/failed/reconciliation queues, latency, error rates, health, audit | `OpsService`, Angular `DashboardComponent` |
| F16 | Administrative operations: outbox dead letters, requeue, ledger integrity check, drain | `OpsController` |

## Non-functional requirements

| Area | Requirement | How it is met / verified |
|---|---|---|
| **Correctness** | No floating point for money; two-decimal currencies; HALF_EVEN rounding; overdraft impossible even through direct SQL | `MoneyPolicyTest`, `SchemaConstraintsIT` |
| **Consistency** | Debit and credit of a transfer commit atomically; ledger always equals balances | `ConcurrencyScenarios`, `/ops/ledger-integrity` after every scenario |
| **Concurrency** | Concurrent requests on one account serialise; opposing transfers cannot deadlock | ordered row locks, `ConcurrencyIT` (H2) and `PostgresConcurrencyIT` (PostgreSQL) |
| **Reliability** | Processing survives crashes and duplicate delivery; unknown outcomes never lose or double-spend money | outbox, idempotent processor, stuck-transaction recovery, reconciliation |
| **Resilience** | Timeouts, retry with exponential backoff + jitter (idempotent calls only), circuit breaker, bulkhead by design (async worker) | `RestClearingClient`, `RetryAndRateLimitTest`, chaos e2e |
| **Security** | OAuth2/OIDC-compatible JWT validation, RBAC, object-level authorization, rate limit, request-size limit, CORS allow-list, secure headers, no sensitive data in logs or errors | `SecurityIT`, threat model, OWASP mapping |
| **Performance (targets, illustrative)** | p95 read < 300 ms, p95 submit < 500 ms, error rate < 1 % | `performance/k6/lib.js` thresholds; **measured** local baseline in `docs/validation` |
| **Availability** | Stateless service instances (>= 2), graceful shutdown, rolling updates without downtime, readiness/liveness probes | `infrastructure/k8s`, probes, `server.shutdown=graceful` |
| **Observability** | Structured JSON logs with correlation id, RED metrics + business metrics, health, distributed tracing | `PlatformMetrics`, `observability/` |
| **Maintainability** | Modular monolith with one-directional dependencies, pure domain rules, small classes, ADRs | `docs/decisions` |
| **Portability** | Runs with zero infrastructure (H2) and on PostgreSQL; containers; Kubernetes manifests | `application*.yml`, `infrastructure/` |
| **Accessibility** | Labelled form controls, keyboard operable, status not conveyed by colour alone, live regions for async state | `frontend` templates, lint rules `templateAccessibility` |
| **Data retention** | Idempotency records purged after 7 days; audit trail append-only; documented retention for the rest | `TransactionMaintenance`, `docs/architecture/06-database.md` |

## Out of scope (explicitly)

Real brokerage connectivity, order execution, market data, tax lots, corporate actions, multi-currency conversion, fees and
interest accrual, statements, sanctions/AML screening, multi-tenancy across legal entities (see the multi-tenant discussion in the
interview guide), and regulatory reporting.
