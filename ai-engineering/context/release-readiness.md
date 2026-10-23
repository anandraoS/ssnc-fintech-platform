# Release-readiness checklist

The authoritative checklist, with the release and rollback plan, is `docs/operations/rollback-and-release.md`. In one screen:

1. CI green on the release commit (unit, integration incl. real PostgreSQL, frontend, SpotBugs, CodeQL, dependency and secret scans, config validation).
2. Contract regenerated; no unreviewed breaking change.
3. Migrations additive and rehearsed on production-sized data; previous app version compatible with the new schema.
4. Dashboards, alerts and runbooks cover the new behaviour; on-call and support briefed.
5. Deployed to test, smoke tests + E2E passed; same image promoted to production by manual approval.
6. Rollback triggers agreed (error rate, latency, any ledger-integrity violation, dead letters); `rollout undo` rehearsed.
7. Watch window of 30 minutes with named owners; post-release verification query set run (`/ops/ledger-integrity`, reconciliation count, backlog).
