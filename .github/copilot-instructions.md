# Repository instructions for GitHub Copilot (and other coding assistants)

This is a **synthetic** investment-account and transaction platform (Java 21, Spring Boot 3, PostgreSQL, Angular 20). Keep this file short: details live in
`ai-engineering/context/*.md` and in the path-specific files under `.github/instructions/`. **Critical rules (never trade these for convenience):**

1. **Money** is `BigDecimal` only, compared with `compareTo`, serialised as JSON *strings*, never rounded silently (`MoneyPolicy`). No `double`/`float` near amounts, in Java *or* TypeScript.
2. **Only `LedgerService` changes balances**, inside a transaction, after taking row locks (`AccountRepository.lockById`) in **ascending id order**; checks are repeated under the lock.
3. **Never call an external system inside a database transaction.** Reserve -> commit -> call -> commit outcome. An *unknown* outcome is reconciled, never guessed (ADR-003, ADR-011).
4. **Every endpoint needs two checks:** a role rule (`@PreAuthorize`) and an object-level rule (`AccessPolicy`). Foreign objects answer `404` and are audited. Add a BOLA test with every endpoint.
5. **Retries only for idempotent calls**, with exponential backoff and jitter and a cap. State-creating endpoints require an `Idempotency-Key`.
6. **Controllers never expose entities.** DTOs (records) + Bean Validation; unknown JSON properties are rejected. Errors use the standard envelope; never leak internals.
7. **Migrations are forward-only and additive (expand/contract). Never edit a released migration.** Keep `postgresql` and `h2` vendor folders in step.
8. **No secrets anywhere** (code, tests, examples, logs). Use environment variables; placeholders are `CHANGE_ME_*`.
9. **Tests first or alongside.** Pure rules get unit tests; wiring gets integration tests; interleavings get concurrency tests; every defect gets a regression test. Never claim a test passes unless you ran it.
10. **Smallest dependency set.** Do not add a library, broker or cache without an ADR.

Commands: `mvn -f backend/pom.xml verify` (unit + integration), `cd frontend && npx ng lint && npx ng test --watch=false --browsers=ChromeHeadlessNoSandbox && npx ng build`,
`scripts/run-local.sh` (needs `mvn package` first), `node tests/e2e/e2e-api.mjs`.

When unsure about a security or money decision: list 2-3 options, mark the safest as the default, explain the trade-off, and proceed with the safest unless a human approves otherwise.
