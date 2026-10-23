# Product requirements (example PRD) and feature specifications

## PRD-1: Reliable money movement for internal applications

| | |
|---|---|
| **Problem** | Three internal applications each implement their own balance checks and retry logic; duplicate and overdrawn transactions reach the operations team weekly and reconciliation is manual. |
| **Goal** | One platform API that makes money movement *correct by construction*: no overdraft, no duplicate application, no half-applied transfer, full audit. |
| **Users** | Customers (self-service), operations analysts (exceptions), support agents (look-up), administrators. |
| **Success metrics** | duplicate-transaction incidents -> 0; ledger-integrity violations = 0; p95 submission < 500 ms; 99.9 % availability; unknown-outcome transactions resolved < 15 min median; operations time per exception down 50 %. |
| **Non-goals** | real brokerage connectivity, order execution, fees/interest, cross-customer transfers, multi-currency conversion. |
| **Constraints** | Java/Spring Boot + Angular; PostgreSQL; synthetic data in non-production; audit retention per policy; SOC-2-style change control. |
| **Release plan** | Sprint 1-2 foundation, Sprint 3 operations tooling, Sprint 4 hardening and launch readiness (see `sprint-plan.md`). |

## Feature specifications (one-pagers, each with acceptance criteria)

### FS-1 Idempotent submission
*As a client developer, I want a retried request to return the original result so that a network glitch never moves money twice.*
**Acceptance:** (1) `Idempotency-Key` required (400 otherwise); (2) same key + same payload returns the original response with `Idempotent-Replayed: true`; (3) same key + different payload -> 422; (4) concurrent identical requests produce exactly one transaction; (5) keys are scoped per user; (6) records expire after 7 days.

### FS-2 Maker-checker for large transactions
*As a risk officer, I want amounts >= 50,000 to need a second person so that one insider cannot move large sums.*
**Acceptance:** (1) such a submission is `PENDING_REVIEW`; (2) the submitter cannot approve/reject; (3) another operator/admin can; (4) a customer cannot; (5) approval/rejection is audited with the reviewer; (6) an approved transaction is then processed normally.

### FS-3 Uncertain-outcome handling
*As an operations analyst, I want withdrawals with an unknown network outcome to be held and resolved so that customers are neither double-paid nor charged for nothing.*
**Acceptance:** (1) timeout -> `RECONCILIATION_REQUIRED`, funds stay reserved; (2) the reconciler resolves it from the network's answer automatically; (3) I can see attempts, audit trail and the reconciliation record; (4) I can resolve manually, but not for my own submission; (5) an alert fires if it stays open 15 minutes; (6) the ledger is intact afterwards.

### FS-4 Daily withdrawal limit (built test-first)
See `docs/testing/tdd-example.md` for the acceptance criteria AC1-AC8.

### FS-5 Account transfer
Specified end to end in `specs/001-account-transfer.md` (specification-driven development example).
