# Enterprise Investment Account and Transaction Management Platform

A synthetic, educational financial-technology platform built to demonstrate senior/lead full-stack engineering: Java 21 and Spring Boot 3.5 backend, Angular 20 frontend, PostgreSQL with Flyway, security, concurrency control, observability, CI/CD, Kubernetes manifests, AI-assisted workflow artefacts and leadership documentation. **Synthetic data only; not a production financial system.**

Read first: [docs/validation/validation-report.md](docs/validation/validation-report.md) says exactly what was executed and what was only written.

## What is in the box

| Path | Contents |
|---|---|
| `backend/platform-service` | modular monolith: customers, accounts, transactions (9-state machine, ledger, outbox, reconciliation), audit, ops, security |
| `backend/clearing-simulator` | test double of the external clearing network (latency, declines, 5xx, chaos modes) |
| `frontend/` | Angular 20 + Material operations console (role-aware navigation, portfolio, transfers, investigations, audit) |
| `frontend-react/` | the same console in React 19 + Vite + TypeScript: same API contract, same screens, same security behaviour, same end-to-end suite (see [frontend-react/README.md](frontend-react/README.md)) |
| `infrastructure/` | Dockerfiles, nginx, Docker Compose, Kubernetes base and test overlay |
| `observability/` | Prometheus config and alert rules, Grafana provisioning and dashboard, OpenTelemetry collector |
| `tests/` | live API and browser end-to-end scripts, `.http` / Postman collection, BDD feature |
| `performance/` | local Node load baseline, k6 scripts |
| `specs/`, `ai-engineering/`, `.github/` | spec-driven development, AI context and agent definitions, Copilot instructions, CI workflow |
| `docs/` | architecture, 13 ADRs, security, testing, operations, leadership artefacts, 142-question interview bank, validation, the two PDFs |

Start with the PDFs in `docs/pdf/`: *Architecture and Workflows* (project guide) and *Senior/Lead Java Full-Stack Interview Guide* (technical reference and question bank).

## Prerequisites

JDK 21, Maven 3.9+, Node 20+ (24 used here), a Chromium-based browser (Edge or Chrome) for the browser tests. Docker is optional and was **not** available when this was built.
Point `JAVA_HOME` at a JDK 21 yourself; the scripts never set it.

## Build and test

```bash
scripts/build.sh
```

Runs backend `mvn verify` (unit tests, H2 integration tests, integration and concurrency tests against an embedded real PostgreSQL) and the Angular lint, unit tests and production build. The React edition builds and tests separately:

```bash
cd frontend-react && npm ci && npx tsc --noEmit && npm run lint && npm test && npm run build
```

## Run locally (no Docker)

```bash
scripts/run-local.sh          # simulator :18490, platform :18480 (profile "local"); optional overrides are listed in the script header and .env.example
node scripts/serve-frontend.mjs   # Angular UI on http://localhost:4280 (static files + API proxy)
node scripts/serve-frontend.mjs --port 4281 --dir frontend-react/dist   # React UI on http://localhost:4281, same API
scripts/stop-local.sh
```

Both UIs work against the same backend with the default CORS settings: the proxy passes the `Host` header through, so the browser's requests are same-origin for the API (see `docs/architecture/12-react-frontend.md`).

Swagger UI: `http://localhost:18480/swagger-ui.html` (local profile). Demo users and the password come from the local profile and `.env.example`; the local token issuer exists only for development and tests.

Then:

```bash
node tests/e2e/e2e-api.mjs [--with-chaos]    # live API scenarios
node tests/e2e/ui-e2e.mjs                    # browser suite against the Angular UI (needs puppeteer-core: cd tests/e2e && npm ci)
node tests/e2e/ui-e2e.mjs --flavor react     # the same suite against the React UI
node scripts/capture-api-examples.mjs        # regenerate docs/api/examples.md from real calls
```

## Docker Compose (not executed during development)

```bash
cp .env.example .env     # then replace every placeholder with your own values; never commit .env
docker compose -f infrastructure/docker-compose.yml --env-file .env up --build
# add the React UI on :4281 as well:  ... --profile react up --build
```

Validate configuration without Docker: `python -I scripts/validate-infra.py`.

## Rebuild the PDFs

```bash
cd tools/pdf && npm ci && node build-pdf1.mjs && node build-pdf2.mjs && node verify-pdfs.mjs
```

## Security notes

No secrets are committed; configuration comes from environment variables (`.env.example` lists the names). The API is a JWT resource server that fails closed without a decoder. See `docs/security/` and `docs/operations/secrets-management.md`.
# ssnc-fintech-platform
# ssnc-fintech-platform
# ssnc-fintech-platform
