# Questions: AI-assisted development and technical leadership

### Q119. [Scenario] How would you use GitHub Copilot without compromising code quality?
**Short answer:** treat it as a fast junior pair: give it precise context, work in small slices with tests first, review every line like a stranger's pull request, and let the pipeline - not the assistant - decide what is done.
**Reasoning and implementation:** short always-on repository instructions with the critical rules (money, locks, authorization, retries), path-scoped rules, reusable prompts; specification-driven slices (spec -> failing tests -> minimal implementation); use it most for boilerplate, test scaffolding, explanations and refactors under green tests; require human review with a checklist targeting AI failure patterns (races, missing authorization, money errors, unsafe retries, weak tests); never paste secrets or customer data; disclose AI involvement in PRs; keep the Definition of Done (recorded test runs, scans) unchanged.
**Alternatives and trade-offs:** banning assistants (loses productivity), unrestricted use (quality and security risk).
**Risks and pitfalls:** automation bias (trusting plausible code), hallucinated APIs/dependencies, licence issues, over-engineering, skills atrophy.
**Likely follow-ups:** "what would you never delegate?" (design decisions on invariants and security boundaries).
**In this project:** `.github/copilot-instructions.md`, `ai-engineering/`, `review-examples.md`.

### Q120. [Scenario] How would you mentor a junior developer whose code passes unit tests but fails under concurrent load?
**Short answer:** make the failure visible and reproducible, teach the mental model (interleavings, atomicity, isolation), explore the option space together, fix test-first, and generalise into habits.
**Reasoning and implementation:** (1) have them run two parallel requests and observe the wrong balance - experience beats explanation; (2) whiteboard the timelines and name the anomaly (lost update); (3) compare fixes: row lock, atomic conditional update, optimistic version + retry, serialisable - with trade-offs; (4) write the concurrency test first on the real database, watch it fail, fix, watch it pass; (5) add "what if this runs twice/concurrently/halfway?" to their checklist and the PR template; (6) pair on the next lock-sensitive task, then have them review someone else's.
**Alternatives and trade-offs:** giving the answer immediately (fast but shallow), reading material only.
**Risks and pitfalls:** blame, overload (one lesson at a time), fixing it for them.
**Likely follow-ups:** "how do you know it landed?" (their next PR).
**In this project:** `docs/leadership/mentoring.md`, `ConcurrencyScenarios`, mutation check of removing the lock.

### Q121. What is specification-driven development and how does it work with AI assistants?
**Short answer:** write the specification (requirements, acceptance criteria, design, API, tests) first; implementation - by a human or an assistant - is then checked against it.
**Reasoning and implementation:** the spec is reviewed before code (design gate), tests are derived from criteria, the assistant implements small slices, reviews compare the diff to the spec, and the spec stays in the repository as living documentation. It reduces misunderstandings, makes assistant output reviewable and avoids the "chat history as requirements" problem.
**Alternatives and trade-offs:** ad-hoc prompting (fast, unreviewable), heavy up-front design (slow).
**Risks and pitfalls:** specs that rot; over-specifying; treating the spec as immutable.
**Likely follow-ups:** "what belongs in a spec?"
**In this project:** `specs/001-account-transfer.md`, `workflow-example.md`.

### Q122. What is context engineering for coding assistants?
**Short answer:** designing the information the assistant sees - small, accurate, tiered and testable - so it follows the rules that matter.
**Reasoning and implementation:** tier 1 always-on rules (the ten critical ones), tier 2 path-scoped instructions, tier 3 on-demand reference files, tier 4 the source of truth (code, ADRs, tests); each fact lives once; rules are checkable; examples come from the repository; prune rules that never prevent defects; version and review them like code.
**Alternatives and trade-offs:** one giant instruction file (diluted attention, stale), none (inconsistent output).
**Risks and pitfalls:** prose drifting from code; secrets in instructions.
**Likely follow-ups:** "how do you measure whether instructions help?" (defect trends, review findings).
**In this project:** `ai-engineering/README.md` design section.

### Q123. How do you review AI-generated code for race conditions?
**Short answer:** ask "what if this runs twice, concurrently, or dies halfway?" for every state change, and demand a test that interleaves.
**Reasoning and implementation:** look for read-modify-write without a lock/version/constraint, check-then-act, two writes that must commit together, locks in inconsistent order, work inside a lock, shared mutable state in singletons; demand a latch-based concurrency test asserting final invariants, preferably on the real database; apply a mutation check.
**Alternatives and trade-offs:** static analysis helps little here; property-based concurrent testing (jcstress) for in-JVM races.
**Risks and pitfalls:** unit tests with mocks that cannot interleave.
**Likely follow-ups:** "show me an example."
**In this project:** `review-examples.md` pattern 1, `ConcurrencyScenarios`.

