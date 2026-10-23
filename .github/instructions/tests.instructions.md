---
applyTo: "**/*{Test,IT}.java,frontend/src/**/*.spec.ts,tests/**"
---
Follow `ai-engineering/context/unit-test-guidance.md` and `ai-engineering/context/integration-test-guidance.md`.
- A test must be able to fail for the property it names: prefer asserting the **invariant afterwards** (ledger integrity, nothing half-applied, audit written).
- Deterministic: no sleeps without a bounded wait, no wall-clock or time-zone dependence, each test creates its own accounts.
- Authorization: add a negative test for another customer's object (expect `404`) and for the wrong role (expect `403`).
- Concurrency: use a latch to start all threads together, one thread per task, a `@Timeout`, and assert the final state, not the interleaving.
- Never write a test that only restates the implementation; never mock the thing under test; never claim a result you did not run.
