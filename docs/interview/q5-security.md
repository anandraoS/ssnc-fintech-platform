# Questions: security

### Q81. Explain OAuth 2.0 and OpenID Connect and which flow you would use for an Angular SPA.
**Short answer:** OAuth 2.0 delegates limited access to an API; OIDC adds authentication (an ID token) on top; the SPA should use the authorization-code flow with PKCE.
**Reasoning and implementation:** the SPA redirects to the authorization server, the user authenticates there, the SPA receives a one-time code and exchanges it (with the PKCE verifier) for tokens; the API validates the access token as a resource server. Implicit and password grants are obsolete. A backend-for-frontend can hold tokens server-side and give the browser an HttpOnly, SameSite cookie.
**Alternatives and trade-offs:** BFF + cookies (strongest browser story, needs CSRF protection and a server), SPA-held tokens (simpler, more XSS exposure), client credentials for service-to-service.
**Risks and pitfalls:** tokens in `localStorage`, missing state/nonce validation, long-lived access tokens, wildcard redirect URIs.
**Likely follow-ups:** "what does PKCE protect against?" (code interception); "ID token vs access token?"
**In this project:** local demo issuer for convenience only; production-style validation uses `OIDC_ISSUER_URI`; ADR-008/012.

### Q82. How do you validate a JWT correctly?
**Short answer:** verify the signature with the issuer's key, restrict the algorithm, check `exp/nbf/iss/aud`, then map claims to authorities.
**Reasoning and implementation:** resolve the key by `kid` from the JWKS (cached, refetched on unknown `kid`); allow-list algorithms (never `none`, never let the token pick HS vs RS); validate time claims with small skew; check issuer and audience; ignore unknown role names; treat the token as signed-but-readable (no secrets inside).
**Alternatives and trade-offs:** opaque tokens with introspection (easy revocation, extra hop), mTLS-bound tokens.
**Risks and pitfalls:** accepting any issuer, trusting claims from an unverified source, long TTLs without revocation, logging tokens.
**Likely follow-ups:** "how do you revoke a JWT?" (short TTL + refresh rotation, deny-list for emergencies).
**In this project:** `SecurityConfig`, `LocalIssuerConfig` (timestamp + issuer validators), `SecurityIT` (forged, tampered, expired tokens).

### Q83. [Scenario] A pen-tester shows that changing the id in `/accounts/{id}` returns another customer's data. How do you respond?
**Short answer:** treat it as a high-severity BOLA defect: reproduce, fix with an object-level policy, add tests for every endpoint taking an id, review all similar endpoints, and check logs for past exploitation.
**Reasoning and implementation:** reproduce with two users; write the failing test; add `AccessPolicy.canViewAccount` in the service that loads the object; return 404 and audit; sweep `balance`, `history`, `ledger`, transaction read/cancel, search filters and list endpoints (force the customer scope server-side). Look at access logs/audit for unusual id probing (many 404s per subject) and assess disclosure obligations with the security team.
**Alternatives and trade-offs:** database row-level security as defence in depth; gateway rules cannot see ownership.
**Risks and pitfalls:** patching one endpoint only; relying on unguessable UUIDs ("security through obscurity").
**Likely follow-ups:** "how do you prevent recurrence?" (review checklist, a BOLA test per endpoint, shared policy).
**In this project:** `SecurityIT` BOLA tests, `AccessPolicy`.

### Q84. How do you protect against SQL injection in a JPA application?
**Short answer:** never concatenate input into queries; use bound parameters (JPQL/Criteria/Spring Data), validate input, and give the database account least privilege.
**Reasoning and implementation:** search strings are passed as parameters (`cb.like(..., pattern)`), sort fields come from a whitelist, `LIKE` wildcards are stripped from user text; native queries use named parameters; the DB role cannot alter schema; tests send injection strings and assert they behave as data.
**Alternatives and trade-offs:** stored procedures (not inherently safer), ORM-generated queries (safe if used correctly).
**Risks and pitfalls:** `@Query` with string concatenation, dynamic `ORDER BY` from user input, second-order injection.
**Likely follow-ups:** "are `ORDER BY` columns parameterisable?" (no - whitelist).
**In this project:** `SecurityIT.inputHardening`, `PageableSupport`.

### Q85. [Scenario] How do you design secrets management for this system across local, CI and production?
**Short answer:** no secrets in the repository; local uses an untracked `.env`; CI uses encrypted repository/environment secrets (prefer OIDC federation); production uses a secret manager surfaced to pods at runtime.
**Reasoning and implementation:** compose refuses to start without required variables; Kubernetes references `secretKeyRef`, populated by External Secrets from AWS Secrets Manager (IRSA) with rotation; the app fails closed without token validation; gitleaks and a pattern scan run in CI; a leak is handled by rotating first.
**Alternatives and trade-offs:** Vault dynamic credentials (short-lived DB users), sealed secrets (GitOps-friendly), mounted files vs env.
**Risks and pitfalls:** secrets in images/logs/actuator `env`, shared credentials across environments.
**Likely follow-ups:** "how do you rotate the DB password without downtime?"
**In this project:** `secrets-management.md`, `.env.example`, `external-secret.example.yaml`.

### Q86. What are the OWASP API Security Top 10 risks most relevant to a payments API?
**Short answer:** BOLA, broken authentication, broken function-level authorization, unrestricted resource consumption, unrestricted access to sensitive business flows, and excessive data exposure.
**Reasoning and implementation:** map each to controls: object-level policy; JWT validation + login throttling; `@PreAuthorize`; rate/body/page limits; idempotency + review thresholds + maker-checker; DTOs and masking. Add logging/monitoring for abuse patterns (repeated `ACCESS_DENIED`).
**Alternatives and trade-offs:** API gateway/WAF for generic controls (cannot replace domain checks).
**Risks and pitfalls:** treating the list as a checklist instead of testing each.
**Likely follow-ups:** "what is 'sensitive business flow' abuse?" (bulk account creation, scripted redemption, transaction spamming).
**In this project:** `owasp-mapping.md` with evidence per risk.

