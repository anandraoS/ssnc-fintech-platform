# Release planning, release-readiness checklist and rollback plan

## Release-readiness checklist

**Code and tests**
- [ ] CI is green on the release commit: unit, integration (incl. real PostgreSQL), frontend lint/tests/build, SpotBugs, CodeQL.
- [ ] `specs/openapi.json` regenerated and reviewed; any breaking change has a new version, not an edit of v1.
- [ ] No open critical/high vulnerabilities (Dependency-Check, npm audit, Trivy) without a documented, time-boxed exception.
- [ ] No secrets in the diff (gitleaks green).

**Data**
- [ ] Migrations are forward-only, additive (expand phase), reviewed by a second engineer, and tested against a copy of production-size data for lock duration (`CREATE INDEX CONCURRENTLY`, no table rewrites).
- [ ] The *previous* application version runs against the *new* schema (verified in the test environment).
- [ ] Backup/PITR verified recent; restore time known.

**Operations**
- [ ] Dashboards and alerts cover the new behaviour; new alerts have runbook sections.
- [ ] Capacity impact estimated; HPA/limits reviewed.
- [ ] Feature flags / configuration switches for risky behaviour exist and are documented.
- [ ] On-call briefed; support has the customer-facing change notes.

**Security**
- [ ] Threat-model delta reviewed; new endpoints have role and object-level rules and tests (BOLA test added).
- [ ] Logging reviewed for PII.

**Rollout**
- [ ] Deployed to test; smoke tests passed; end-to-end (API + browser) suites passed against test.
- [ ] Rollout window avoids month-end/peak; owner and rollback decision-maker named.

## Release plan (for a typical change)

1. Merge to `main` -> pipeline builds and scans images (`1.0.<run>`), deploys to **test**, runs smoke tests.
2. Manual approval on the `production` environment promotes the **same image** (no rebuild).
3. Rolling update (`maxUnavailable 0`): new pods become ready (readiness), old pods drain (`preStop` + graceful shutdown).
4. Watch for 30 minutes: error rate, p95, outbox backlog, reconciliation count, ledger integrity, business KPIs.
5. Announce completion; keep the previous ReplicaSet for fast rollback; run the post-release checks.

## Rollback plan

| Situation | Action | Time | Data impact |
|---|---|---|---|
| Bad application release, schema compatible | `kubectl rollout undo deployment/platform-service` (or Argo CD revert) | ~1-2 min | none; outbox and in-flight work continue |
| Bad configuration | revert the ConfigMap/overlay, restart | ~2 min | none |
| Risky behaviour only | switch it off with the feature flag/config (e.g. `app.processing.dispatcher-enabled=false` to pause processing while keeping intake) | seconds | submissions queue in the outbox |
| Migration caused a problem | **do not roll the schema back by default**: ship a forward fix; the previous app version still works (expand/contract) | - | - |
| Data corruption (last resort) | point-in-time recovery to a new instance, replay/repair from the audit trail and ledger, reconcile before switching traffic | hours | requires an incident commander |

**Triggers** (decide in advance): error rate > 5 % for 5 min, p95 > 3x baseline for 10 min, any ledger-integrity violation, any dead-lettered event caused by the release.
Money safety is why rollback is rarely scary here: a transaction is either fully applied or not applied; unknown outcomes are held, not lost.
