# Secrets management and environment-specific configuration

## Rules

1. **No secret is ever committed**: not in code, configuration, tests, examples, images or the SPA bundle. `.env.example` contains only `CHANGE_ME_*` placeholders; `.env` is git-ignored.
2. **Secrets arrive at runtime** from the platform's secret store, never from the image or the repository.
3. **Fail closed**: the application will not start without a token validator; compose will not start without the required secrets; the local token issuer refuses to run with a production profile.
4. **Least privilege**: the application database role needs DML on its own schema only; migrations run with a separate, more privileged role in the pipeline; per-environment credentials differ.
5. **Rotation without downtime**: the secret store rotates; pods pick up new values on restart (Kubernetes secrets are env-injected at start) - rolling restart after rotation; the database accepts old and new passwords during the overlap (dual-user rotation).

## Where each secret lives

| Secret | Local development | Test/production |
|---|---|---|
| Database credentials | `POSTGRES_PASSWORD` in an untracked `.env` (compose) / H2 needs none | AWS Secrets Manager (or Vault) -> **External Secrets Operator** -> Kubernetes Secret `platform-db-credentials` referenced by `secretKeyRef` (see `external-secret.example.yaml`); IAM Roles for Service Accounts, no static cloud keys |
| JWT validation | local issuer: random key per start or `LOCAL_ISSUER_HMAC_SECRET` | none to store: public keys are fetched from the IdP's JWKS via `OIDC_ISSUER_URI` |
| Demo user password | `LOCAL_DEMO_PASSWORD` (synthetic, local profile only) | does not exist |
| NVD API key (CI) | - | GitHub secret `NVD_API_KEY` |
| Cluster access (CI) | - | GitHub *environment* secret (prefer OIDC federation to the cloud) |
| Grafana admin | `GRAFANA_ADMIN_PASSWORD` in `.env` | SSO |

## Environment-specific configuration

One immutable image per version; behaviour differs only through environment variables (ConfigMap/Secret): `SPRING_PROFILES_ACTIVE`, `DB_URL`, `DB_POOL_MAX`,
`OIDC_ISSUER_URI`, `CLEARING_URL`, `CORS_ALLOWED_ORIGINS`, `RATE_LIMIT_*`, `TRACING_SAMPLING`, `OTLP_*`, `app.processing.*`. kustomize overlays
(`infrastructure/k8s/overlays/<env>`) patch the ConfigMap per environment. `validate-infra.py` asserts that the Kubernetes configuration never enables the local issuer and holds no secret-like keys.

## Detecting leaks

gitleaks in CI on the full history; secret-pattern scan in `scripts/validate-infra.py` (cloud keys, private keys, tokens); the OpenTelemetry Collector deletes `authorization`/`cookie` span attributes; logs never contain tokens or bodies.
If a secret leaks: revoke/rotate first, then investigate, then purge history if needed (rotation is the real fix; deleting from git is not).
