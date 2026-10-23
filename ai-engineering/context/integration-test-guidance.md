# Integration-test guidance

* Extend `AbstractIntegrationTest`: real Spring context, real Flyway + seed data, **real JWT validation** (tokens minted with the local issuer's encoder), `MockMvc`. Tests create their *own* accounts through the API (`fundedAccount`) so they never depend on each other; the context is cached across classes.
* `drain()` runs the outbox deterministically (the scheduler is off in tests); the scripted clearing double is driven by the **cents** of the amount (`.13` decline, `.66` timeout-but-executed, `.77` timeout-not-executed, `.88` not sent).
* After any scenario that moves money call `assertLedgerIntegrity()`.
* **Security tests are first-class:** for each endpoint add: unauthenticated (401), wrong role (403), other customer's object (404 + audit), and the happy path.
* **Concurrency tests:** extend `ConcurrencyScenarios` (so they run on H2 *and* real PostgreSQL); start all threads together (latch), one thread per task, `@Timeout`, assert the *final state and invariants*.
* **Database behaviour** (locks, partial indexes, triggers, plans): `PostgresFeaturesIT`/`PostgresConcurrencyIT` - embedded PostgreSQL needs no Docker; `TestcontainersPostgresConcurrencyIT` runs where Docker exists.
* **Contract:** `ApiContractIT` fails if `specs/openapi.json` is stale - regenerate and commit it deliberately.
* Keep integration tests few and meaningful (each context start costs ~45 s on a laptop); push detail down to unit tests.
* Flaky test policy: a flaky test is a bug in the test or the code - find the interleaving, never add a blind retry.
