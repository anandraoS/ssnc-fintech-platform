# Questions: Angular and REST APIs

### Q63. What does `OnPush` change detection do, and how do signals relate to it?
**Short answer:** an `OnPush` component is checked only when an input reference changes, an event fires inside it, a signal it reads changes, or it is marked dirty; signals make that precise.
**Reasoning and implementation:** Default change detection walks the whole component tree after every async event (zone.js). `OnPush` prunes subtrees. Signals record which components read them, so a `signal.set()` schedules only those views. Together: immutable-style updates, `computed` derived state, no manual `markForCheck` in most cases.
**Alternatives and trade-offs:** zoneless Angular (no zone.js; signals/`markForCheck` drive updates), Default CD (simplest, slowest).
**Risks and pitfalls:** mutating objects in place under `OnPush` (no update); reading non-signal mutable fields in templates.
**Likely follow-ups:** "what triggers a check in OnPush?"
**In this project:** every component is `OnPush`; view state uses `signal` + `computed`.

### Q64. RxJS: when do you use `switchMap`, `mergeMap`, `concatMap` and `exhaustMap`?
**Short answer:** `switchMap` cancels the previous inner (typeahead, route-driven loads), `mergeMap` runs in parallel, `concatMap` queues in order, `exhaustMap` ignores new triggers while busy (submit buttons).
**Reasoning and implementation:** HTTP cancellation happens when you unsubscribe, so `switchMap` prevents stale responses overwriting fresh ones. `exhaustMap` protects against double submit at the stream level (the form here also disables the button and relies on idempotency keys server-side). `forkJoin` waits for all to complete and **cancels siblings on the first error**.
**Alternatives and trade-offs:** signals + `toSignal` for simple loads; async/await with `firstValueFrom` for one-shot calls.
**Risks and pitfalls:** nested subscribes, leaking subscriptions (use `takeUntilDestroyed`), using `mergeMap` for ordered work.
**Likely follow-ups:** "what is the difference between cold and hot observables?"
**In this project:** dashboard `forkJoin`, form submit handling; tests learnt that sibling requests are cancelled on error.

### Q65. How do signals differ from RxJS observables, and when do you use which?
**Short answer:** signals hold current synchronous state with automatic dependency tracking; observables model asynchronous event streams over time.
**Reasoning and implementation:** state shown in templates (loading flag, rows, derived `viewState`) is signal territory (`signal`, `computed`); async sources (HTTP, timers, user event streams) remain observables and are bridged at the edge (`toSignal`, `toObservable`). `effect` is for side effects (sparingly - prefer `computed`).
**Alternatives and trade-offs:** NgRx/SignalStore for large shared state; plain services with subjects.
**Risks and pitfalls:** writing signals inside `computed`; overusing `effect` as a hidden data flow; converting everything for its own sake.
**Likely follow-ups:** "is `computed` lazy?" (yes, memoised).
**In this project:** `AuthService` signals (`user`, `isStaff`...), `toSignal(form.valueChanges)` in the transaction form.

### Q66. [Scenario] A form submits twice when the user double-clicks "Submit" on a slow network. How do you make that safe end to end?
**Short answer:** disable the button while pending, make the request idempotent with a stable key, and let the server enforce it.
**Reasoning and implementation:** client: ignore submit while `busy`, generate the idempotency key once per logical payload (`IdempotencyKeys.keyFor`) and reuse it on retry; reset only after a definitive outcome. Server: unique `(principal, key)` constraint replays the original result. After an *unknown* failure (timeout) the user retries with the *same* key and cannot create a duplicate; after editing the amount a new key is used.
**Alternatives and trade-offs:** `exhaustMap` in the stream (helps the client only), server-side time-window dedup (fragile).
**Risks and pitfalls:** regenerating the key on retry; keys that survive across different payloads (server answers 422).
**Likely follow-ups:** "what does the user see on replay?" (a notice that no second transaction was created).
**In this project:** `TransactionNewComponent`, specs for "reuses the SAME key" and "new key on edit", `IdempotencyIT`.

