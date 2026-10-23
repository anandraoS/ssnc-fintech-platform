# Investment Operations Console: React edition

The React 19 edition of the operations dashboard and customer portal. It talks to the **same backend and the same REST contract** as the Angular edition in `../frontend`, with the same screens, texts and security behaviour. Synthetic data only.

Architecture, the Angular-to-React mapping, design notes and verification results: [docs/architecture/12-react-frontend.md](../docs/architecture/12-react-frontend.md). Decision record: [ADR-013](../docs/decisions/ADR-013-two-frontends-one-contract.md).

## Commands

```bash
npm ci
npm run dev        # http://localhost:4281, /api proxied to http://localhost:18480 (start the backend with scripts/run-local.sh)
npm test           # Vitest + Testing Library (90 tests)
npx tsc --noEmit   # strict type-check
npm run lint       # ESLint: typescript-eslint, react-hooks, jsx-a11y
npm run build      # production bundle in dist/
```

Production-like run (static files plus the same `/api` proxy as the nginx image) and the browser end-to-end suite:

```bash
node ../scripts/serve-frontend.mjs --port 4281 --dir frontend-react/dist
node ../tests/e2e/ui-e2e.mjs --flavor react
```

Docker image: `infrastructure/docker/frontend-react.Dockerfile` (unprivileged nginx, same `nginx.conf` as the Angular image); Compose profile `react`.

## Layout

```
src/
  core/        http.ts (fetch wrapper), api.ts (typed facade), auth.tsx (session, guards), useAsync.ts, models.ts, idempotency.ts
  shared/      format.ts (money/date), components.tsx (StateView, StatusChip, Pager, SortHeader, TransactionTable, Field)
  features/    Login, Shell, Home (dashboard + portfolio), Accounts (+ detail), Transactions, TransactionNew, TransactionDetail,
               Customers, Investigations, Audit, NotFound
  testing/     FakeApi (scripted backend), renderApp()
```

## Rules this app follows

* Money is a string end to end; display formatting never converts it to a number.
* The access token lives in memory only; it is sent only to `/api/` and never to the login call.
* The server decides authorization; roles only shape navigation.
* Submissions carry an `Idempotency-Key` that is reused for an unchanged payload and reset after a definitive outcome.
* No `dangerouslySetInnerHTML`, no secrets in the bundle, no third-party origins.
