# AI-assisted development reference

## GitHub Copilot workflows

* **Inline completion:** best for boilerplate and well-known patterns; poor for security- and concurrency-sensitive logic. Accept suggestions only after reading them like a pull request from a stranger.
* **Chat/Agent mode:** ask for *explanations*, *test ideas*, *refactor proposals* and *drafts*; keep tasks small; give it the spec and the relevant files; insist on tests first; run the tests yourself.
* **Repository instructions:** `.github/copilot-instructions.md` (always-on), path-scoped `.github/instructions/*.instructions.md` (`applyTo`), reusable `.github/prompts/*.prompt.md`. Short, high-signal, version-controlled, reviewed like code.
* **Pull-request assistance:** summaries and review suggestions are *inputs*, not approvals.

## Specification-driven development

Write the spec first (requirements, acceptance criteria, design, API contract, test plan, security/performance notes), let the human approve the design (gate), then implement in small slices with tests; the spec outlives the chat session and is the contract reviewers compare the diff against.
(See `specs/001-account-transfer.md` and `ai-engineering/workflow-example.md`.) Benefits: fewer misunderstandings, reviewable intent, better tests (derived from criteria rather than code), reproducibility across tools.

## Context engineering

*Analogy:* give the assistant a small, accurate briefing pack rather than the whole library.
* Tiering: always-on rules (10 lines that cost money if broken) -> path-scoped rules -> on-demand reference files -> source of truth (code, ADRs, tests). Each fact lives in one place; link, do not copy.
* Make instructions **testable** ("money is BigDecimal compared with compareTo" is checkable; "write clean code" is not). Prune when a rule has not prevented a defect in months.
* Give examples of good and bad code from the repository (`review-examples.md`). Prefer pointing at real files over describing them.

## Reusable instructions and handoff

Templates for prompts and handoffs reduce variance: the handoff note records what changed, evidence (real output), invariants checked, risks and what not to touch. Optional multi-agent roles (implementation, testing, security review, documentation) are *definitions*; humans own the two gates (design approval, final review).

## Reviewing AI-generated code

Five recurrent failure patterns: **races/atomicity**, **missing authorization**, **incorrect money maths**, **unsafe retries/external calls**, **inadequate tests** - each with a bad-to-good example in `ai-engineering/review-examples.md`. Review method: ask "what if it runs twice, concurrently, or dies halfway?", "whose data is this?", "what are the units and rounding?", "what does a timeout mean?", "would this test fail if the code were wrong?" - and run the tests.
Other risks: hallucinated APIs/dependencies (check they exist), licence-tainted snippets, subtly outdated idioms, confident but wrong explanations, secrets pasted into prompts, over-engineering.

## Test generation

Generate from acceptance criteria and boundaries, not from the implementation; ask for negative, authorization and concurrency cases; use mutation thinking (delete a line, the test must fail); reject tests that only restate the implementation, over-mock, or sleep. Keep human ownership of what "correct" means.

## Refactoring with assistants

Refactor only under green tests; small steps; ask for a plan first, then apply one step at a time; verify behaviour with characterisation tests for legacy code; use the IDE's automated refactorings where possible (safer than generated rewrites); keep diffs reviewable.

## Safe dependency upgrades

One dependency (or one BOM) at a time; read release notes/migration guides; let the Boot BOM manage versions; run the full test suite including integration and PostgreSQL tests; compare Dependency-Check results before/after; watch for transitive changes (`mvn dependency:tree`); canary in the test environment; automate with Dependabot/Renovate PRs that go through the same gates. An assistant can summarise changelogs and propose code changes, but the green pipeline - not the assistant - decides.

## Guardrails (organisation level)

No secrets or customer data in prompts; approved tools and tenants only; disclose AI involvement in PRs; the author remains accountable; security-sensitive areas require a second human reviewer; track defects traced to AI output and feed them back into instructions and checklists; train the team on failure patterns.