### Q87. [Scenario] You must secure the admin operations (drain, requeue, resolve). What controls do you apply?
**Short answer:** role restriction, separation of duties where money is affected, full audit, network isolation and rate limiting.
**Reasoning and implementation:** `ADMIN`-only `@PreAuthorize` for outbox/drain; reconciliation resolution by operators with maker-checker; every action audited with actor/role/correlation id; management endpoints on a separate port restricted by NetworkPolicy; step-up authentication/MFA at the IdP for privileged roles; break-glass accounts monitored; no destructive bulk operations without confirmation.
**Alternatives and trade-offs:** four-eyes approval for every admin action (slower), just-in-time privilege elevation.
**Risks and pitfalls:** shared admin accounts, admin APIs on the public ingress, unlogged actions.
**Likely follow-ups:** "how do you detect misuse?" (SIEM rules on audit events).
**In this project:** `OpsController`, `SecurityIT.roleRules`, `TransactionFlowIT` (support cannot resolve).

### Q88. How do you prevent sensitive data from leaking through logs and errors?
**Short answer:** do not log it, mask it where you must show it, and sanitise errors centrally.
**Reasoning and implementation:** no tokens/bodies/PII in logs; account numbers masked; audit text stores field names not values; one error handler returns generic 500s; correlation id lets support find details server-side; structured logs with allow-listed fields; the OTel collector strips auth headers; tests assert that internals do not reach the client.
**Alternatives and trade-offs:** log redaction filters (safety net, not the plan), tokenisation of identifiers.
**Risks and pitfalls:** `toString()` of entities in logs, logging request bodies for debugging, third-party SDK logging.
**Likely follow-ups:** "how do you debug production issues without PII?" (correlation ids, synthetic repro).
**In this project:** `Masking`, `ServerErrorIT`, `AuditService` usage.

### Q89. What is CSRF and does this API need protection?
**Short answer:** CSRF abuses automatically attached credentials (cookies); an API that authenticates with an `Authorization` header does not need CSRF tokens, but the decision must be explicit and revisited if cookies are introduced.
**Reasoning and implementation:** browsers add cookies to cross-site requests but never add custom headers on their own, so a forged form post carries no bearer token. CORS allow-list limits which origins can read responses. If a BFF with cookie sessions were used, enable CSRF protection (SameSite cookies + tokens).
**Alternatives and trade-offs:** double-submit cookie, SameSite=Strict.
**Risks and pitfalls:** disabling CSRF "to make it work" in a cookie-based app.
**Likely follow-ups:** "what about CORS preflight?"
**In this project:** `SecurityConfig` comment, `SecurityIT.cors`.

### Q90. [Scenario] Login is being brute-forced. What do you do?
**Short answer:** throttle by client and account, add monitoring/lockout carefully, require stronger factors at the IdP, and keep error messages uniform.
**Reasoning and implementation:** per-address token bucket on the login endpoint (10/min), identical 401 messages for unknown user and wrong password, constant-time comparison path, alert on spikes of `LOGIN_FAILED` audit events, temporary per-account backoff (avoid permanent lockout - it enables denial of service), MFA/WAF bot rules at the edge.
**Alternatives and trade-offs:** CAPTCHA, device reputation, credential-stuffing databases checks.
**Risks and pitfalls:** lockouts that let an attacker lock victims out; IP limits behind a proxy.
**Likely follow-ups:** "how do you test rate limits?"
**In this project:** `RateLimitFilter`, `RateLimitIT.loginIsThrottled`, `SecurityIT.localLogin`.

### Q91. How do you secure containers and Kubernetes workloads?
**Short answer:** minimal non-root images, read-only filesystem, dropped capabilities, restricted pod security, network policies, no mounted service-account tokens, scanned images and externalised secrets.
**Reasoning and implementation:** multi-stage builds with a JRE-only runtime and a dedicated user; `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`; namespace with the *restricted* pod-security standard; default-deny NetworkPolicy with explicit allows; Trivy in CI; RBAC least privilege; admission policies (OPA/Kyverno) to enforce.
**Alternatives and trade-offs:** distroless/chiselled images (smaller attack surface, harder debugging), gVisor/Kata for stronger isolation.
**Risks and pitfalls:** running as root "temporarily", privileged containers, broad egress.
**Likely follow-ups:** "how do you debug a read-only container?" (ephemeral debug containers).
**In this project:** manifests and `validate-infra.py` assertions.

### Q92. [Scenario] How would you handle a dependency with a critical CVE the day before a release?
**Short answer:** assess exploitability in your context, patch or mitigate, run the full gates, and communicate; do not skip the pipeline.
**Reasoning and implementation:** identify the affected component with the SCA report and `mvn dependency:tree`; check whether the vulnerable code path is reachable; upgrade (BOM-managed if possible) or apply a mitigation (config flag, WAF rule); run the full test suite and the scans again; if no safe fix, document a time-boxed exception with compensating controls and an owner; consider delaying the release.
**Alternatives and trade-offs:** hot-patch only the vulnerable library vs full dependency refresh (risk of regressions).
**Risks and pitfalls:** blindly bumping major versions; suppressing findings without analysis.
**Likely follow-ups:** "what is an SBOM and why generate one?"
**In this project:** CI `security-scan` job, ADR-009, release checklist.
