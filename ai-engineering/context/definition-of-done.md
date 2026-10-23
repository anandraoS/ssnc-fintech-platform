# Definition of Done

A change is **done** only when all of the following are true:

- [ ] Acceptance criteria are met and each has an automated test (unit / integration / E2E as appropriate).
- [ ] Negative paths covered: validation, authorization (role *and* object-level), conflict, failure, concurrency where interleavings matter.
- [ ] Invariants asserted after money-moving tests (ledger integrity, nothing half-applied, audit written).
- [ ] `mvn -f backend/pom.xml verify` and the frontend lint/test/build are green **on the committed code**; the results are recorded, not assumed.
- [ ] Static analysis and dependency/secret scans have no new findings above the agreed threshold.
- [ ] API contract regenerated and committed; backward compatibility checked.
- [ ] Migrations additive, verified on PostgreSQL, rollback considered.
- [ ] Logging reviewed (no PII/tokens), metrics/alerts/runbook updated for operationally relevant behaviour.
- [ ] Documentation updated: spec/ADR/runbook/README as needed.
- [ ] Peer-reviewed by a human; security checklist applied; AI involvement disclosed.
- [ ] Deployable to the test environment through the pipeline with smoke tests passing; rollback path known.
