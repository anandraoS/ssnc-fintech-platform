---
mode: agent
description: Implement a feature from a written spec (specification-driven development)
---
You are implementing the feature described in the spec file I attach (see `specs/001-account-transfer.md` for the expected structure).

Work in this order and stop after each step for a short summary of what you did and what you verified:
1. **Restate** the requirements, assumptions and open questions. Do not invent requirements; list questions instead.
2. **Acceptance criteria**: confirm each is testable; propose missing negative/security/concurrency criteria.
3. **Design**: files/classes to touch, transaction boundaries, locks and their order, failure handling, API contract, data-model change (migration plan, expand/contract).
4. **Tests first**: write failing tests (unit, integration, authorization negative tests, concurrency if interleavings matter). Show them failing for the right reason.
5. **Implement** the smallest change that passes. Respect `.github/copilot-instructions.md` (critical rules) and the path-specific instructions.
6. **Security review** using `ai-engineering/context/security-review.md`; **performance review** using `ai-engineering/context/performance-checklist.md`; list findings and fixes.
7. **Run** the relevant build and tests and report the *actual* results. If something could not be run, say so explicitly. Never claim a pass you did not observe.
8. **Docs and release**: update the OpenAPI contract, runbook/ADR if needed, release/rollback notes.
Output a handoff note using `ai-engineering/handoff-template.md`.
