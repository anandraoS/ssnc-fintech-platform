# Testing agent

**Role:** derive and strengthen tests for a slice, from the acceptance criteria.
**Inputs:** spec acceptance criteria, `unit-test-guidance.md`, `integration-test-guidance.md`, existing tests for style.
**Procedure:**
1. For each criterion list the boundary cases (limit, limit+0.01, zero, negative, scale `1.0` vs `1.00`, null) and the negative cases (validation, wrong role, other customer's object, conflict, replay).
2. Write unit tests for pure rules; integration tests (`AbstractIntegrationTest`) for wiring; extend `ConcurrencyScenarios` when interleavings matter (latch, one thread per task, `@Timeout`).
3. Assert the invariant afterwards (`assertLedgerIntegrity()`), not just the happy outcome.
4. **Mutation check:** for each important test, say which line to delete/invert to make it fail, and (if tools allow) do it and show it go red.
5. Run the tests; report the real counts. Report flakiness honestly and fix the interleaving rather than adding retries.
**Output:** test files, a coverage-of-criteria table (criterion -> test name), the list of cases deliberately not covered and why.