### Q124. How do you review AI-generated code for missing authorization?
**Short answer:** for each new endpoint or query ask "who can call this, and on whose data?" and require negative tests for a different customer and a different role.
**Reasoning and implementation:** authentication being enabled globally gives false comfort; look for ids taken from the path/body without ownership checks, lists without scope, entities returned directly, filters that can be widened; require a role rule and an object-level rule; expect 404 for foreign objects and an audit event.
**Alternatives and trade-offs:** centralise policies (one `AccessPolicy`) so assistants reuse them.
**Risks and pitfalls:** only testing with an admin token.
**Likely follow-ups:** "how do you automate this?" (a test helper that iterates endpoints with a second user).
**In this project:** `SecurityIT`, `review-examples.md` pattern 2.

### Q125. How do you review AI-generated code for incorrect monetary calculations?
**Short answer:** grep for `double/float/doubleValue`, check `BigDecimal` comparisons and scale, rounding policy and string handling at boundaries.
**Reasoning and implementation:** `valueOf(double)` and `new BigDecimal(double)` bake in binary error; `equals` vs `compareTo`; implicit rounding of input; JSON numbers; percentages and allocations losing cents; tests with 0.1/0.2, ties (half-even), scale differences.
**Alternatives and trade-offs:** `long` minor units, a `Money` value type.
**Risks and pitfalls:** formatting for display used as a computation.
**Likely follow-ups:** "how do you test rounding?"
**In this project:** `MoneyPolicy`, `MoneyPolicyTest`, ADR-010.

### Q126. How do you review AI-generated retry and timeout code?
**Short answer:** confirm idempotency, backoff with jitter, caps, timeouts, and honest classification of unknown outcomes.
**Reasoning and implementation:** is the operation safe to repeat (keyed by a stable id)? exponential backoff with full jitter? bounded attempts and total time? per-attempt timeout? circuit breaker? what is reported after exhaustion - *unknown* not *failed*? tests that simulate 503s, timeouts and dropped connections against a real HTTP server.
**Alternatives and trade-offs:** libraries (Resilience4j/Spring Retry) vs small hand-written executors.
**Risks and pitfalls:** annotation-based retries on non-idempotent methods; nested retries across layers.
**Likely follow-ups:** "what is a retry storm?"
**In this project:** `RetryExecutor`, `RestClearingClientTest`, `review-examples.md` pattern 4.

### Q127. [Scenario] An assistant proposes adding Kafka "for reliability". How do you respond?
**Short answer:** ask what problem it solves that the current design does not, quantify the cost, and decide with an ADR.
**Reasoning and implementation:** the transactional outbox already provides atomic hand-off and retry; a broker adds an operational system, failure modes and dual-write risks; it becomes justified with multiple independent consumers, replay needs, cross-service fan-out or throughput beyond a polled table - then publish the outbox to Kafka via a relay without changing producers.
**Alternatives and trade-offs:** RabbitMQ (simpler routing), CDC with Debezium.
**Risks and pitfalls:** resume-driven design; assistants favour popular stacks regardless of need.
**Likely follow-ups:** "what would change your mind?"
**In this project:** ADR-006 (no broker/Redis yet, with triggers for adding one).

### Q128. How do you upgrade dependencies safely, with or without AI help?
**Short answer:** one change at a time, through the full pipeline, using the BOM, with release-note review and a scan comparison.
**Reasoning and implementation:** Dependabot/Renovate PRs, Boot BOM for aligned versions, read changelogs/migration guides, run unit + integration (incl. PostgreSQL) + E2E, compare Dependency-Check/Trivy results, canary in test, keep upgrades small and frequent; an assistant can summarise notes and propose code changes but the green pipeline decides.
**Alternatives and trade-offs:** scheduled batch upgrades, pinning and ignoring (security debt).
**Risks and pitfalls:** transitive surprises, major-version jumps, ignoring licence changes.
**Likely follow-ups:** "how do you handle a breaking Spring Boot major?"
**In this project:** pinned versions, CI gates, ADR-009.

