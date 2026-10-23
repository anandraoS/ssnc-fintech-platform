# Workflow example: implementing the account transfer with an assistant

The specification is `specs/001-account-transfer.md`. How the eleven steps looked (what the **human** decides is in bold):

| Step | With the assistant | Human decision / check |
|---|---|---|
| 1 Requirements | "Restate spec 001, list open questions" -> asks whether transfers cross customers, whether fees apply, whether the daily limit applies | **answers: same customer only, no fees, limit applies to withdrawals only** |
| 2 Acceptance criteria | proposes negative/security/concurrency cases (opposing transfers, foreign account, key reuse) | **accepts 12 criteria** |
| 3 Design | proposes `applyTransfer` with ordered locks and one DB transaction; lists alternatives (saga, conditional UPDATE) | **GATE 1: approves design, rejects the saga** |
| 4 API contract | confirms reuse of `POST /transactions` and error codes; flags `accountsConsistentWithType` validation | **approves, checks OpenAPI diff** |
| 5 Data model | none needed - points at existing `CHECK` and unique constraints | **confirms no migration** |
| 6 Implementation | slices: state machine -> validator -> ledger -> service -> processor, each after a failing test | reviews each diff |
| 7 Tests | generates tests from criteria; mutation notes (remove lock-order line -> test fails) | **runs them, reads them** |
| 8 Security review | security-review agent/prompt: BOLA on both accounts, `canSubmit` for transfers, idempotency scope | **GATE 2 input** |
| 9 Performance review | two row locks, no I/O in the transaction, plan check; baseline script for opposing transfers | reviews the numbers and their caveats |
| 10 Documentation | sequence diagram, API example, BDD scenario, runbook line | checks it against the code |
| 11 Release planning | checklist, rollback (`rollout undo`, no schema change), post-release verification | **signs the readiness checklist** |

Observed value: the assistant is fastest at scaffolding and at proposing test cases; every real defect found in this project (undersized column, null-version `save()` trap, signed `UUID` ordering, scheduler throughput) was found by **running** the tests, which is why the Definition of Done insists on recorded runs.
