# DevOps, cloud and security reference

## Docker

Image = layered filesystem + metadata; container = isolated process (namespaces, cgroups). Good Dockerfiles: multi-stage (build vs runtime), pinned base tags (ideally digests), dependency layer before source (cache), **non-root** user, minimal runtime (JRE, not JDK), `HEALTHCHECK`, no secrets in layers, `.dockerignore`, `STOPSIGNAL`/graceful shutdown, JVM container awareness (`MaxRAMPercentage`). Compose: local multi-service stacks, networks, health-gated `depends_on`, `read_only`/`cap_drop` hardening, secrets via env/files, named volumes.

## Kubernetes

Pod (one or more containers), Deployment (ReplicaSet, rolling update), Service (stable virtual IP), Ingress (HTTP routing/TLS), ConfigMap/Secret, HPA (autoscaling on metrics), PDB (voluntary-disruption budget), NetworkPolicy (default deny), requests/limits (scheduling vs ceiling), probes (startup/liveness/readiness), `preStop` + `terminationGracePeriodSeconds`, topology spread, namespaces + pod security standards, RBAC, service accounts.
* **Rolling update** maths: `maxUnavailable: 0, maxSurge: 1` keeps capacity; readiness gates traffic; failed rollout -> `rollout undo`.
* **Probes:** liveness restarts a stuck process (do not tie it to dependencies); readiness removes a pod from load balancing (can include dependencies); startup protects slow starters.
* **JVM resources:** memory limit = non-negotiable (OOMKill); CPU **limits** cause throttling latency (prefer requests only); set `-XX:MaxRAMPercentage`.
* **Secrets:** base64 is not encryption - use External Secrets/CSI + KMS-encrypted etcd; RBAC to limit reads.

## CI/CD

Pipeline stages and gates (see the CI/CD chapter); **trunk-based development**, short-lived branches, PR checks; *build once, promote the same artefact*; environment config outside the artefact; versioning (semver + build metadata); deployment strategies: rolling, blue/green, canary, feature flags; **database migrations** in the pipeline with expand/contract; smoke tests; automated rollback; pipeline security (least-privilege tokens, pinned actions, OIDC federation, protected environments, signed artefacts/SBOM, provenance - SLSA).
**Security gates:** SAST (CodeQL/SpotBugs), SCA (Dependency-Check, `npm audit`, Dependabot), secrets scanning, container scanning (Trivy), IaC scanning, DAST against a deployed test environment.

## Cloud architecture (AWS flavour)

Region/AZ design (>= 2-3 AZs), VPC with public/private/data subnets, ALB + WAF + CloudFront, EKS or ECS, RDS Multi-AZ with PITR and KMS encryption, Secrets Manager/Parameter Store, IAM least privilege + IRSA, ECR, CloudWatch/X-Ray (or Prometheus/Grafana/Tempo), autoscaling, backups and DR (RPO/RTO, pilot light/warm standby/active-active), cost awareness (right-sizing, Savings Plans, S3 lifecycle), infrastructure as code (Terraform/CDK).
**Rollback:** application = redeploy previous image; data = forward-fix migrations, PITR as last resort.

## OAuth 2.0 and OpenID Connect

*Analogy:* OAuth is a valet key: it lets an app act for you with limited rights without handing over your master key; OIDC adds an ID card (who you are).
* Roles: resource owner, client, authorization server, resource server. **Flows:** authorization code **with PKCE** (browser/mobile - the default today), client credentials (service-to-service), device code; implicit and password grants are obsolete.
* **Tokens:** access token (short-lived, for the API), refresh token (rotate, store safely), ID token (OIDC, proves authentication to the client). Scopes/claims/roles; audience restriction; `iss` and `aud` checks; token revocation/introspection (opaque tokens).
* **Browser apps:** authorization code + PKCE; a backend-for-frontend with HttpOnly, SameSite cookies is the safest pattern; never put tokens in `localStorage` if you can avoid it.

## JWT validation

Structure: header.payload.signature (base64url). Validate: **signature** with the issuer's key (`kid` -> JWKS), **algorithm allow-list** (reject `none`, never let the token choose HS vs RS), `exp`, `nbf`, `iss`, `aud`, clock skew; then map claims to authorities. JWTs are *signed, not encrypted* (do not put secrets in them); revocation is hard (short TTL + refresh rotation); keys rotate (cache JWKS, refetch on unknown `kid`).
Pitfalls: accepting tokens from any issuer, trusting `roles` from an unsigned source, long-lived tokens, storing in web storage, logging tokens.

## OWASP

OWASP Top 10 (2021) and API Security Top 10 (2023) mapped to this project in the security docs: broken (object-level) access control, cryptographic failures, injection, insecure design, misconfiguration, vulnerable components, authentication failures, integrity failures, logging/monitoring failures, SSRF; API-specific: BOLA, broken auth, object-property exposure, unrestricted resource consumption, function-level authorization, sensitive business flows, unsafe API consumption.
**Secure SDLC:** threat modelling (STRIDE), secure defaults, code review with a security checklist, SAST/SCA/DAST, dependency management, secrets management, least privilege, defence in depth, incident response.

## Secrets management

Never in code/config/images; secret manager (AWS Secrets Manager, Vault) -> injected at runtime (env/files/CSI); rotation without downtime; separate per environment; least-privilege access; audit access; scan for leaks; treat a leak as "rotate first". See the secrets chapter.

## Monitoring, logging, tracing

Metrics (Prometheus; RED for services, USE for resources), logs (structured JSON, correlation ids, no PII), traces (OpenTelemetry, sampling), alerts on symptoms with runbooks, SLOs and error budgets, dashboards per audience. *Cardinality* warning: never put unbounded values (user ids, raw URIs) in metric labels.

## Performance troubleshooting

The investigation flow in the operations chapter: symptom -> saturated resource -> responsible code/query -> fix -> re-measure. Tools: Prometheus/Grafana, traces, `jcmd`/JFR/async-profiler, `pg_stat_statements`, `EXPLAIN ANALYZE`, `pg_stat_activity`, thread and heap dumps, load tests (k6) with realistic arrival rates.