### Q129. [Scenario] How do you run an architecture decision for a contested choice (e.g. optimistic vs pessimistic locking) within a team?
**Short answer:** write the problem and constraints, list options with measurable criteria, prototype/measure the risky ones, decide with the people accountable, record it as an ADR and revisit on stated triggers.
**Reasoning and implementation:** define forces (contention, latency, correctness cost), create a spike with the concurrency tests on the real database, compare results, capture the decision and consequences (including what would make us change it), publish in the repo, and make tests encode the decision.
**Alternatives and trade-offs:** decision by seniority (fast, brittle), consensus forever (slow).
**Risks and pitfalls:** ADRs written after the fact; decisions without owners.
**Likely follow-ups:** "how do you handle disagreement?" (disagree and commit, with a review date).
**In this project:** ADR-005 with the alternatives table.

### Q130. What belongs in a production runbook and who writes it?
**Short answer:** symptoms, impact, first checks, diagnosis steps, mitigations, escalation, verification and links to dashboards/queries - written by the people who build the feature, reviewed by those on call.
**Reasoning and implementation:** every alert links to a runbook section (enforced by a validation check), steps are copy-pasteable, they state the *safe default* and what not to do (e.g. do not restart to reset the breaker), include "how to verify recovery", and are updated after every incident.
**Alternatives and trade-offs:** automated remediation (when safe).
**Risks and pitfalls:** stale runbooks, steps requiring tribal knowledge.
**Likely follow-ups:** "how do you test a runbook?" (game days).
**In this project:** `runbooks.md`, alert-to-runbook check in `validate-infra.py`.

### Q131. [Scenario] During an incident you find the root cause was a change you merged last week. How do you handle it?
**Short answer:** own it, mitigate first, communicate clearly, then run a blameless review focused on how the system allowed it.
**Reasoning and implementation:** roll back or disable the change, state facts and impact without speculation, preserve evidence (logs, correlation ids), after resolution write the review: timeline, contributing factors (missing test, review gap, alert gap), concrete actions with owners and dates including at least one regression test or alert; share learnings.
**Alternatives and trade-offs:** none that include hiding it.
**Risks and pitfalls:** defensiveness; fixing without understanding; no follow-through on actions.
**Likely follow-ups:** "what did you change in the process?"
**In this project:** `post-incident-review-template.md`.

### Q132. How do you balance delivery speed with engineering rigour as a technical lead?
**Short answer:** make the safe path the easy path - automation, small batches, clear Definition of Done - and spend rigour where the risk is.
**Reasoning and implementation:** risk-tier changes (money/security paths get design review, concurrency tests, second reviewer; copy changes do not); automate gates so rigour costs minutes; keep PRs small; use feature flags; track DORA metrics and incident learnings; protect time for reliability work through error budgets.
**Alternatives and trade-offs:** uniform heavy process (slows everything), no process (incidents).
**Risks and pitfalls:** hero culture, skipping tests "just this once".
**Likely follow-ups:** "how do you say no to a deadline?" (present options with risks, not refusals).
**In this project:** Definition of Done, release checklist, risk register.

### Q133. [Scenario] A stakeholder asks you to "just add exactly-once delivery". How do you respond?
**Short answer:** explain what is and is not achievable, and offer effectively-once effects with idempotency, plus reconciliation for what we cannot control.
**Reasoning and implementation:** exactly-once is impossible across independent systems in the presence of failures; achievable: at-least-once delivery + idempotent consumers + unique constraints give *effectively-once* effects on our data; for external systems use idempotent requests and reconciliation; show the failure modes and the evidence (concurrency, chaos tests); agree on the SLA for resolving unknown outcomes.
**Alternatives and trade-offs:** transactional messaging within one broker (exactly-once semantics inside its boundary only).
**Risks and pitfalls:** overpromising; hiding unknown states.
**Likely follow-ups:** "what does Kafka's exactly-once cover?" (within Kafka transactions, not external side effects).
**In this project:** integrity chapter's callout, ADR-011.

### Q134. How do you document a system so that a new engineer is productive in a week?
**Short answer:** a runnable quick start, a short architecture story, ADRs for the "why", runbooks, and tests that read like specifications.
**Reasoning and implementation:** README with one-command setup and verification; architecture overview and diagrams generated from text; module tour mapping concepts to classes; ADRs; API examples captured from the running system; threat model and runbooks; "how to run the tests" and "how to debug" notes; keep each fact in one place; generate what can be generated (OpenAPI, examples) so it cannot lie; onboarding buddy.
**Alternatives and trade-offs:** wiki-only docs (drift), no docs (tribal knowledge).
**Risks and pitfalls:** diagrams only in someone's drawing tool; outdated screenshots.
**Likely follow-ups:** "how do you keep docs current?" (docs in the repo, reviewed with code, validated in CI).
**In this project:** `README.md`, `docs/`, both PDFs generated from the same sources.
