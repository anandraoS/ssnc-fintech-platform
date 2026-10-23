# Mentoring junior developers

Principles: teach with the codebase (every lesson points at a real class and a test), prefer questions to answers ("what happens if this runs twice?"), review the *thinking* before the code,
give small stretch tasks with a safety net (tests, pairing), and make safe failure normal (blameless reviews).

## Worked examples

### SOLID - "this service does too much"
*Observation:* a junior's `TransactionService` validates, writes the audit row, calls the clearing API and sends e-mails.
*Coaching:* ask them to list the reasons the class would change. Together split into `TransactionValidator` (decides), `LedgerService` (changes balances), `TransactionProcessor` (orchestrates),
`ClearingClient` (adapter). *Show:* the validator is pure, so ten rules became ten one-line tests. *Homework:* add a new rule (`DailyLimitPolicy`) without touching any class except the validator - open/closed in practice.

### Design patterns - when *not* to use one
*Observation:* a factory-of-strategies-of-visitors for three transaction types.
*Coaching:* a `switch` over a sealed/enum type with exhaustive checking is simpler and the compiler tells you when a new type is unhandled. Introduce a pattern when it removes duplication you can *point at* (here: the `ClearingClient` port exists because the real adapter, the in-process one and the test double all differ).

### Testing - "it passes, but would it fail if the code were wrong?"
*Exercise:* delete the `lockById` call from `LedgerService` and run the suite: the single-thread tests stay green, `concurrentWithdrawalsNeverOverspend` goes red. Lesson: tests must be able to fail for the property you care about; add a concurrency test whenever the property is about interleavings. Then write a red/green TDD cycle together (`docs/testing/tdd-example.md`).

### Secure coding - think like the caller
*Exercise:* "log in as Alice and try to read Bob's account using only curl". They find nothing blocks it in their draft controller; fix with `AccessPolicy`, then write the BOLA test *first* for the next endpoint. Discuss why the answer is `404`, why masking matters for support, why `FAIL_ON_UNKNOWN_PROPERTIES` is on.

### Performance - measure first
*Exercise:* the history endpoint is "slow" - before changing anything, capture `EXPLAIN (ANALYZE)` (the repository's captured plans), read `Rows Removed by Filter`, hypothesise (OR predicate), write the expected result, change one thing, re-measure. Rule: no optimisation without a before/after number (see how the dispatcher change was measured).

### Production troubleshooting - follow one correlation id
*Exercise:* trigger a failing transaction via the simulator (`.66`), then investigate as on-call: dashboard -> `/ops/health` -> transaction attempts -> audit trail -> reconciliation record -> runbook. Rotate the on-call shadow role weekly.

## The scenario: "the unit tests pass, but it fails under concurrent load"

A junior implements *withdraw* as read, check, write (scenario 1 in the code-review scenarios). My approach:
1. **Don't lead with the answer.** Ask them to run two requests at once (the k6/Node script) and look at the final balance; let them see -40.
2. **Build the mental model:** draw the two timelines on a whiteboard, name the anomaly (lost update / write skew), connect it to isolation levels.
3. **Present the option space, not just the fix:** row lock, atomic conditional `UPDATE`, optimistic version with retry, serialisable isolation, single writer; discuss trade-offs.
4. **Make the failure reproducible as a test first** (the concurrency scenario), watch it fail, apply the fix, watch it pass - on the real database, not only H2.
5. **Generalise:** add "what if this runs twice / concurrently / is retried?" to their personal review checklist and to the PR template.
6. **Follow up:** have them review the next person's concurrency-sensitive PR with the checklist (teaching reinforces learning), and pair on the next lock-related task.

## Feedback style
Specific, kind, actionable, tied to impact; one or two themes per review, not twenty nits; praise good decisions explicitly (it is how norms spread); label comments (`blocker`/`suggestion`/`nit`/`question`).
