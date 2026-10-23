# Known limitations and future enhancements

## What was executed, what was not (summary; details in the validation report)

| Area | Status |
|---|---|
| Backend compile, unit tests, integration tests (H2) | **executed** |
| Integration and concurrency tests on a real PostgreSQL (embedded PostgreSQL 14, no Docker) | **executed** |
| Angular lint, unit tests, production build | **executed** |
| React edition: type-check, lint, 90 unit/component tests, production build, browser end-to-end (19/19) | **executed** |
| Live API end-to-end (incl. simulator, chaos) and browser end-to-end | **executed** |
| Local load baseline (Node) | **executed** (developer machine; not a benchmark) |
| k6 scripts | written, **not executed** (k6 not installed) |
| Docker images, Docker Compose stack, Prometheus/Grafana/Jaeger | written, **not executed** (no Docker) - structure validated statically |
| Kubernetes manifests | written, **not applied to a cluster** - validated statically (and `kubeconform`/`hadolint` in CI) |
| GitHub Actions workflow | written, **not run on a runner** |
| Testcontainers PostgreSQL test | written, **skipped** locally (needs Docker) |
| Cloud deployment (AWS) | **conceptual** only |
| Oracle and MongoDB | **conceptual** only |
| Multi-agent AI definitions | **definitions only**, never executed |

## Functional limitations

* Single-customer transfers only; no fees, interest, FX conversion, scheduled/recurring transfers, statements, or settlement cycles.
* Withdrawals model *one* external step (a payout authorization); real flows have more (netting, settlement files, returns/chargebacks).
* The clearing-network contract (idempotent on `reference`, supports lookup) is an **assumption** that must be confirmed with a real provider; the simulator is deterministic, not realistic.
* No KYC/AML/sanctions screening, no regulatory reporting, no multi-tenancy across legal entities, no data-subject-request workflow.
* Four-eyes control applies to approvals and reconciliation only.

## Technical limitations

* **In-process outbox dispatcher:** polling, single worker loop per instance, in-database queue. Measured locally at ~34 transactions/s drain rate (dev machine); a real deployment needs parallel workers (`SKIP LOCKED`) or a broker relay.
* **Per-account serialisation** is inherent to the row-lock design; a hot "house" account needs a different structure (sharded sub-accounts or batching).
* **History query** uses `source = :id OR target = :id`; adequate with the current indexes (captured plans) but the scalable form is `UNION ALL`/participants table and keyset pagination.
* **Rate limiting** is per instance and in memory; production needs a shared store or gateway.
* **Local token issuer** (HS256, demo users) exists only for development and tests; the SPA keeps the token in memory so a reload requires sign-in.
* **Embedded PostgreSQL is version 14**; Compose/CI use 16. Behaviour relied on (row locks, partial indexes, triggers) is stable across both but only 14 was executed.
* H2 cannot express PostgreSQL's partial unique index; the single-open-reconciliation rule is therefore also guarded in code.
* No schema partitioning, no read replicas, no multi-region design, no encryption of individual PII fields.
* Dashboards and alert thresholds are illustrative; they have never seen production traffic. SLO numbers are targets, not measurements.
* The frontend has no i18n, no offline mode, no automated visual regression tests; browser E2E is a script, not a full Playwright suite.
* **Two frontends (Angular and React) mean every UI change is made twice.** The API types are hand-written copies in both projects (generate them from `specs/openapi.json` next); one shared browser suite keeps behaviour aligned. The React edition was tested in Edge only, has no server-state library (React Query), no SSR, and its Docker image and Compose profile were never built or run (no Docker).
* Several GitHub Actions are referenced by tag, not by commit SHA.

## Security limitations

Educational, synthetic implementation. Not penetration-tested; no formal threat-modelling workshop; no WAF/DDoS layer implemented; secrets management is specified (External Secrets, Secrets Manager) but not deployed;
no SIEM rules written; no key rotation procedure for data-encryption keys (there are none). See the residual-risk list in the threat model.

## Future enhancements (prioritised)

1. **Run the unexecuted pieces** where Docker/runners exist: Compose stack, Testcontainers on PostgreSQL 16, GitHub Actions, k6, kubeconform/hadolint, Grafana dashboards against real traffic.
2. Parallel outbox workers with `FOR UPDATE SKIP LOCKED`; optional relay to Kafka/RabbitMQ when a second consumer appears (ADR-006).
3. Participants table + keyset pagination for account history; table partitioning for `transactions`, `ledger_entries`, `audit_events`.
4. OIDC authorization-code + PKCE (or BFF with HttpOnly cookies) in the SPA; refresh-token rotation; MFA step-up for privileged roles.
5. Distributed rate limiting (Redis or gateway); abuse analytics on audit events.
6. Contract tests with the real clearing provider's sandbox; settlement-file reconciliation as a second detection net.
7. Canary / progressive delivery with automated analysis; SBOM + signed images + provenance (SLSA).
8. Property-based tests for money and state-machine invariants; PIT mutation testing in CI.
9. Playwright suite replacing the puppeteer script; accessibility audit (axe) in CI.
10. Fees, FX, scheduled transfers, statements - each as a spec in `specs/` following the same workflow.
