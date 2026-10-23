# React frontend edition

The platform ships **two interchangeable user interfaces** for the same REST API: the Angular 20 console in `frontend/` and a React 19 console in `frontend-react/`. Neither needs any backend change: both speak the contract in `specs/openapi.json` (the TypeScript types in `core/models.ts` are identical, character for character, in both projects).

| | Angular edition | React edition |
|---|---|---|
| Folder | `frontend/` | `frontend-react/` |
| Stack | Angular 20.3, Angular Material 20.2, RxJS, signals, standalone components | React 19.3, React Router 7.18, Vite 8, TypeScript 5.9, plain CSS |
| State | signals + `computed` | `useState` / `useRef` / `useMemo`, one `useAsync` hook for loading |
| HTTP | `HttpClient` + three interceptors | `fetch` behind `createHttp()` (same three behaviours) |
| Forms | reactive forms | controlled inputs and pure validation functions |
| Route protection | `authGuard`, `roleGuard` | `<RequireAuth>`, `<RequireRole>` |
| Unit tests | Karma + Jasmine, 58 specs | Vitest + Testing Library, 90 tests |
| Default port | 4280 | 4281 |
| Initial JavaScript | about 341 kB | about 279 kB (89 kB gzip), plus lazy route chunks of 3 to 9 kB |

## What is deliberately identical

* **Contract and money handling.** Amounts are strings end to end; `formatMoney` is string manipulation only, never a floating-point number.
* **Security behaviour.** Access token held in memory only (never in web storage), bearer token on `/api/` calls except the login call, a fresh `X-Correlation-Id` on every API call, 401 on a protected call ends the session and returns to the login page with a validated `returnUrl` (no open redirect), roles shape navigation only (the server decides).
* **Idempotency.** `IdempotencyKeys` is the same class: one key per logical payload, reused on retry after an unknown outcome, reset after a definitive outcome (accepted or business-rejected).
* **Screens and wording.** The same ten screens with the same texts, so one browser end-to-end suite drives both (`tests/e2e/ui-e2e.mjs --flavor angular|react`; only the control selectors differ).
* **Error model.** Every failure becomes an `ApiProblem` (`status`, `code`, `message`, `violations`, `details`, `correlationId`); components never see raw HTTP errors.

## Mapping of concepts

| Angular | React edition |
|---|---|
| `AuthService` (signals) | `AuthProvider` + `useAuth()` in `core/auth.tsx` |
| `ApiService` | `createApi(http)` in `core/api.ts`, reached through `useApi()` |
| `authInterceptor`, `correlationInterceptor`, `errorInterceptor` | `createHttp()` in `core/http.ts` |
| `authGuard`, `roleGuard` | `RequireAuth`, `RequireRole` |
| `app-state-view` | `StateView` (loading, error with retry, empty, content) |
| `app-status-chip` | `StatusChip` |
| `MoneyPipe` | `formatMoney()` in `shared/format.ts` |
| `mat-table`, `matSort`, `mat-paginator` | semantic `<table>`, `SortHeader`, `Pager` (asc, desc, none; server-side paging) |
| `mat-select`, `mat-form-field` | native `<select>`, `Field` (label, hint and error linked for assistive technology) |
| `forkJoin` | `Promise.all` inside `useAsync` |
| `interval()` with `takeUntilDestroyed` | `setInterval` cleaned up in the effect (dashboard refresh every 15 s, skipped while the tab is hidden) |
| route `title` | `useTitle()` |
| `withComponentInputBinding` (query parameters to inputs) | `useSearchParams()` |

## Design notes

* **`useAsync(loader, deps)`** runs the loader when `deps` change and ignores any result that arrives after the inputs changed or the component unmounted, so a slow earlier response can never overwrite a newer one. It keeps the previous data on screen during a reload and exposes `error`, `errorStatus` and `reload`.
* **No state library.** Server state is page-local and short-lived; the only shared state is the session, held by one context provider. React Query would add caching and deduplication, which this console does not need yet.
* **Double submit.** Disabling the button is not enough, because `setBusy(true)` is asynchronous: two clicks in the same tick both see `busy === false`. The form also guards with a ref (`inFlight`) and relies on the server-side idempotency key, exactly like the Angular form.
* **Native form controls.** The React edition uses native `<select>` and inputs styled with plain CSS. They are accessible by default, need no component library and keep the dependency tree small (3 runtime dependencies).
* **Code splitting.** Each page is a `lazy()` route chunk behind one `Suspense` boundary; the shell and the sign-in page stay in the main bundle.
* **`noValidate` on every form.** Validation messages come from the app (linked with `aria-describedby`), not from the browser's native bubbles, so both editions show identical messages.

## Running it

```bash
cd frontend-react
npm ci
npm run dev              # http://localhost:4281, /api proxied to http://localhost:18480
npm test                 # Vitest + Testing Library
npm run lint && npm run build
```

Against the production bundle (static files plus the same `/api` proxy the Angular edition uses):

```bash
node scripts/serve-frontend.mjs --port 4281 --dir frontend-react/dist
node tests/e2e/ui-e2e.mjs --flavor react
```

## CORS and same-origin proxying (a finding from the first browser run)

The first browser run of the React edition on port 4281 was answered with **403 Forbidden** on the sign-in call. Cause: the development proxy (`scripts/serve-frontend.mjs`) rewrote the `Host` header to the API's own host, so the API saw `Origin: http://localhost:4281` against `Host: localhost:18480`: a cross-origin request from an origin that is not on the allow-list (`CORS_ALLOWED_ORIGINS`, default `http://localhost:4280`, no wildcard).

Options, safest first:

1. **Preserve the `Host` header in the proxy (chosen).** The request is then same-origin for the API, exactly as behind the nginx image (`proxy_set_header Host $host`). No security setting changes. Applied to `scripts/serve-frontend.mjs` and to the Vite dev proxy (`changeOrigin: false`).
2. Add the origin explicitly: `CORS_ALLOWED_ORIGINS="http://localhost:4280,http://localhost:4281"`. Safe, but widens the allow-list for something that is not really cross-origin.
3. A wildcard origin. Rejected: it removes a security control (threat T13).

After the fix both editions sign in and pass the browser suite with the **default, unchanged** CORS configuration. Behind nginx (Docker Compose, Kubernetes) the same-origin proxy already works for either image, so no CORS entry is needed there either.

## Verification (executed on the final code)

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`, strict) | clean |
| ESLint (typescript-eslint, react-hooks, jsx-a11y) | clean |
| Unit and component tests | 90 of 90 passed |
| Production build | OK, 279 kB main chunk (89 kB gzip) |
| Browser end-to-end against the real backend (headless Edge) | 19 of 19 passed (`docs/validation/ui-e2e-results-react.json`) |
| Same suite against the Angular edition, same backend, same run | 19 of 19 passed |
| API end-to-end (backend only) | 50 of 50 |

Not done for the React edition: Docker image build and Compose run (Docker is not installed here), cross-browser testing (Edge only), automated visual regression and accessibility audit beyond static lint rules.
