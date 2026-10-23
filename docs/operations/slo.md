# Service level objectives (illustrative starting points)

These are **targets to be validated against measurements**, not results. They show how SLOs, SLIs, error budgets and alerts fit together.

| SLI | Definition (PromQL basis) | SLO (30 days) | Alert |
|---|---|---|---|
| Availability | non-5xx / all requests, excluding `/actuator` | 99.9 % (43 min error budget) | `HighServerErrorRate` (fast burn) |
| Read latency | p95 of GET requests < 300 ms | 99 % of 5-minute windows | `HighApiLatencyP95` |
| Submission latency | p95 of `POST /transactions` (acknowledge, not completion) < 500 ms | 99 % | `HighApiLatencyP95` |
| Processing latency | p95 of `platform_transactions_end_to_end_seconds` < 5 s for deposits/transfers | 99 % | dashboard + ticket |
| Correctness | `ledger-integrity` violations | **0, always** (not an error budget item - a violation is an incident) | page on any non-empty result |
| Reconciliation hygiene | no OPEN reconciliation record older than 15 minutes | 99 % | `ReconciliationBacklog` |
| Dead letters | none | 0 | `OutboxDeadLetters` |

Error-budget policy: when the monthly budget is spent, feature releases pause and the next sprint is reliability work (the post-incident reviews feed the backlog).
Burn-rate alerts (2 % of the budget in 1 hour = page; 5 % in 6 hours = ticket) are preferred to raw thresholds once real traffic baselines exist.
