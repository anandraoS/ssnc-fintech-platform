# Questions: React frontend edition

### Q135. The same API has an Angular and a React client. What is identical, what differs, and how do you keep them from drifting?
**Short answer:** the contract, the security behaviour and the wording are identical; the component model, state handling and tooling differ; a single end-to-end suite that drives both is what prevents drift.
**Reasoning and implementation:** both projects use the same `core/models.ts` (money as strings, `ApiProblem` error shape) and the same `IdempotencyKeys`; both keep the token in memory, add the bearer token to `/api/` calls only, tag calls with a correlation id and end the session on a 401. The React edition replaces signals with hooks, interceptors with one `createHttp()` wrapper, guards with `RequireAuth`/`RequireRole`, and Material with native controls. `tests/e2e/ui-e2e.mjs --flavor angular|react` runs the same 19 checks against each.
**Alternatives and trade-offs:** generate both clients from `openapi.json` (best once the API grows), a shared UI kit (couples the builds), a single frontend (no drift, less reach).
**Risks and pitfalls:** fixing a bug in one edition only; types that diverge silently; wording differences that make the shared test brittle.
**Likely follow-ups:** "why not share a package between the two?" (different compilers and component models; the shared part is 180 lines of types).
**In this project:** `docs/architecture/12-react-frontend.md`, ADR-013.

### Q136. [Scenario] A list page shows the wrong rows after the user changes a filter twice quickly. What is happening and how do you fix it in React?
**Short answer:** an older request finished after a newer one and overwrote its result; ignore any response that no longer matches the current inputs.
**Reasoning and implementation:** each `useEffect` run starts a request; responses can arrive out of order. `useAsync` sets a `cancelled` flag in the effect cleanup and drops results when it is set, so only the latest inputs can update state. `AbortController` additionally cancels the network request itself. The Angular edition gets the same effect from `switchMap`.
**Alternatives and trade-offs:** `AbortController` plus the flag (cancels the work, slightly more code), React Query or SWR (handle this and caching, add a dependency), debouncing the filter (reduces requests, does not fix ordering).
**Risks and pitfalls:** forgetting the cleanup, which also causes state updates after unmount; putting unstable objects in the dependency array so the effect re-runs every render.
**Likely follow-ups:** "what does StrictMode do to effects?" (runs setup, cleanup, setup in development to expose exactly this bug).
**In this project:** `core/useAsync.ts`; the accounts, transactions, customers and audit pages.

### Q137. Where does the React app keep the access token and why not `localStorage`?
**Short answer:** in memory (React state and a ref inside the auth provider), so script injected through XSS cannot read it from storage and it disappears with the tab.
**Reasoning and implementation:** `AuthProvider` holds the session; `createHttp()` reads the token through a getter on every request and checks expiry; a timer ends the session when the token expires. A unit test asserts that nothing is written to `localStorage` or `sessionStorage`. Cost: a reload requires signing in again.
**Alternatives and trade-offs:** HttpOnly, SameSite cookies through a backend-for-frontend (best; needs CSRF protection and a BFF), authorization-code with PKCE and silent renewal, `sessionStorage` (survives reload, readable by XSS).
**Risks and pitfalls:** logging tokens, putting them in URLs, assuming memory storage stops XSS (it limits theft, it does not stop actions performed inside the page).
**Likely follow-ups:** "how would you add silent renewal?" (BFF or PKCE with refresh-token rotation).
**In this project:** `core/auth.tsx`, `core.test.tsx` ("keeps the token in memory only").

### Q138. Which `useEffect` mistakes matter most, and where does this code avoid them?
**Short answer:** missing or unstable dependencies, effects used for derived data, no cleanup for timers and requests, and unconditional work that should be an event handler.
**Reasoning and implementation:** derived values (the status bars, the currency of the selected account) are computed during render, not stored through an effect. The dashboard's 15-second refresh creates its timer in an effect and clears it in the cleanup. Loading goes through `useAsync`, which owns the dependency handling in one place; the two intentional exceptions carry a comment explaining why the lint rule is disabled.
**Alternatives and trade-offs:** a data-fetching library, `useSyncExternalStore` for external stores, the React compiler to remove manual memoisation.
**Risks and pitfalls:** objects and functions recreated each render in a dependency list (infinite loops), stale closures, effects that set state which re-triggers the same effect.
**Likely follow-ups:** "when is `useMemo` worth it?" (measured cost, or to keep a referentially stable dependency).
**In this project:** `Home.tsx` (dashboard timer), `useAsync.ts`, `eslint.config.js` (`react-hooks/exhaustive-deps` as an error).

