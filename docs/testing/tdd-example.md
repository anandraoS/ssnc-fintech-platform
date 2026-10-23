# Complete TDD example: daily withdrawal limit

**Feature (product request):** *"A customer must not be able to withdraw more than the account's daily limit in any rolling 24-hour
window, including withdrawals still in flight."*

## 0. Acceptance criteria (written before any code)

| # | Criterion |
|---|---|
| AC1 | A withdrawal below the remaining allowance is accepted. |
| AC2 | A withdrawal that exactly reaches the limit is accepted. |
| AC3 | One cent over the limit is rejected with code `DAILY_LIMIT_EXCEEDED`. |
| AC4 | Earlier withdrawals in the window (completed, processing, or awaiting reconciliation) count against the limit. |
| AC5 | A limit of zero blocks every withdrawal. |
| AC6 | Comparison ignores `BigDecimal` scale (`1000.0` equals `1000.0000`). |
| AC7 | Under concurrency the limit is still respected (two parallel withdrawals cannot both slip under it). |
| AC8 | Cancelled, rejected and failed withdrawals do **not** count. |

## 1. RED - write the failing test first

`DailyLimitPolicyTest` (six tests mirroring AC1-AC6) was written against a stub whose body is
`throw new UnsupportedOperationException("not implemented")`. Running it (real output of the run, scratch module):

```text
[ERROR] Tests run: 6, Failures: 0, Errors: 6, Skipped: 0, Time elapsed: 0.243 s <<< FAILURE! -- in ...DailyLimitPolicyTest
[ERROR] ...DailyLimitPolicyTest.cumulativeWithdrawalsCount ... java.lang.UnsupportedOperationException: not implemented
[ERROR] ...DailyLimitPolicyTest.scaleDoesNotMatter           ... java.lang.UnsupportedOperationException: not implemented
[ERROR] ...DailyLimitPolicyTest.belowLimitIsAllowed          ... java.lang.UnsupportedOperationException: not implemented
[ERROR] ...DailyLimitPolicyTest.exactlyAtLimitIsAllowed      ... java.lang.UnsupportedOperationException: not implemented
[ERROR] ...DailyLimitPolicyTest.oneCentOverIsRejected        ... java.lang.UnsupportedOperationException: not implemented
[ERROR] ...DailyLimitPolicyTest.zeroLimitBlocksEverything    ... java.lang.UnsupportedOperationException: not implemented
```

A red test that fails for the *right reason* ("not implemented", not a typo or a compile error) is the point of this step.

## 2. GREEN - the minimum correct behaviour

```java
public static boolean wouldExceed(BigDecimal dailyLimit, BigDecimal alreadyWithdrawn, BigDecimal requested) {
    return alreadyWithdrawn.add(requested).compareTo(dailyLimit) > 0;   // compareTo: 1000.0 == 1000.0000
}
```

```text
[INFO] Tests run: 6, Failures: 0, Errors: 0, Skipped: 0 -- in ...DailyLimitPolicyTest      BUILD SUCCESS
```

Nothing else was written: no repository, no controller, no configuration. One line satisfies AC1-AC6.

## 3. Wire it in, still test-first

* `TransactionValidatorTest.dailyLimit` (AC3/AC4 at the rule level) - the validator receives `withdrawnInWindow` as an *input*, so the rule stays pure.
* `TransactionRepository.sumWithdrawnSince(accountId, since, statuses, excludeId)` provides the sum; the statuses that count are an explicit set
  (`PROCESSING, COMPLETED, RECONCILIATION_REQUIRED` - AC4/AC8: cancelled/rejected/failed are absent).
* `account.daily_withdrawal_limit` column (migration), `AccountType` defaults, `OpenAccountRequest.dailyWithdrawalLimit`.

## 4. REFACTOR - with the tests green

* The check existed in two places (advisory at submit, authoritative at processing). Both now call `DailyLimitPolicy.wouldExceed`, so the rule has one
  definition; the 6 + 10 unit tests stayed green throughout.
* The authoritative evaluation moved **under the account row lock** inside `LedgerService.reserveWithdrawal` (AC7) - the refactor that matters:
  without it two parallel withdrawals could each read "40 withdrawn so far" and both pass.

## 5. Integration tests

| Test | Proves |
|---|---|
| `TransactionFlowIT.dailyLimitEnforced` (H2) and `PostgresFlowIT` (PostgreSQL) | the HTTP path: 60 accepted, then 40.01 rejected with `DAILY_LIMIT_EXCEEDED`, then 40.00 accepted |
| `ConcurrencyScenarios.concurrentWithdrawalsRespectDailyLimit` | AC7: eight parallel 40.00 withdrawals against a 100.00 limit -> exactly two complete (80.00), balance 4,920.00, ledger intact |
| `TransactionFlowIT.dailyLimitIgnoresCancelledAndFailed` | AC8: a cancelled 60.00 and a declined (failed) 60.13 consume no allowance - the full 100.00 is still available |
| `LedgerServiceTest.reserveWithdrawal` | the limit is enforced inside the locked section and nothing is mutated on rejection |

## 6. Documentation and acceptance

AC1-AC8 are covered as listed above; the BDD wording is in `tests/bdd/transactions.feature` (`Daily withdrawal limit` outline); the validation rule is in the
domain chapter; the API reports the failure as `422 TRANSACTION_REJECTED` with `details.failureCode = DAILY_LIMIT_EXCEEDED`.

## What the example demonstrates

Small steps, a failing test that fails for the right reason, the simplest implementation, refactoring under a green bar, pushing the rule to where it is
*safe* (under the lock), and letting the concurrency test - not the unit test - prove the property that actually matters in production.
