# Handoff note (agent -> agent, or agent -> human)

| Field | Value |
|---|---|
| From / to | |
| Spec / ticket | `specs/NNN-...` / #id |
| Slice | one-sentence description |
| Branch / commit | |

## What was done
- files changed and why (bullet per file)
- design decisions taken (and alternatives rejected)

## Evidence (paste real output, do not summarise from memory)
- red test output before the change:
- test commands run and their results (counts):
- commands **not** run and why:

## Invariants checked
- [ ] balance never negative / ledger == balance (`/ops/ledger-integrity` or `assertLedgerIntegrity()`)
- [ ] authorization: role + object-level, negative tests present
- [ ] idempotency / retries / transaction boundaries unchanged or reviewed

## Risks, assumptions, open questions
-

## Next step for the receiver
-

## Do not touch
- released migrations, security defaults, anything outside this slice
