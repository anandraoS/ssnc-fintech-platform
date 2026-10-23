# Angular coding standards

* Angular 20, standalone components, `OnPush`, signals for state (`signal`, `computed`, `effect` sparingly), `input()`/`output()` functions, `inject()`; Reactive Forms with typed controls; RxJS for HTTP/streams (`takeUntilDestroyed`, `switchMap`; no nested subscribes).
* TypeScript `strict`; no `any` (ESLint enforces); explicit return types on public methods; models in `core/models.ts` mirror the OpenAPI contract.
* **Templates:** `@if/@for/@switch` control flow; `track` expressions on every `@for`; labels for every control; `aria-*` where semantics are not native; status never by colour alone; keyboard operable.
* **State views:** loading / error (retry) / empty / ready for every data view via `app-state-view`.
* **HTTP:** only through `ApiService`; interceptors for auth, correlation id, error normalisation; handle `ApiProblem` (never `HttpErrorResponse`) in components.
* **Money:** strings only; no arithmetic; `MoneyPipe` for display.
* **Security:** token in memory; no `innerHTML`/`bypassSecurityTrust*`; validate `returnUrl` as an in-app path; UI role checks are UX, the API decides.
* **Routing:** lazy `loadComponent`; guards via functional `CanActivateFn`; route `data.roles`.
* **Tests:** each service/interceptor/guard/component gets a spec; HTTP via `HttpTestingController`; assert behaviour users see (text, roles, requests), not private fields; no real timers (use `fakeAsync` or inject schedulers).
* **Performance:** `OnPush`, pure pipes, avoid function calls in templates for heavy work (use `computed`), keep bundles small (budgets enforced in `angular.json`).