### Q67. How do Angular interceptors work, and how do you order them?
**Short answer:** functional interceptors wrap `HttpClient` calls in a chain; the first in the list is the outermost.
**Reasoning and implementation:** `provideHttpClient(withInterceptors([error, auth, correlation]))`: request flows correlation -> auth -> error-handling in reverse of the list for the *response*; the outermost interceptor sees the final error after inner ones added headers. Keep them cross-cutting and small; attach tokens only to your API URLs; normalise errors once; sign out on 401 except for the login call.
**Alternatives and trade-offs:** per-service header handling (duplication), HTTP client wrapper.
**Risks and pitfalls:** sending tokens to third parties, mutating the request instead of cloning, swallowing errors, retry interceptors on non-idempotent calls.
**Likely follow-ups:** "how would you add a global loading indicator?"
**In this project:** `core/interceptors.ts`, tested in `core.spec.ts`.

### Q68. How do you implement role-aware navigation and why is it not security?
**Short answer:** filter menu items and guard routes by role for usability, but the API must enforce every permission because the client is untrusted.
**Reasoning and implementation:** `AuthService` exposes role signals; `ShellComponent` filters nav items; `roleGuard` redirects to a "not permitted" page; the API independently returns 401/403/404. A malicious user can edit the JS or call the API directly, so the server decides.
**Alternatives and trade-offs:** server-driven UI (permissions returned by the API) to avoid duplicating rules.
**Risks and pitfalls:** hiding buttons and assuming safety; role names drifting between client and server.
**Likely follow-ups:** "where should the role list come from?" (token claims / `/me`).
**In this project:** `ShellComponent`, `roleGuard`, E2E "a customer is redirected from /audit".

### Q69. [Scenario] Users complain the dashboard flickers "Loading..." every 15 seconds. How do you fix it?
**Short answer:** separate *initial loading* from *background refresh* and keep the last good data visible.
**Reasoning and implementation:** the view state is derived from `summary()` presence: spinner only until the first data arrives; a refresh failure sets a non-blocking warning instead of replacing the content; refresh only while the tab is visible; avoid overlapping requests (`switchMap`/ignore while in flight).
**Alternatives and trade-offs:** server-sent events/WebSocket push (less polling, more infrastructure).
**Risks and pitfalls:** stale data without a visible timestamp; polling storms with many users.
**Likely follow-ups:** "how would you add push updates?"
**In this project:** `DashboardComponent` (tests: stale-data warning, error + retry).

### Q70. How do you design Reactive Forms with cross-field validation and accessible errors?
**Short answer:** typed controls, field validators for syntax, a group validator for cross-field rules, errors shown after touch and announced to assistive tech.
**Reasoning and implementation:** `transactionShapeValidator` checks type vs accounts (deposit needs target, transfer needs two different accounts); amount uses a pattern and a non-zero validator; `markAllAsTouched` on submit; errors use `mat-error` and `role="alert"`; the submit handler returns early if invalid or busy; the same rules mirror the server's, which stays authoritative.
**Alternatives and trade-offs:** template-driven forms (simple forms), schema-driven forms.
**Risks and pitfalls:** client-only validation; unlabeled controls; errors only by colour.
**Likely follow-ups:** "async validators?" (debounce, cancel).
**In this project:** `transaction-new.component.ts` and its spec.

### Q71. How do you test Angular components and services?
**Short answer:** `TestBed` with real templates, `HttpTestingController` for HTTP, assert user-visible behaviour, keep tests deterministic.
**Reasoning and implementation:** services/interceptors/guards: configure providers and flush requests; components: create the fixture, set inputs with `setInput`, trigger events, flush HTTP, assert DOM text/roles/requests; use `fakeAsync` for timers; destroy fixtures to stop intervals; use `ctl.verify()`. A browser E2E script covers whole journeys.
**Alternatives and trade-offs:** Jest/Vitest (faster, jsdom), Playwright/Cypress for E2E and component tests.
**Risks and pitfalls:** testing private fields; unflushed requests; forgetting `forkJoin` cancels siblings.
**Likely follow-ups:** "how do you test a route guard?" (`runInInjectionContext`).
**In this project:** 58 specs; `core.spec.ts`, `transaction-new.component.spec.ts`, `dashboard.component.spec.ts`.

