# Acceptance criteria in Gherkin. These are EXECUTABLE SPECIFICATIONS in the sense that every scenario is implemented by a named
# automated test (tag @executed-by) - there is deliberately no Cucumber runtime: the scenarios are implemented as JUnit
# integration tests (backend/platform-service/src/test/java/...) and as live end-to-end checks (tests/e2e/e2e-api.mjs), so
# the wording stays in sync with real, running code. docs/testing/bdd-scenarios.md explains the mapping.

Feature: Financial transaction processing
  As a customer or an operator of an investment platform
  I want money movements to be validated, applied exactly once and fully auditable
  So that balances are always correct, even under failure and concurrency

  Background:
    Given the synthetic customers Alice and Bob exist, each with active accounts
    And every request carries a valid bearer token and an Idempotency-Key

  @executed-by:TransactionFlowIT#validWithdrawal @executed-by:e2e-api.mjs:valid-withdrawal
  Scenario: A valid withdrawal
    Given Alice's account holds 1000.00 USD
    When Alice submits a withdrawal of 250.00 USD
    Then the response is 202 Accepted with status VALIDATED
    And the transaction becomes COMPLETED asynchronously
    And the account balance is 750.00 USD
    And the ledger balance of every account equals the sum of its ledger entries

  @executed-by:TransactionFlowIT#withdrawalExceedingBalance @executed-by:e2e-api.mjs:insufficient-funds
  Scenario: A withdrawal exceeding the available balance
    Given Alice's account holds 100.00 USD
    When Alice submits a withdrawal of 100.01 USD
    Then the response is 422 with code TRANSACTION_REJECTED and failure code INSUFFICIENT_FUNDS
    And the rejected transaction is recorded and audited
    And the balance is still 100.00 USD

  @executed-by:IdempotencyIT#duplicateSubmissionReplays @executed-by:IdempotencyIT#concurrentSameKeyCreatesOneTransaction @executed-by:e2e-api.mjs:duplicate-submission
  Scenario: A duplicate transaction submission
    Given Alice submitted a deposit of 25.00 USD with Idempotency-Key K
    When the same request is submitted again with Idempotency-Key K, possibly concurrently
    Then every response is 202 Accepted and refers to the same transaction
    And the replayed responses carry the header Idempotent-Replayed: true
    And the deposit is applied exactly once
    But when the same key is used with a different amount the response is 422 IDEMPOTENCY_KEY_REUSED

  @executed-by:TransactionFlowIT#transferBetweenAccounts @executed-by:e2e-api.mjs:transfer
  Scenario: A transfer between two accounts
    Given Alice owns account A with 500.00 USD and account B with 50.00 USD
    When Alice submits a transfer of 200.00 USD from A to B
    Then the transaction becomes COMPLETED
    And A holds 300.00 USD and B holds 250.00 USD
    And the debit and the credit were committed in ONE database transaction

  @executed-by:ConcurrencyScenarios#concurrentWithdrawalsNeverOverspend @executed-by:ConcurrencyScenarios#oppositeTransfersDoNotDeadlock @executed-by:e2e-api.mjs:concurrent-withdrawals
  Scenario: Concurrent requests against the same account
    Given an account holds 100.00 USD
    When 20 withdrawals of 10.00 USD are processed concurrently
    Then exactly 10 complete and 10 fail with INSUFFICIENT_FUNDS
    And the balance is exactly 0.00 and never negative
    And opposing transfers between two accounts never deadlock and conserve the total

  @executed-by:SecurityIT#customerCannotReadOthersAccounts @executed-by:SecurityIT#cannotSubmitAgainstOthersAccounts @executed-by:e2e-api.mjs:unauthorized-access
  Scenario: An unauthorized account-access attempt
    Given Bob owns an account with 300.00 USD
    When Alice requests Bob's account, balance, history or submits a withdrawal against it
    Then every response is 404 (the existence of the account is not revealed)
    And an ACCESS_DENIED audit event is recorded
    And Bob's balance is unchanged

  @executed-by:TransactionFlowIT#unknownOutcomeResolvedManually @executed-by:TransactionFlowIT#unknownOutcomeIsReconciledAutomatically @executed-by:e2e-api.mjs:clearing-reconciliation
  Scenario: A failed transaction requiring investigation
    Given a withdrawal whose call to the external clearing network times out
    When the processor cannot tell whether the network executed it
    Then the transaction is RECONCILIATION_REQUIRED and the funds stay reserved
    And an operator can see the attempts, the audit trail and the open reconciliation record
    And the reconciler resolves it automatically from the network's answer, or an operator resolves it manually
    And the customer's money is either paid out exactly once or returned in full

  @executed-by:TransactionFlowIT#reviewThresholdAndMakerChecker @executed-by:e2e-api.mjs:maker-checker
  Scenario: A large transaction needs an independent approver
    Given an operator submitted a withdrawal of 60000.00
    Then it is PENDING_REVIEW
    And the same operator cannot approve it
    But a different operator can, after which it is processed

  @executed-by:TransactionFlowIT#dailyLimitEnforced @executed-by:DailyLimitPolicyTest
  Scenario Outline: Daily withdrawal limit (built test-first)
    Given an account with a daily withdrawal limit of 100.00 and <already> already withdrawn today
    When a withdrawal of <amount> is requested
    Then the outcome is <outcome>

    Examples:
      | already | amount | outcome  |
      | 0.00    | 100.00 | accepted |
      | 60.00   | 40.00  | accepted |
      | 60.00   | 40.01  | rejected |
      | 100.00  | 0.01   | rejected |
