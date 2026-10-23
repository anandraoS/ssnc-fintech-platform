# Unit-test generation guidance

**What to unit test:** pure rules and small units - validators, policies, state machines, money maths, retry/backoff, token bucket, mappers, outcome classification, orchestration with mocked collaborators (Mockito) where the *order and branches* matter.
**How to derive tests:** from the acceptance criteria and from the **boundaries** (exactly at the limit, one cent over, zero, negative, null, scale differences `1.0` vs `1.00`, empty collections), not from reading the implementation.
**Shape:** `@DisplayName` as a sentence of behaviour; Arrange/Act/Assert; one reason to fail per test; table-driven loops for matrices (see `TransactionStatusTest`, 81 pairs against an independent expected map).
**Mockito rules:** mock collaborators, never the unit under test; verify interactions only when the interaction *is* the behaviour (lock order, "do not refund on Unknown"); prefer real small objects (`Account`, `FinancialTransaction`) to mocks of them; use a no-op `TransactionTemplate` helper for code written against templates.
**Time and randomness:** inject `Clock`/`RandomGenerator`/sleepers - tests never sleep.
**Mutation thinking:** after writing a test, delete or invert the line it should protect - it must go red.
**Review prompt for generated tests:** "Which production bug would each test catch? Which important case is missing? Which assertion is redundant? Does any test only restate the implementation?"
**Do not:** assert on logs or private fields, use real network/DB in a unit test, share mutable state between tests, or use `Thread.sleep` for synchronisation.
