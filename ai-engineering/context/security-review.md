# Security review instructions

Perform on every change; record findings and fixes in the PR. Use `docs/security/threat-model.md` and `owasp-mapping.md` as the reference.

**1. Authentication** - no new unauthenticated path (check `SecurityConfig` `authorizeHttpRequests`); tokens validated (signature, expiry, issuer); nothing trusted from the request body about identity.
**2. Authorization** - for every new endpoint/query: role rule? object-level rule? what does a *different customer* get (must be 404)? support agent (read-only)? maker-checker where money is approved? List the negative tests added.
**3. Input** - Bean Validation on DTOs; allow-list patterns for free text; sizes bounded; unknown fields rejected; UUID/typed parameters; sort/filter whitelists; no string-built SQL/JPQL/HTML; no reflection on user input.
**4. Data exposure** - DTO fields reviewed one by one; PII masked per role; no entity serialisation; error messages generic; logs free of PII/tokens/bodies; audit text free of PII.
**5. Secrets and config** - none in code/tests/docs/examples; new settings via environment with safe defaults; no weakening of a security default "to make it work" (CSRF, CORS, headers, token validation, rate limits).
**6. Money and integrity** - `BigDecimal`, constraints, idempotency, lock order, outcomes classification (see `copilot-instructions.md`).
**7. Resilience and DoS** - timeouts, bounded retries with jitter, rate/size limits, page caps, bounded waits.
**8. Dependencies and containers** - new library justified, licence/CVE checked; image non-root, read-only FS.
**9. Frontend** - token handling, `innerHTML`/sanitiser bypass, open redirects, CSP impact, third-party scripts.
**Output format:** table `severity | finding | location | exploit scenario | fix | test`. When unsure, present 2-3 options, label the safest default and explain the trade-off - do not silently choose the convenient one.