### Q139. [Scenario] A user double-clicks "Submit transaction" on a slow network. Disabling the button did not prevent two requests in the React form. Why, and what is the complete fix?
**Short answer:** `setBusy(true)` is asynchronous, so two clicks in the same tick both read `busy === false`; guard with a ref and make the request idempotent.
**Reasoning and implementation:** the handler checks `inFlight.current` (a ref updates synchronously) as well as the `busy` state, and sets the ref before awaiting. Independently, the request carries an `Idempotency-Key` that is reused for an unchanged payload, so even a retry after a timeout cannot create a second transaction; the server returns the original result with `Idempotent-Replayed: true`. A test double-clicks while the response is held back and asserts that exactly one POST was made.
**Alternatives and trade-offs:** disabling only (insufficient), debouncing the click (hides the symptom), a request deduplication layer in the HTTP wrapper (reasonable, but the server is the real authority).
**Risks and pitfalls:** resetting the key on an unknown failure (breaks the guarantee); resetting the ref in the wrong place.
**Likely follow-ups:** "what if the user edits the amount between retries?" (new payload, new key).
**In this project:** `features/TransactionNew.tsx`, `TransactionNew.test.tsx` ("disables the button while a request is in flight").

### Q140. How are the React components tested, and what is faked?
**Short answer:** Vitest and Testing Library render the real application and drive it as a user would; only the network is faked, by a scripted `fetch`.
**Reasoning and implementation:** `FakeApi` records every request and answers from handlers keyed by `METHOD /path`, so tests assert on what the app sent (headers, query, body) and on what the user sees. Queries are by role and label (`getByRole('button', …)`, `getByLabelText`), which also proves accessibility labels exist. Sign-in goes through the real login call, so the auth provider, guards and routing are exercised together. 90 tests cover the HTTP client, auth, guards, every page and the validation rules.
**Alternatives and trade-offs:** mocking modules (faster, tests the mock), MSW (a service worker intercepts real `fetch`; more realistic, more setup), Cypress or Playwright component tests (real browser, slower).
**Risks and pitfalls:** asserting on implementation details, `act` warnings from unawaited updates, fake timers that never advance.
**Likely follow-ups:** "what does the end-to-end suite add?" (the real backend, the real bundle and CORS; it found the 403 caused by a proxy that rewrote the `Host` header).
**In this project:** `src/testing/helpers.tsx`, `core/core.test.tsx`, `features/*.test.tsx`.

### Q141. [Scenario] You add the React UI on port 4281 and every sign-in returns 403 although the credentials are right. What is the cause and the safe fix?
**Short answer:** the API treated the request as cross-origin from an origin that is not on its CORS allow-list; make the request genuinely same-origin by preserving `Host` in the proxy, rather than loosening the allow-list.
**Reasoning and implementation:** the 403 was a plain-text rejection from the CORS layer, not the JSON error the API returns for a bad login (a wrong password gives a JSON 401). Browsers send `Origin` on every POST; the API compares it with the request's `Host`. The development proxy had rewritten `Host` to the API's host, so `Origin: http://localhost:4281` no longer matched and 4281 was not allow-listed (default: only 4280). Fix: pass `Host` through, as nginx does (`proxy_set_header Host $host`). Verified: both UIs sign in and pass the same 19 browser checks with the default CORS settings, and a wrong password still shows the generic 401 message.
**Alternatives and trade-offs:** add `http://localhost:4281` to `CORS_ALLOWED_ORIGINS` (explicit and safe, but widens a security control for a same-origin setup); a wildcard origin (rejected: removes the control, and cannot be combined with credentials).
**Risks and pitfalls:** allow-listing `null` or a wildcard to "make it work"; `changeOrigin: true` in a dev proxy silently changing `Host`; trusting forwarded headers without a trusted-proxy list.
**Likely follow-ups:** "why does a same-origin POST send an Origin header at all?" (browsers add it to every non-GET request; the server decides cross-origin by comparing it with its own view of the host).
**In this project:** `docs/architecture/12-react-frontend.md`, `scripts/serve-frontend.mjs`, `SecurityIT.cors`, threat T13.

### Q142. How do you keep a React bundle small, and what does this one weigh?
**Short answer:** few dependencies, code-split routes, no UI framework you do not need, and measure with the build output.
**Reasoning and implementation:** three runtime dependencies (React, React DOM, React Router); each page is a `lazy()` chunk of 3 to 9 kB; the main chunk is about 279 kB (89 kB gzip) including React and the router; native form controls and plain CSS avoid a component library. The Angular edition's initial bundle is about 341 kB. Memoisation was not added because nothing measured slow.
**Alternatives and trade-offs:** preact-compat (smaller, compatibility risk), server-side rendering (faster first paint, needs a Node tier), a component library (productivity, weight).
**Risks and pitfalls:** barrel imports that defeat tree shaking, importing a whole date or charting library for one function, optimising without measuring.
**Likely follow-ups:** "how do you find what is in the bundle?" (a bundle visualiser, `vite build` size report).
**In this project:** `frontend-react/vite.config.ts`, `App.tsx` (lazy routes).
