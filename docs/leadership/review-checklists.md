# Pull-request checklist and code-review checklist

## Pull-request checklist (author)

- [ ] **Why** is clear (ticket/spec link); the PR is small enough to review in 30 minutes, or split.
- [ ] Tests written first or alongside: unit for new rules, integration for new endpoints, regression test for every fixed defect.
- [ ] **Authorization:** every new endpoint has a role rule *and* an object-level check; a BOLA test exists.
- [ ] **Money:** only `BigDecimal`/strings, `compareTo`, no rounding of input, no `double`/`float` anywhere near amounts.
- [ ] **Transactions:** boundaries explicit; no external call inside a transaction; locks in the documented order; no `@Transactional` self-invocation.
- [ ] **Idempotency/retries:** any new retry is on an idempotent operation with backoff + jitter; new endpoints that create state accept an idempotency key.
- [ ] **Errors:** uses the error envelope; no internals leaked; new codes documented.
- [ ] **Data:** migrations additive (expand/contract), never edit a released migration, indexes for new query shapes, plan checked.
- [ ] **Observability:** logs without PII; metrics/alerts/runbook updated if behaviour is operationally relevant.
- [ ] **Docs:** OpenAPI regenerated (`-Dopenapi.update=true`) and committed; ADR for a significant decision.
- [ ] `mvn verify`, frontend lint/test/build pass locally; no secrets in the diff; dependencies justified.
- [ ] If AI assisted: I read and understand every line; the AI checklist in `ai-engineering/review/` was applied.

## Code-review checklist (reviewer)

**Correctness & invariants** - Can an interleaving of two requests break an invariant? What if this runs twice? What if the process dies between these two lines? Are state transitions legal per the state machine?
**Security** - who can call this, and on *whose* data? Is input validated by allow-list? Any string-built SQL/HTML? Any new secret, log line, or error that exposes data? Any new dependency (licence, maintenance, CVEs)?
**Concurrency** - lock scope and order; `@Version` use; unique constraints as the arbiter; bounded waits; thread-safety of shared state (rate limiter maps, caches).
**Resilience** - timeouts on every remote call; retry only idempotent calls; classification of "unknown"; circuit breaker; graceful degradation.
**Performance** - N+1 queries, unbounded result sets, missing index, sort without whitelist, deep offset paging, work inside locks, allocation in hot paths.
**Design** - single responsibility, naming, dependency direction, duplication, testability (pure logic separated from I/O), no premature abstraction.
**Tests** - do they fail if the code is wrong (mutation thinking)? Do they test behaviour, not implementation? Deterministic (no sleeps without need, no clock/time-zone dependence)? Cover negative paths and the invariant afterwards?
**Frontend** - typed models, no `any`, OnPush, unsubscribe/`takeUntilDestroyed`, accessible labels, loading/empty/error states, no money arithmetic in JS, no token in storage.
**Operations** - config via environment, safe defaults, health/readiness unaffected, rollback possible, migration safe under rolling deploy.
**Tone** - comments are specific, kind and actionable; label severity (`blocker`, `suggestion`, `nit`, `question`); approve when risks are acceptable, not when code matches your taste.
