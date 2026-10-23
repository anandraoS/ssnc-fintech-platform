# Validation report

All numbers below come from commands run on one Windows developer machine (8 CPUs, Java 21 GraalVM, Node 24, Microsoft Edge headless). Raw outputs are in `docs/validation/` and `.work/` (not shipped). Nothing here is a benchmark or a production measurement.

## 1. Executed and passing

| Check | Command / source | Result |
|---|---|---|
| Backend full build (clean), both modules | `mvn -B clean verify` (backend/) | **BUILD SUCCESS**, 6 min 42 s |
| Unit tests (platform-service) | surefire | **81 passed**, 5 skipped (Testcontainers class, see section 2) |
| Integration tests (platform-service) | failsafe | **95 passed**, 5 skipped (same Testcontainers class) |
| clearing-simulator tests | surefire | **6 passed** |
| Real PostgreSQL 14.10 (embedded, no Docker): flow, concurrency, features | `PostgresFlowIT` 18, `PostgresConcurrencyIT` 5, `PostgresFeaturesIT` 4 | **27 passed** (included in the 95) |
| Concurrency on H2 and PostgreSQL | `ConcurrencyIT` 5, `PostgresConcurrencyIT` 5 | passed: no lost update, no overspend, no deadlock, daily limit holds, duplicate delivery harmless |
| Angular lint | `ng lint` | clean |
| Angular unit tests | Karma/Jasmine (headless) | **58 / 58 passed** |
| Angular production build | `ng build` | OK, about 341 kB initial bundle |
| React type-check and lint | `tsc --noEmit` (strict), `eslint` (typescript-eslint, react-hooks, jsx-a11y) | clean |
| React unit and component tests | Vitest + Testing Library, scripted fake backend | **90 / 90 passed** |
| React production build | `vite build` | OK, 279 kB main chunk (89 kB gzip) plus lazy route chunks |
| Live API end-to-end | `tests/e2e/e2e-api.mjs` against the running stack | **50 / 50** (`e2e-results.json`) |
| Live API end-to-end with chaos (simulator 5xx, timeouts) | `--with-chaos` | **55 / 55** (`e2e-results-with-chaos.json`) |
| Browser end-to-end, Angular UI (headless Edge, real backend) | `tests/e2e/ui-e2e.mjs` | **19 / 19**, 11 screenshots (`ui-e2e-results.json`, `docs/screenshots`) |
| Browser end-to-end, React UI (same suite, same backend, same run) | `tests/e2e/ui-e2e.mjs --flavor react` | **19 / 19**, 11 screenshots (`ui-e2e-results-react.json`, `docs/screenshots-react`) |
| Actuator on a separate management port | `scripts/check-management-port.mjs` | 5 / 5 PASS (readiness, liveness, prometheus on management port; 404 for actuator and 401 for API on the main port) |
| Static infrastructure validation | `scripts/validate-infra.py` | **0 failures** (compose, Kubernetes manifests, probes, security contexts, `automountServiceAccountToken: false`, alert-to-runbook mapping, no committed secrets) |
| Fail-closed security | start without a JWT decoder | application refuses to start (checked manually) |
| Local load baseline | `performance/local-baseline.mjs` | `perf-baseline.json`; all invariants held (300 completed withdrawals on a 300.00 balance, money conserved on opposing transfers, 25 idempotency keys gave 25 deposits, 0 ledger integrity violations). Outbox drain rose from about 23 to about 34 tx/s after the scheduler change (`perf-baseline-before-drain-loop.json`) |
| Mutation check on the concurrency tests | removed the row lock / lock ordering by hand, then restored | removing the row lock failed 4 of 5 `ConcurrencyIT` tests and the `LedgerServiceTest` lock tests; removing lock ordering failed the lock-order unit test |

Defects found by the final run and fixed before packaging:

* `ServerErrorIT.lockTimeoutIs503` asserted that the body does not contain `relation`, which also matched the field name `correlationId`. The assertion now checks for the leaked SQL text. The production code was correct.
* The three PostgreSQL ITs failed once with "Gave up waiting for server to start after 10000 ms" (cold first start of the native PostgreSQL binary). The startup wait is now 120 s. The four affected classes were re-run (30 / 30), then the whole build was re-run clean.
* `validate-infra.py` crashed on the test-overlay simulator Deployment, which had no rolling-update strategy; the manifest now declares one, and the validator also asserts that no pod mounts a service-account token.

Found while adding the React edition (all fixed, then every suite re-run on the final code):

* The first browser run of the React UI got **403** on sign-in. The development proxy rewrote the `Host` header, so the API saw a cross-origin request from an origin that is not on its CORS allow-list. The proxy now preserves `Host` (as nginx does); the allow-list was **not** changed and both UIs pass with the default configuration.
* Two timing races in the browser suite itself (a page checked before its accounts had loaded; a native `<select>` read before its options arrived). The suite now waits for the data; it was re-run for both UIs.
* One React test (the first of a file, which pays for the lazy route import) failed once in a full parallel run because Testing Library's default 1 s wait was too short on a loaded machine. The wait is now 5 s (test setup only; no application code changed) and four consecutive full runs passed 90 / 90.
* Native browser validation bubbles would have pre-empted the app's own messages on two small forms in the React UI; those forms are `noValidate`, like the others.

## 2. Written but NOT executed

| Item | Why not |
|---|---|
| Docker image builds, Docker Compose stack (including the React image and the `react` compose profile) | Docker is not installed on this machine. Compose and Dockerfiles are validated statically only |
| React edition: other browsers, visual regression, automated accessibility audit | Edge only; ESLint `jsx-a11y` is static analysis, not an audit |
| Prometheus, Grafana, OpenTelemetry collector, Jaeger | need the Compose stack. The configuration and alert rules are validated statically; metric names were confirmed against the real `/actuator/prometheus` output |
| Kubernetes apply, `kubeconform`, `hadolint` | no cluster and the tools are not installed; CI runs `kubeconform` and `hadolint` |
| GitHub Actions workflow | never run on a runner |
| k6 scripts | k6 is not installed (the Node baseline above covers the same scenarios on a small scale) |
| Testcontainers PostgreSQL concurrency test | skipped without Docker (5 tests, reported by both Maven phases) |
| AWS / cloud deployment | conceptual design only |
| Oracle, MongoDB | conceptual sections only |
| Multi-agent AI workflow definitions | definitions only, never executed |
| PostgreSQL 16 (Compose and CI target) | only 14.10 was executed |

## 3. Honest caveats

* Test and load numbers are from a shared developer laptop with an in-memory H2 database (load baseline) or an embedded PostgreSQL (integration tests). They show relative behaviour and invariants, not capacity.
* The clearing network is a deterministic simulator; its contract (idempotent on `reference`, supports lookup) is an assumption.
* Synthetic data only. The local token issuer is for development and tests and is disabled outside the `local` and `test` profiles.
* The application was not penetration-tested.