### Q72. What are the main secure-frontend practices for an Angular app handling financial data?
**Short answer:** avoid XSS sinks, keep tokens out of web storage, use a strict CSP, same-origin API, validate redirects, and never trust the client for authorization.
**Reasoning and implementation:** rely on Angular's sanitisation (no `bypassSecurityTrust*`/`innerHTML`); hold the access token in memory (or HttpOnly cookie via a BFF); CSP `default-src 'self'` from nginx; proxy `/api` so no CORS and no third-party origins; validate `returnUrl`; `npm audit` and lockfile; money as strings; no secrets in the bundle; errors without internals.
**Alternatives and trade-offs:** BFF with cookies (needs CSRF protection), service-worker token handling.
**Risks and pitfalls:** third-party scripts (analytics), `localStorage` tokens, open redirects.
**Likely follow-ups:** "what is Trusted Types?"
**In this project:** ADR-012, `nginx.conf`, login open-redirect tests.

### Q73. How do you optimise Angular performance?
**Short answer:** reduce work per change detection, reduce bytes, reduce requests.
**Reasoning and implementation:** `OnPush` + signals; `track` in `@for`; lazy routes and `@defer`; bundle budgets (the build fails over budget); pure pipes/`computed` instead of template function calls; virtual scroll for long lists; HTTP caching and request de-duplication; measure with Angular DevTools/Lighthouse; avoid polling storms.
**Alternatives and trade-offs:** SSR/hydration for first paint; zoneless.
**Risks and pitfalls:** premature optimisation; huge Material imports; memory leaks from subscriptions.
**Likely follow-ups:** "how do you find what is slow?"
**In this project:** initial bundle ~341 kB raw (~97 kB transferred), lazy features.

### Q74. How would you design REST endpoints for transactions (naming, verbs, status codes)?
**Short answer:** nouns for resources, verbs only for commands, standard codes, and an error envelope.
**Reasoning and implementation:** `POST /transactions` (202 + Location), `GET /transactions/{id}`, `GET /accounts/{id}/transactions`, `POST /transactions/{id}/cancel|approve|reject` as commands; `422` for valid-but-rejected business outcomes; `409` for state conflicts; `404` for foreign objects; idempotency header; pagination with whitelisted sort.
**Alternatives and trade-offs:** `PATCH /transactions/{id} {status}` (generic but hides rules), GraphQL mutations.
**Risks and pitfalls:** leaking internal states as free-form PATCHes, using 200 for everything, unclear 400 vs 422.
**Likely follow-ups:** "400 vs 422?" (malformed/invalid input vs semantically valid but rejected by rules).
**In this project:** API chapter table.

### Q75. How do you implement pagination, filtering and sorting safely?
**Short answer:** cap page size, whitelist sortable fields, parameterise filters, and add a deterministic tie-break.
**Reasoning and implementation:** `size <= 100`; `PageableSupport.restrictSort` rejects unknown properties (no internal columns, no unindexed sorts) and appends `id`; filters are explicit query parameters mapped to JPA Specifications (parameterised); the envelope is stable (`items,page,size,totalElements,totalPages`); for deep pages use keyset pagination.
**Alternatives and trade-offs:** cursor pagination (stable under inserts), `count(*)` cost avoidance (omit totals).
**Risks and pitfalls:** deep `OFFSET`, unstable ordering causing duplicates/missing rows between pages, exposing Spring's `Page` JSON.
**Likely follow-ups:** "why a tie-break on id?"
**In this project:** `PageableSupport`, `TransactionFlowIT.searchAndPagination`.

