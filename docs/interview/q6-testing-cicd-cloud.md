# Questions: testing, CI/CD and cloud

### Q93. How would you structure a test strategy for a financial transaction service?
**Short answer:** a pyramid biased toward fast unit tests of pure rules, targeted integration tests on real infrastructure for locks/constraints/security, and a few end-to-end journeys - with the money invariants asserted after every scenario.
**Reasoning and implementation:** unit: money maths, state machine, validators, policies, retry logic, orchestration branches with mocks; integration: Spring context + Flyway + real JWT validation, security/BOLA, idempotency races, concurrency on a real PostgreSQL, constraint tests, contract test; E2E: live stack incl. a simulator with chaos; performance: arrival-rate load with invariant checks. Every defect gets a regression test.
**Alternatives and trade-offs:** contract tests with consumers (Pact), property-based tests for money, mutation testing tools (PIT) to measure test strength.
**Risks and pitfalls:** testing only happy paths, mocking the database where locking matters, coverage as the goal.
**Likely follow-ups:** "how do you test concurrency?"
**In this project:** `docs/testing/test-strategy.md`, `ConcurrencyScenarios`, `assertLedgerIntegrity`.

### Q94. [Scenario] Walk through a TDD cycle for a new business rule.
**Short answer:** write a failing test that fails for the right reason, make it pass with the simplest code, refactor under green, then add integration tests and document acceptance criteria.
**Reasoning and implementation:** daily withdrawal limit: acceptance criteria first; six unit tests against a stub that throws (6 errors - the red evidence); one-line implementation using `compareTo` (6 pass); wire into the validator; refactor so advisory and authoritative checks share the rule; move the authoritative check under the account lock; integration and concurrency tests prove the HTTP path and the race.
**Alternatives and trade-offs:** test-after (faster initially, weaker design feedback), BDD outside-in.
**Risks and pitfalls:** tests that pass for the wrong reason, testing implementation details, skipping refactor.
**Likely follow-ups:** "what is the smallest step?"
**In this project:** `docs/testing/tdd-example.md` with the real red/green output.

### Q95. How do you write good BDD scenarios and avoid brittle ones?
**Short answer:** express business rules with concrete examples in domain language, one rule per scenario, always including the invariant that must still hold.
**Reasoning and implementation:** Given/When/Then with numbers (balance 100.00, withdraw 100.01); scenario outlines for boundary tables; bind each scenario to automated tests (here by name) so wording and behaviour stay in sync; avoid UI details in business scenarios.
**Alternatives and trade-offs:** Cucumber/Behave glue code (readable specs, extra layer to maintain), plain JUnit with descriptive names.
**Risks and pitfalls:** scenarios that describe implementation steps; huge Backgrounds; scenarios nobody reads.
**Likely follow-ups:** "who writes them?" (three amigos: product, dev, QA).
**In this project:** `tests/bdd/transactions.feature`, `bdd-scenarios.md`.

### Q96. [Scenario] A test passes locally but fails intermittently in CI. How do you approach it?
**Short answer:** treat flakiness as a bug: find the shared state, timing or ordering dependency, reproduce deterministically, and fix the cause.
**Reasoning and implementation:** look for time/clock dependence, shared database state between tests, unbounded waits, concurrency without proper synchronisation, port/ephemeral resource collisions, test-order dependence; rerun with a seed/ordering and with CPU contention; replace sleeps with bounded waits or deterministic drains; isolate data (each test creates its own accounts); add `@Timeout`. Never add blind retries.
**Alternatives and trade-offs:** quarantine with an owner and deadline (temporary).
**Risks and pitfalls:** normalising flakiness; retrying until green.
**Likely follow-ups:** "what if it only fails under load?"
**In this project:** examples: the latch deadlock (pool smaller than task count), the cold-start timeout in the HTTP client test (warm-up added), port collisions with other local services (port guard in `run-local.sh`).

