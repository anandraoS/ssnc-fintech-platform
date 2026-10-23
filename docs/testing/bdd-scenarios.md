# BDD scenarios

The Gherkin text is in `tests/bdd/transactions.feature`. It is kept as the **specification** and every scenario is bound to automated tests by name
(there is deliberately no Cucumber runtime - the scenarios run as JUnit integration tests and as live end-to-end checks, so wording and behaviour cannot drift apart
inside a glue-code layer nobody maintains).

| Scenario (required) | Given / When / Then (summary) | Automated by |
|---|---|---|
| **A valid withdrawal** | account 1,000.00; withdraw 250.00 -> 202 `VALIDATED`, then `COMPLETED`, balance 750.00, ledger integrity holds | `TransactionFlowIT.validWithdrawal`, `PostgresFlowIT` (same), e2e `valid withdrawal` |
| **A withdrawal exceeding the available balance** | account 100.00; withdraw 100.01 -> 422 `TRANSACTION_REJECTED` / `INSUFFICIENT_FUNDS`, recorded and audited, balance unchanged | `TransactionFlowIT.withdrawalExceedingBalance`, e2e `insufficient funds` |
| **A duplicate transaction submission** | same key twice or 3x concurrently -> one transaction, replay header, applied once; same key + different amount -> 422 `IDEMPOTENCY_KEY_REUSED` | `IdempotencyIT` (6 tests incl. 12 threads), e2e `duplicate submission` |
| **A transfer between two accounts** | A 500.00, B 50.00; transfer 200.00 -> A 300.00, B 250.00, one DB transaction | `TransactionFlowIT.transferBetweenAccounts`, e2e `transfer` |
| **Concurrent requests against the same account** | 20 x 10.00 against 100.00 -> exactly 10 complete, 10 `INSUFFICIENT_FUNDS`, balance 0.00; opposing transfers never deadlock | `ConcurrencyScenarios` on H2 and on real PostgreSQL; e2e `concurrent withdrawals` |
| **An unauthorized account-access attempt** | Alice requests Bob's account/balance/history or submits against it -> 404, `ACCESS_DENIED` audited, balance unchanged | `SecurityIT` (BOLA tests), e2e `unauthorized account access` |
| **A failed transaction requiring investigation** | clearing times out -> `RECONCILIATION_REQUIRED`, funds reserved, attempts + audit visible, auto/manual resolution, money paid out once or returned in full | `TransactionFlowIT.unknownOutcome*`, `stuckProcessingIsRecovered`, e2e `clearing network...` and chaos |

Additional scenarios: maker-checker approval, daily limit (outline with examples), cancellation vs processing, clearing decline/refund, not-sent refund, closing an
account, search/pagination/sorting, dashboard data.

## Acceptance-criteria template used for every feature

```
Feature: <business capability>
  Rule: <one business rule>
    Scenario: <example>   Given <state> When <action> Then <observable outcome> And <invariant that must still hold>
```

Every scenario ends with an **invariant** clause (ledger integrity, nothing half-applied, audit written). That habit is what turns a happy-path demo into a
specification of a financial system.
