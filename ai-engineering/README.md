# AI-assisted engineering workspace

A practical, tool-agnostic setup for working with GitHub Copilot (or any coding assistant) **without lowering the quality bar**.
It is a set of *files an assistant can read*, a *workflow* that keeps a human accountable, and *review recipes* for the specific ways AI-generated code goes wrong in a financial system.

> **Honesty note.** Nothing in this workspace was produced by an autonomous multi-agent run. The files are written artefacts (instructions, prompts, checklists, agent *definitions*, templates).
> The agent definitions are optional task descriptions; no claim is made that any agent executed them. The only "AI execution" claim that can be made about this repository is that an AI assistant helped author it, and its output was verified by the build, the test suites and the live runs documented in `docs/validation/validation-report.md`.

## Layout

```
.github/copilot-instructions.md        always-on, SHORT: the ten critical rules + commands
.github/instructions/*.instructions.md path-scoped rules (applyTo): java, angular, migrations, tests
.github/prompts/*.prompt.md            reusable prompts: spec-driven feature, review-ai-code
ai-engineering/
  context/            modular reference files (loaded on demand, not pasted into every prompt)
    architecture-context.md  java-standards.md  angular-standards.md  api-rules.md  db-migration-guide.md
    security-review.md  unit-test-guidance.md  integration-test-guidance.md  performance-checklist.md
    pr-review-checklist.md  definition-of-done.md  release-readiness.md
  agents/             optional multi-agent task definitions: implementation, testing, security-review, documentation
  handoff-template.md         structured hand-off between agents/people
  review-examples.md          how to review AI output: races, authz, money, retries, tests (bad -> good)
  workflow-example.md         the account-transfer spec walked through the 11 steps
specs/001-account-transfer.md  the concrete specification-driven example
```

## Context engineering: small always-on file, modular on-demand files

Repeating the whole architecture in every prompt wastes context and dilutes the rules that matter. The design:
* **Tier 1 (always loaded, ~35 lines):** the ten rules whose violation costs money or data - `copilot-instructions.md`.
* **Tier 2 (loaded by file pattern):** `.github/instructions/*.instructions.md` with `applyTo`, 5-8 lines each, pointing at tier 3.
* **Tier 3 (loaded when the task needs it):** `ai-engineering/context/*.md`, referenced by name in prompts (`@workspace read ai-engineering/context/security-review.md`).
* **Tier 4 (the source of truth):** ADRs, the spec, the code and the tests - the assistant is told to *read the code*, not to trust prose that may have drifted.

Each fact lives in exactly one place; other files link to it.

## The workflow (specification-driven, human in the loop)

1. **Requirements analysis** - the human writes or approves the spec; the assistant restates it and lists open questions.
2. **Acceptance criteria** - Given/When/Then including negative, security and concurrency cases.
3. **Technical design** - classes, transaction boundaries, lock order, failure handling; the human approves *before* code.
4. **API contract** - OpenAPI-visible DTOs, status codes, compatibility check.
5. **Data-model changes** - additive migration plan (expand/contract).
6. **Implementation** - small slices, tests first; assistant output is a *draft*.
7. **Test generation** - from criteria, not from the implementation; mutation thinking ("would this fail if the code were wrong?").
8. **Security review** - `context/security-review.md` (+ the `review-ai-code` prompt).
9. **Performance review** - `context/performance-checklist.md`.
10. **Documentation** - contract, ADR, runbook.
11. **Release planning** - readiness checklist, rollback plan.
A human reviews every line before merge (`context/pr-review-checklist.md`); the Definition of Done is explicit (`context/definition-of-done.md`).

## Guardrails when using an assistant

* Never paste secrets, real customer data or production dumps into a prompt; use the synthetic seed data.
* Treat suggestions as untrusted input: review them like a pull request from a stranger; run the tests; read the diff.
* Prefer asking the assistant to *explain a failing test* or *propose test cases* over generating large implementations unseen.
* Dependency suggestions need justification (licence, maintenance, CVEs) and an ADR; the assistant may not add libraries on its own.
* Safe dependency upgrades: one dependency at a time, read the changelog, run the full suite, check the Dependency-Check delta, and prefer the Boot BOM to manual versions.
* Record AI involvement in the PR description; the author remains accountable.

## What assistants are good and bad at here

| Good at | Needs close review |
|---|---|
| boilerplate (DTOs, mappers, specs), test scaffolding, refactoring with tests green, explaining unfamiliar code, drafting docs and runbooks | concurrency and locking, authorization boundaries, money arithmetic, retry/timeout design, migration safety, anything touching security configuration |