### Q97. How do you test code that calls an unreliable external system?
**Short answer:** put it behind a port, test the adapter against a real HTTP server for protocol behaviour, test the domain with a scripted double for outcomes, and rehearse failure with a simulator.
**Reasoning and implementation:** `RestClearingClientTest` uses an in-JVM HTTP server to produce 503s, delays, dropped connections and verifies retries/timeouts/breaker/classification; `ScriptedClearingClient` (cents-driven) drives integration scenarios deterministically; the simulator service offers chaos modes for end-to-end runs; contract tests when a sandbox exists.
**Alternatives and trade-offs:** WireMock/MockServer (feature-rich), consumer-driven contracts.
**Risks and pitfalls:** mocks that return only success; assuming the real system behaves like the mock.
**Likely follow-ups:** "how do you keep the simulator honest?" (contract tests against the provider's sandbox).
**In this project:** the three tests above plus chaos e2e.

### Q98. [Scenario] How would you design a CI/CD pipeline with security gates?
**Short answer:** fast feedback first, then deeper scans, then build-once-promote with scans on the artefact, protected deployment, smoke tests and automatic rollback.
**Reasoning and implementation:** PR: compile, unit and integration tests, lint, SAST (SpotBugs/CodeQL), SCA (OWASP Dependency-Check, `npm audit`), secrets scan (gitleaks), config validation; main: build images once, scan (Trivy) with a severity gate, tag with a version, push; deploy to test via kustomize with `rollout status`, run smoke tests, roll back on failure; promote the *same* image to production with manual approval; pipeline hygiene: least-privilege tokens, pinned actions, OIDC federation, protected environments, SBOM/provenance.
**Alternatives and trade-offs:** Jenkins/GitLab CI; DAST in a deployed environment; admission control to enforce signed images.
**Risks and pitfalls:** gates that are always overridden, scans that only warn, building different artefacts per environment.
**Likely follow-ups:** "what if the scan finds a CVE with no fix?" (documented exception, compensating controls).
**In this project:** `.github/workflows/ci.yml` (reviewed, not run on a runner), ADR-009.

### Q99. What is the difference between continuous delivery and continuous deployment, and which fits a bank?
**Short answer:** delivery keeps every build releasable with a manual gate to production; deployment releases automatically. Regulated environments usually choose delivery with controlled approvals.
**Reasoning and implementation:** audit and change-control requirements favour an explicit approval, change records and segregation of duties, while the pipeline still automates everything else (tests, scans, deploys to test, smoke checks). Feature flags decouple deployment from release.
**Alternatives and trade-offs:** fully automated deployment with progressive delivery (canary + automated analysis) once risk controls are automated.
**Risks and pitfalls:** manual steps that are skipped under pressure; approvals without information.
**Likely follow-ups:** "how do you do emergency fixes?"
**In this project:** `deploy-test` automatic, production promotion manual by design.

### Q100. [Scenario] A release must roll back after a bad deploy that included a database migration. What is your plan?
**Short answer:** roll back the application (the previous version still works) and fix forward on the schema; use point-in-time recovery only as a last resort.
**Reasoning and implementation:** migrations are additive (expand/contract), so the old application tolerates the new schema; `kubectl rollout undo` restores the previous ReplicaSet in minutes; the ledger-integrity check, reconciliation queue and outbox backlog confirm health; data written by the new version in new columns is ignored by the old; if a migration corrupted data, restore a copy via PITR and repair from the audit trail before switching traffic.
**Alternatives and trade-offs:** blue/green with a replicated database (heavy), down-migrations (rarely safe).
**Risks and pitfalls:** destructive migration in the same release; migrations run concurrently by every replica at startup.
**Likely follow-ups:** "how do you test rollback?" (rehearse in the test environment).
**In this project:** `rollback-and-release.md`, migration guide.

### Q101. How do Kubernetes probes and rolling updates provide zero-downtime deployments?
**Short answer:** readiness gates traffic to new pods, `maxUnavailable: 0` keeps old pods until new ones are ready, and graceful shutdown drains old pods.
**Reasoning and implementation:** a new pod starts (startup probe tolerates Flyway/warm-up), becomes ready, receives traffic; an old pod gets `preStop: sleep 10` (load balancer deregisters), then SIGTERM -> Spring drains in-flight requests (20 s); `terminationGracePeriodSeconds` exceeds both; PDB prevents voluntary eviction below one pod; HPA handles scale.
**Alternatives and trade-offs:** blue/green, canary with a service mesh.
**Risks and pitfalls:** readiness that depends on flaky dependencies (flapping), liveness too aggressive (restart loops), grace period shorter than drain.
**Likely follow-ups:** "what happens to long-lived connections?"
**In this project:** `platform-service.yaml`.

### Q102. How do you design the AWS deployment for this platform?
**Short answer:** ALB + WAF in front, EKS (or ECS) in private subnets across AZs, RDS PostgreSQL Multi-AZ with KMS and PITR, Secrets Manager via External Secrets/IRSA, observability through managed Prometheus/Grafana or CloudWatch/X-Ray.
**Reasoning and implementation:** security groups per tier, VPC endpoints for AWS APIs, ECR with immutable tags and scan-on-push, GitHub Actions OIDC to AWS (no static keys), autoscaling (HPA, cluster autoscaler), backups and DR (RPO/RTO targets), environment-specific config through overlays, cost controls.
**Alternatives and trade-offs:** ECS Fargate (simpler), Lambda for edge functions, Aurora PostgreSQL (faster failover, cost).
**Risks and pitfalls:** public database, overly broad IAM, single-AZ, no restore tests.
**Likely follow-ups:** "how do you fail over the database?"
**In this project:** AWS deployment diagram and chapter (conceptual; no cloud account was used).

### Q103. [Scenario] The pipeline takes 40 minutes. How do you speed it up without reducing quality?
**Short answer:** parallelise independent jobs, cache dependencies, run the cheapest/most informative checks first, and push detail down to faster tests.
**Reasoning and implementation:** split into jobs (backend, frontend, scans, config validation) that run in parallel; cache Maven/npm; fail fast on lint/unit before integration; reduce Spring context starts (shared context, fewer classes); use Testcontainers reuse; run heavy scans on main or nightly while keeping PR-critical gates; shard long suites; measure each stage first.
**Alternatives and trade-offs:** larger runners, test-impact analysis.
**Risks and pitfalls:** moving security scans out of the merge path entirely; flaky parallel tests sharing state.
**Likely follow-ups:** "what do you never skip?"
**In this project:** jobs are parallel in `ci.yml`; integration tests share one cached context (~45 s each new context locally).

### Q104. What do you put in a smoke test, and what do you leave out?
**Short answer:** cheap, read-only, fast checks that the release is alive and security posture did not regress; leave business logic to automated suites.
**Reasoning and implementation:** frontend served, health endpoint, protected endpoints answer 401, actuator not exposed, security headers present; no data creation in production; run after each deployment and automatically trigger rollback on failure.
**Alternatives and trade-offs:** synthetic transactions (canary customers) for deeper confidence.
**Risks and pitfalls:** smoke tests that mutate production data, or that always pass.
**Likely follow-ups:** "synthetic monitoring?"
**In this project:** `scripts/smoke-test.sh`.

### Q105. How do you measure test quality beyond coverage?
**Short answer:** by whether tests fail when the code is wrong - mutation thinking or tooling - and by defects escaping to production.
**Reasoning and implementation:** delete/invert a protected line and verify a test fails (done here: removing the row lock fails 4 of 5 concurrency scenarios; removing the lock ordering fails the lock-order unit test); mutation testing tools (PIT) automate it; track escaped defects and add regression tests; review tests for restating implementation.
**Alternatives and trade-offs:** coverage thresholds (cheap signal), property-based testing.
**Risks and pitfalls:** coverage targets driving meaningless tests.
**Likely follow-ups:** "what coverage do you require?"
**In this project:** mutation check results in the validation report.

### Q106. How do you test database migrations?
**Short answer:** apply them from scratch in tests against the real database type, verify constraints/objects exist, and rehearse upgrades with realistic data.
**Reasoning and implementation:** Flyway runs in every integration test (H2 and PostgreSQL); `PostgresFeaturesIT` asserts partial indexes and the audit trigger; constraint tests bypass the application layer; Hibernate `validate` checks mappings; for upgrades, run migrations on a copy of production-size data to measure locks and duration.
**Alternatives and trade-offs:** schema diff tools, shadow databases.
**Risks and pitfalls:** testing only against H2; migrations that pass on empty tables and lock large ones.
**Likely follow-ups:** "how do you test a data backfill?"
**In this project:** `SchemaConstraintsIT`, `PostgresFeaturesIT`.

### Q107. [Scenario] Your Spring context takes 50 seconds to start in tests and the suite is slow. What do you do?
**Short answer:** share and cache contexts, trim the context, and move logic into unit tests.
**Reasoning and implementation:** Spring caches contexts by configuration, so use one base class and avoid per-class property tweaks (each variation is a new context - the project deliberately has separate contexts only for the rate-limit and PostgreSQL variants); disable unnecessary auto-configuration; lazy initialisation for tests; slice tests (`@WebMvcTest`, `@DataJpaTest`) for focused cases; push rule coverage into pure unit tests.
**Alternatives and trade-offs:** `@DirtiesContext` (avoid), parallel test execution (needs isolation).
**Risks and pitfalls:** hidden shared state between tests when sharing contexts (here every test creates its own accounts).
**Likely follow-ups:** "when is a new context justified?"
**In this project:** `AbstractIntegrationTest` design; documented in the integration guidance.

### Q108. What would you check in a pull request that changes the CI pipeline itself?
**Short answer:** that security gates are not weakened, permissions are not widened, secrets are not exposed, and the change is reversible.
**Reasoning and implementation:** diff of `permissions`, new third-party actions (pin by SHA, provenance), changes to `if:` conditions (do gates still run on PRs?), secret usage (never echoed, not available to untrusted forks), thresholds (CVSS cut-off), caching keys, environment protection; run the workflow on a branch first.
**Alternatives and trade-offs:** CODEOWNERS requiring security review for `.github/**`.
**Risks and pitfalls:** `pull_request_target` with untrusted code, long-lived tokens.
**Likely follow-ups:** "how do you secure forked-PR workflows?"
**In this project:** pipeline design notes in `ci.yml` and ADR-009.
