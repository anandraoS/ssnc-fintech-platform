# Security threat model

Method: STRIDE per trust boundary, ranked by impact on money and data, each threat mapped to a concrete control **and** to evidence
(test or configuration). Scope: the platform as implemented; assets: account balances and ledger integrity, customer PII, the audit trail,
credentials/tokens, availability of transaction processing.

## Trust boundaries and actors

1. Internet -> edge (WAF, TLS) -> Angular SPA / API (untrusted callers, including authenticated-but-malicious customers).
2. SPA/API -> identity provider (tokens are trusted only after signature/expiry/issuer validation).
3. API -> database (trusted, but least-privilege account; SQL built only with bound parameters).
4. API -> external clearing network (semi-trusted: it can be slow, wrong, or unreachable).
5. Operators/administrators -> admin endpoints (privileged insiders can err or abuse).

## Threat register

| # | Threat (required topic) | STRIDE | Impact | Controls | Evidence |
|---|---|---|---|---|---|
| T1 | **Broken object-level authorization** - a customer reads or changes another customer's accounts/transactions by guessing ids | E, I | critical | UUID ids; `AccessPolicy` on every read/command; `404` not `403`; customer scope forced server-side for list/search; audit of denials | `SecurityIT` (accounts, balances, history, ledger, tx read/cancel/approve, searches, submit/transfer into others' accounts, orphan token), `AccessPolicyTest` |
| T2 | **Unauthorized transaction submission** - wrong role, someone else's account, support agent moving money, forged token | S, E | critical | `@PreAuthorize`; `canSubmit` per type (transfer must stay in one customer); JWT signature/expiry/issuer; unknown roles ignored | `SecurityIT` (forged token, expired, tampered, support cannot submit, unknown role), `AccessPolicyTest` |
| T3 | **Duplicate transaction requests** - client retry, double click, replay by an attacker | T, R | high | mandatory `Idempotency-Key`, unique `(principal,key)`, payload fingerprint, replay header, 7-day retention | `IdempotencyIT` (incl. 12 concurrent), e2e duplicate scenario, load baseline (25 keys x ~1,100 requests -> exactly 25 deposits) |
| T4 | **SQL injection** | T, I | critical | JPA/Criteria with bound parameters only; no native string concatenation; typed path variables; sort whitelist | `SecurityIT.inputHardening` (injection strings in search params are inert), code review rule |
| T5 | **Credential exposure** - secrets in the repo, logs, images, client bundle | I | critical | nothing committed (`.env.example` placeholders only); compose requires secrets from `.env`; Kubernetes `secretKeyRef` + External Secrets; token in memory only in the SPA; gitleaks in CI; secret-pattern scan in `validate-infra.py`; local issuer key random per start | `validate-infra.py`, CI `security-scan` job |
| T6 | **Privilege escalation** - role claim manipulation, mass assignment, maker-checker bypass | E | critical | roles only from a *validated* token; unknown roles ignored; strict JSON (unknown fields rejected); maker-checker in `AccessPolicy.canReview`; admin endpoints `@PreAuthorize` | `SecurityIT` (role rules, mass assignment), `TransactionFlowIT.reviewThresholdAndMakerChecker` |
| T7 | **Sensitive data in logs and errors** | I | high | one error envelope, generic 500 message; no PII/tokens/bodies logged; masking utilities; OTel collector strips auth headers | `ServerErrorIT` (fake JDBC URL + password never reach the client), `SecurityIT.noInformationLeakage`, `MaskingAndPagingTest` |
| T8 | **Race conditions** - overspend, lost update, deadlock, double posting | T | critical | ordered row locks, authoritative checks under lock, unique ledger postings, optimistic versions, DB `CHECK balance >= 0` | `ConcurrencyIT` + `PostgresConcurrencyIT`, `SchemaConstraintsIT`, `LedgerServiceTest` |
| T9 | **Denial of service** - request floods, huge bodies, expensive queries, retry storms, slow dependency | D | high | per-subject and per-address rate limits; 64 KB body limit; page cap 100; sort whitelist; Hikari 3 s acquire timeout; 5 s lock wait; timeouts + circuit breaker + jittered backoff on the external call; HPA | `RateLimitIT`, `ApiContractIT` (413, page cap), chaos e2e |
| T10 | **Insecure administrative operations** - drain, requeue, resolve, suspend, close | E, R | high | admin-only `@PreAuthorize`; maker-checker on approvals and reconciliation resolutions; every action audited with actor and correlation id; management port separate from the public port | `SecurityIT.roleRules`, `TransactionFlowIT` (support cannot resolve) |
| T11 | Tampering with the audit trail | T, R | high | append-only; PostgreSQL trigger rejects UPDATE/DELETE; audit rows written in the same transaction as the change | `PostgresFeaturesIT.auditTrailIsImmutable` |
| T12 | Token theft / XSS | S, I | high | token in memory only, strict CSP, no `innerHTML`, Angular sanitisation on, short TTL (30 min), HTTPS + HSTS | unit test asserts nothing in web storage; nginx CSP |
| T13 | CSRF | T | medium | stateless bearer tokens in a header (not cookies); CORS allow-list; documented trigger to re-enable CSRF if cookies are introduced | `SecurityIT.cors` |
| T14 | Replay of an old token after logout | S | medium | short TTL; (production) token revocation / refresh-token rotation at the IdP | design note |
| T15 | Enumeration and user probing via login | I | medium | identical `401` message for unknown user and wrong password, constant-time comparison path (decoy hash), login rate limit | `SecurityIT.localLogin`, `RateLimitIT.loginIsThrottled` |
| T16 | Supply-chain compromise (dependency, base image, CI action) | T | high | pinned versions, OWASP Dependency-Check, `npm audit`, Trivy, minimal dependencies (no Spring Cloud/broker/Redis), non-root distroless-style images, pin actions by SHA in production | CI pipeline |
| T17 | Lateral movement inside the cluster | E | high | default-deny NetworkPolicy, per-service allow rules, restricted pod security, no service-account tokens mounted, read-only root FS | `validate-infra.py` asserts these on the manifests |
| T18 | Uncertain external outcome exploited (double payout / lost money) | T | critical | three-way outcome classification, funds reserved before the call, reconciliation with maker-checker | `TransactionProcessorTest`, `TransactionFlowIT`, chaos e2e |

## Residual risks and next steps (production)

* In-memory rate limiting is per instance - use a shared store or the gateway.
* Local issuer HS256 secrets are acceptable for a demo only; real deployments use the IdP's asymmetric keys.
* No field-level encryption or tokenisation of identifiers; no key rotation procedure for a data-encryption key.
* No anomaly detection on audit events (e.g. repeated `ACCESS_DENIED` from one subject); recommended SIEM rule.
* Four-eyes is implemented for approval and reconciliation, not yet for customer suspension or account closure.
* An independent penetration test and a data-protection impact assessment are prerequisites for any real use.
