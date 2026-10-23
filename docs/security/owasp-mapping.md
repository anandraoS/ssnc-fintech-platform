# OWASP mapping

## OWASP Top 10 (2021)

| Risk | Control in this repository | Evidence |
|---|---|---|
| A01 Broken Access Control | role rules + object-level `AccessPolicy`, deny-by-default, 404 for foreign objects, maker-checker | `SecurityIT`, `AccessPolicyTest` |
| A02 Cryptographic Failures | TLS at the edge + HSTS; JWT signature validation (asymmetric with an IdP); BCrypt for the demo issuer; secrets via environment/secret manager; passwords never logged | `SecurityConfig`, `LocalIssuerConfig`, k8s manifests |
| A03 Injection | bound parameters only (JPA/Criteria), allow-list validation, strict JSON, memo regex, sort whitelist | `SecurityIT.inputHardening` |
| A04 Insecure Design | threat model, state machine, idempotency, maker-checker, reconciliation, rate limits, ADRs | `docs/security/threat-model.md` |
| A05 Security Misconfiguration | secure headers, CORS allow-list, deny-by-default, management port separated, hardened containers, restricted pod security, no default credentials (secrets required) | `validate-infra.py`, `SecurityIT` |
| A06 Vulnerable and Outdated Components | pinned versions; OWASP Dependency-Check, `npm audit`, Trivy; minimal dependency set | CI `security-scan`, `images` |
| A07 Identification and Authentication Failures | JWT validation (signature/expiry/issuer), login throttling, generic login error, short token TTL, in-memory token in the SPA | `SecurityIT`, `RateLimitIT` |
| A08 Software and Data Integrity Failures | CI builds once and promotes the same image; Flyway checksums (`validate-on-migrate`); append-only audit; contract test | CI, `ApiContractIT` |
| A09 Security Logging and Monitoring Failures | audit trail incl. denials and logins; correlation ids; structured logs; alert rules (dead letters, reconciliation, circuit open, 5xx) | `AuditService`, `alert-rules.yml` |
| A10 Server-Side Request Forgery | no user-controlled URLs; the only outbound call goes to a configured base URL with fixed paths | `RestClearingClient` |

## OWASP API Security Top 10 (2023)

| Risk | Control | Evidence |
|---|---|---|
| API1 Broken Object Level Authorization | `AccessPolicy` on every object access; scope forced for list/search | `SecurityIT` (BOLA tests) |
| API2 Broken Authentication | JWT validation, login throttle, no session, short TTL | `SecurityIT`, `RateLimitIT` |
| API3 Broken Object Property Level Authorization | DTOs only; PII masking per role; tax id never returned; strict input (no mass assignment) | `SecurityIT.piiMasking`, `inputHardening` |
| API4 Unrestricted Resource Consumption | rate limit, body limit, page cap, sort whitelist, timeouts, pool limits | `RateLimitIT`, `ApiContractIT` |
| API5 Broken Function Level Authorization | `@PreAuthorize` per endpoint; admin-only operations | `SecurityIT.roleRules` |
| API6 Unrestricted Access to Sensitive Business Flows | idempotency, review threshold, maker-checker, daily limit, rate limit on submission | `TransactionFlowIT`, `IdempotencyIT` |
| API7 Server Side Request Forgery | see A10 | - |
| API8 Security Misconfiguration | see A05; error envelope without internals | `ServerErrorIT` |
| API9 Improper Inventory Management | single versioned API, committed OpenAPI contract, docs endpoints only when `app.docs.public=true` (local) | `ApiContractIT` |
| API10 Unsafe Consumption of APIs | the clearing client treats the remote as untrusted: timeouts, strict response mapping (unknown status -> `Unknown`), idempotent calls, circuit breaker | `RestClearingClientTest` |
