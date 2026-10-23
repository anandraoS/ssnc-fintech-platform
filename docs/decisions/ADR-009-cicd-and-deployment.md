# ADR-009: GitHub Actions pipeline with security gates; container images promoted unchanged; Kubernetes rolling deployments

* **Status:** accepted

## Context
Releases must be frequent, reversible and safe, and a financial application must not ship known-vulnerable dependencies or leaked secrets.

## Decision
One pipeline: build/unit -> integration (real PostgreSQL via Testcontainers) -> frontend lint/test/build -> SpotBugs + CodeQL -> OWASP Dependency-Check + `npm audit` + gitleaks -> config validation
-> image build -> Trivy scan -> versioned publish (`1.0.<run>`, `sha-<short>`) -> deploy to test with kustomize -> smoke tests -> automatic `rollout undo` on failure.
Build once, promote the *same* image; environment differences live in kustomize overlays/ConfigMaps. Rolling updates with `maxUnavailable: 0`, readiness gating, `preStop` + graceful shutdown.
Database changes follow expand/contract so the previous release always works against the new schema (application rollback never needs a schema rollback).

## Alternatives
Jenkins (more control, more to run); GitLab CI (equivalent); blue/green or canary with a service mesh/Argo Rollouts (stronger, heavier - noted as the next step for high-risk releases);
deploying with Helm (templating power vs. plain-YAML readability).

## Consequences
+ gates are automated and visible; a failed smoke test self-heals; no per-environment rebuilds;
- the workflow cannot be fully validated without a runner (documented honestly); pin third-party actions by SHA before production use;
- expand/contract needs discipline and an extra release for destructive changes.