### Q76. [Scenario] A client reports that after your release their integration breaks. What might have caused it and how do you prevent it?
**Short answer:** a breaking change slipped into a non-breaking version: removed/renamed field, changed type/scale, tightened validation, new required input, new enum value, changed status code.
**Reasoning and implementation:** compare the OpenAPI document before/after; run consumer contract tests; check logs by client id for the failing calls. Prevent with a committed contract and CI diff, additive-only rules, tolerant-reader guidance, deprecation headers, and a canary/ring rollout for risky changes. Roll back quickly if the change is not additive.
**Alternatives and trade-offs:** consumer-driven contract tests (Pact) give early warnings from real consumers.
**Risks and pitfalls:** "harmless" changes like different decimal scale or ordering of arrays.
**Likely follow-ups:** "how do you version?"
**In this project:** `ApiContractIT`, CI step, ADR-007.

### Q77. How do you handle rate limiting and what do you return?
**Short answer:** token bucket per caller; `429` with `Retry-After`; stricter limits on login.
**Reasoning and implementation:** key by authenticated subject (or address when anonymous); bucket capacity allows bursts, refill rate sets sustained throughput; return the standard error envelope and `Retry-After`; per-instance in-memory here - distributed deployments need a shared store (Redis) or gateway enforcement; also protect expensive endpoints separately.
**Alternatives and trade-offs:** fixed/sliding window counters, leaky bucket, gateway-level limiting (WAF).
**Risks and pitfalls:** limiting by IP behind a proxy (everyone looks the same - configure forwarded headers), unbounded key maps.
**Likely follow-ups:** "how do you test it?" (tiny limits in a separate test context).
**In this project:** `TokenBucketRateLimiter`, `RateLimitIT`.

### Q78. What goes into a good error response, and what must never be in it?
**Short answer:** stable code, safe human message, field violations, correlation id; never stack traces, SQL, class names, secrets or echoed payloads.
**Reasoning and implementation:** clients branch on `code`; humans read `message`; operations use `correlationId` to find logs; validation errors list `field` + message; 500s are generic. Tests assert that internal exception text never appears.
**Alternatives and trade-offs:** RFC 7807 problem details (`type`, `title`, `detail`, `instance`).
**Risks and pitfalls:** user enumeration through distinct messages ("user not found" vs "wrong password").
**Likely follow-ups:** "should 404 reveal existence?"
**In this project:** `ApiError`, `ServerErrorIT`, login tests.

### Q79. [Scenario] How would you expose a long-running operation (e.g. a statement export) through REST?
**Short answer:** accept the request asynchronously (`202` + job resource), let the client poll or be notified, and make the job idempotent and cancellable.
**Reasoning and implementation:** `POST /exports` with an idempotency key -> `202 Accepted` + `Location: /exports/{id}`; job states `QUEUED/RUNNING/COMPLETED/FAILED`; the result is a time-limited download link (pre-signed URL); progress via polling with `Retry-After` or webhooks; authorisation on the job and the file; limits per customer; stream, never load all rows in memory.
**Alternatives and trade-offs:** synchronous streaming for small exports; server-sent events.
**Risks and pitfalls:** unbounded memory, orphaned jobs, links that outlive permissions.
**Likely follow-ups:** "how do you resume after a crash?" (job state in the DB, idempotent steps).
**In this project:** the transaction flow itself follows this shape (`202` + status resource).

### Q80. How do you version and document an API for several internal consumers?
**Short answer:** URI version, generated and committed OpenAPI, examples from the real system, changelog and deprecation policy.
**Reasoning and implementation:** springdoc generates the contract from code (so it cannot lie), the file is committed and checked in CI, examples are captured from a live run (`docs/api/examples.md`), Postman/`.http` collections are provided, breaking changes require a new version.
**Alternatives and trade-offs:** design-first (write OpenAPI, generate server stubs) - better for cross-team negotiation, needs discipline to keep code in sync.
**Risks and pitfalls:** hand-written docs that drift; undocumented error codes.
**Likely follow-ups:** "code-first or design-first?"
**In this project:** `specs/openapi.json`, `scripts/capture-api-examples.mjs`, `tests/api`.
