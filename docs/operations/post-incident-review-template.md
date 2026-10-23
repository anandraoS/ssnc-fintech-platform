# Post-incident review (blameless)

| Field | |
|---|---|
| Incident id / title | |
| Date, start, detection, mitigation, resolution (UTC) | |
| Severity | SEV1 / SEV2 / SEV3 |
| Incident commander / scribe / responders | |
| Customer impact (who, how many, what, how long) | |
| Money impact (any ledger-integrity violation? any manual correction? amounts, accounts) | |

## Summary
Two or three sentences a non-engineer can read.

## Timeline
| Time | Event | Source (alert, dashboard, log, person) |
|---|---|---|

## Detection
How was it detected? Was it an alert or a customer? **Time to detect**: . Could we have detected it earlier (missing alert, noisy alert, wrong threshold)?

## Root cause and contributing factors
Use "5 whys"; separate the *trigger* (what happened) from the *conditions* (why it was possible). No names, no blame - systems and decisions.

## What went well / what went badly / where we got lucky

## Resolution and recovery
What stopped the bleeding? What was restored when? Which data had to be repaired and how was it verified (ledger-integrity check, reconciliation, audit trail)?

## Action items
| # | Action | Type (prevent / detect / mitigate / process) | Owner | Due | Ticket |
|---|---|---|---|---|---|
| 1 | | | | | |

Every action has an owner and a date; at least one is a **regression test or alert** so this exact failure cannot recur silently.

## Lessons for the playbook
What should the runbook say next time? Which runbook sections changed?

## Appendix
Graphs, queries, log excerpts (with correlation ids), related incidents.
