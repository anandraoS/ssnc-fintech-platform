# Spec 001: Account transfer

> Specification-driven development: this document was written **before** the implementation and is the contract the code, the tests and the
> review are measured against. Each numbered section corresponds to a step of the workflow in `ai-engineering/README.md`. Status: **implemented**
> (`TransactionService`, `LedgerService.applyTransfer`, `TransactionFlowIT.transferBetweenAccounts`, `ConcurrencyScenarios.oppositeTransfersDoNotDeadlock`).

## 1. Requirements analysis

* **Users:** customers moving money between their own accounts; operators on a customer's behalf.
* **In scope:** same-customer, same-currency transfers; atomic debit+credit; idempotent; auditable; reviewed above the threshold.
* **Out of scope:** cross-customer payments, currency conversion, fees, scheduled/recurring transfers.
* **Assumptions:** both accounts exist and are `ACTIVE`; the platform does not call any external system for internal transfers.
* **Open questions (resolved):** *Should a transfer pass through the external network?* No - internal ledger movement only. *Is the minimum balance enforced on the source?* Yes. *Daily limit?* Applies to withdrawals only (decision recorded; revisit with the business).

## 2. Acceptance criteria (Given/When/Then)

1. **Happy path:** *Given* A has 500.00 and B 50.00 (both ACTIVE, same customer, USD), *when* the customer transfers 200.00 A -> B with a fresh key, *then* the response is `202` and the transaction completes with A = 300.00, B = 250.00 and two ledger entries.
2. **Insufficient funds:** *Given* A has 100.00, *when* 100.01 is transferred, *then* `422 TRANSACTION_REJECTED / INSUFFICIENT_FUNDS`; both balances unchanged.
3. **Same account:** source == target -> `422 SAME_ACCOUNT_TRANSFER` (and rejected by a DB `CHECK`).
4. **Currency:** both accounts and the request must share one currency -> `CURRENCY_MISMATCH`.
5. **Status:** either account not ACTIVE, or either owner not ACTIVE -> rejected with the specific code.
6. **Authorization:** a customer may only transfer between accounts of **their own** customer; any foreign account -> `404`; support agents -> `403`.
7. **Idempotency:** repeating the request with the same key never creates a second transfer; concurrent repeats create exactly one.
8. **Atomicity:** debit and credit are committed together or not at all; there is no state where only one side exists.
9. **Concurrency:** opposing simultaneous transfers A->B and B->A never deadlock; total money across A and B is conserved.
10. **Review:** amount >= 50,000 -> `PENDING_REVIEW`; approved by a different operator before processing.
11. **Audit:** `TRANSACTION_SUBMITTED`, `TRANSACTION_VALIDATED`, `TRANSACTION_PROCESSING`, `TRANSACTION_COMPLETED` rows with the actor and correlation id.
12. **Observability:** counters `platform_transactions_submitted_total{type="TRANSFER"}` and `..._finished_total`, end-to-end latency histogram.

## 3. Technical design

* Validation: `TransactionValidator` (pure) with `AccountSnapshot`s for both accounts; rules per section 2.
* Execution: `TransactionProcessor.begin` -> `LedgerService.applyTransfer` inside **one** DB transaction: lock both accounts `FOR UPDATE` in ascending id order, re-check status and funds
  (authoritative), debit source, credit target, insert two ledger entries (`DEBIT` for the source, `CREDIT` for the target), transition to `COMPLETED`.
* No external call (internal movement): no `PROCESSING` hold state, no reconciliation path needed.
* Failure inside the transaction (`ApiException`) rolls everything back, then the transaction is recorded `FAILED` with the code in a fresh transaction.
* Alternatives considered: (a) two separate single-account operations coordinated by a saga - rejected, introduces a half-applied state; (b) `UPDATE ... SET balance = balance - x WHERE balance >= x` for each side - rejected, loses the ledger/limit/status checks in one critical section.

## 4. API contract

`POST /api/v1/transactions` with header `Idempotency-Key`:

```json
{ "type": "TRANSFER", "sourceAccountId": "<uuid>", "targetAccountId": "<uuid>", "amount": "200.00", "currency": "USD", "memo": "optional, max 140" }
```

| Outcome | Status | Body |
|---|---|---|
| accepted | `202` + `Location` | `TransactionResponse` (`status` `VALIDATED` or `PENDING_REVIEW`) |
| rule violated | `422` | `ApiError` code `TRANSACTION_REJECTED`, `details.failureCode` |
| invalid input | `400` | `VALIDATION_ERROR` with `violations[]`; also type/account shape (`accountsConsistentWithType`) |
| foreign account | `404` | `ACCOUNT_NOT_FOUND` |
| wrong role | `403` | `ACCESS_DENIED` / `TRANSACTION_NOT_PERMITTED` |
| key reuse with a different payload | `422` | `IDEMPOTENCY_KEY_REUSED` |

Backward compatibility: the endpoint and DTO are shared with deposits/withdrawals; no existing field changed (only added behaviour for `type=TRANSFER`).

## 5. Data-model changes

None beyond the base schema: `transactions` already carries both account ids with `CHECK` constraints (`TRANSFER` requires both, different); `ledger_entries` has `UNIQUE (transaction_id, account_id, entry_type)` so the two postings cannot be applied twice.

## 6. Implementation plan (slices, each test-first)

1. `TransactionStatus` machine + `FinancialTransaction.transitionTo` (+ matrix test). 2. Validator rules (+ unit tests). 3. `LedgerService.applyTransfer` with ordered locks (+ Mockito lock-order test).
4. `TransactionService.submit` wiring and idempotency (+ IT). 5. Processor wiring (+ unit + IT). 6. Concurrency scenarios (+ PostgreSQL run). 7. UI form rules. 8. E2E.

## 7. Test plan

Unit: validator, access policy, lock order, state machine. Integration: `TransactionFlowIT.transferBetweenAccounts`, `SecurityIT.cannotSubmitAgainstOthersAccounts`, `IdempotencyIT`,
`ConcurrencyScenarios.oppositeTransfersDoNotDeadlock` (H2 and real PostgreSQL), `SchemaConstraintsIT` (transfer shape). E2E: `e2e-api.mjs` "transfer between accounts"; UI form tests.

## 8. Security review (checklist result)

BOLA: both accounts checked with `canViewAccount`, then `canSubmit` requires both owners to equal the caller's customer. Mass assignment: strict DTO. Idempotency scoped per principal. Maker-checker for large amounts. No new logging of PII. Rate limit applies.

## 9. Performance review

Two row locks per transfer, held for the duration of one short transaction (no I/O inside). Opposing transfers serialise rather than deadlock. Indexes used: primary keys for the locks, `ix_tx_*` for history. Measured behaviour under 16 concurrent clients: `docs/validation/perf-baseline.json` ("opposing transfers" - money conserved).

## 10. Documentation

Domain chapter (lifecycle), integrity chapter (sequence diagram), API examples, BDD scenario, runbook entries for failures.

## 11. Release planning

Ships with the base platform (no migration dependency). Rollout: standard rolling update; feature switch not required (new endpoint behaviour only for `type=TRANSFER`). Rollback: `rollout undo`; no schema change to undo. Post-release checks: transfer success rate, `FAILED` codes, ledger integrity, no lock-timeout spike.
