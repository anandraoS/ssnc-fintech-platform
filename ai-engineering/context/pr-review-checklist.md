# Pull-request review checklist (human + assistant)

The full checklist is `docs/leadership/review-checklists.md`. Compact version for AI-assisted PRs:

1. I can explain every changed line without the assistant's help.
2. Tests were written first or alongside, they fail when the code is wrong, and I ran them (output pasted in the PR).
3. Money / locks / transactions / retries / authorization / idempotency reviewed against the ten critical rules.
4. A negative authorization test exists for every new endpoint (other customer -> 404, wrong role -> 403).
5. No new dependency, secret, PII in logs, or weakened security default.
6. Migrations additive; plan checked; previous version still works against the new schema.
7. OpenAPI regenerated and committed; ADR/runbook updated where needed.
8. The AI-involvement note is in the PR description.
