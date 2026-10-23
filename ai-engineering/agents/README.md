# Optional multi-agent task definitions

Four narrow roles with explicit inputs, outputs and stop conditions. They are **definitions you may give to an orchestrator or use as prompts for separate assistant sessions** -
this repository does not execute them and makes no claim that any agent ran them. The rule that makes multi-agent work safe: *no agent merges its own work*; each hands off through
`ai-engineering/handoff-template.md`, and a human approves at the two marked gates.

```
spec (human) -> [implementation] -> handoff -> [testing] -> handoff -> [security-review] -> handoff -> [documentation] -> human PR review (GATE 2)
                       ^ GATE 1: human approves the technical design before any code is written
```

| Agent | Reads | Produces | Must never |
|---|---|---|---|
| implementation | spec, `copilot-instructions.md`, architecture/java/api/db context | small slices of code **after failing tests exist**, migration, DTOs | merge, add dependencies, edit released migrations, weaken security defaults, skip the tests |
| testing | spec acceptance criteria, unit/integration guidance | tests derived from the *criteria* (not the code), negative authorization tests, concurrency scenarios; mutation notes | assert on implementation details, write timing-dependent tests, claim an unrun result |
| security-review | diff, `security-review.md`, threat model | findings table (severity, location, exploit, fix, test), BOLA checklist result | approve its own fixes, downgrade a finding without evidence |
| documentation | diff, spec, ADR/runbook templates | OpenAPI regeneration note, ADR, runbook changes, release/rollback notes | invent behaviour that the code and tests do not show |

Each definition file below is self-contained so it can be pasted as a system prompt.
