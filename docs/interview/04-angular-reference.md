# Angular reference

## Components, templates and change detection

*Analogy:* a component is a Lego brick: it takes inputs (what you plug into it), emits outputs (what it tells you), and hides its own studs.

* **Standalone components** (no NgModules): `@Component({ imports: [...] })`; `input()`, `output()`, `model()`; `@if/@for/@switch/@defer` control flow; `track` in `@for` (identity for DOM reuse).
* **Change detection:** Default checks the whole tree on every event; **OnPush** checks a component only when an input reference changes, an event originates inside it, a signal it reads changes, or `markForCheck` is called. With signals and OnPush, updates are fine-grained. Zone.js patches async APIs to trigger detection; zoneless is the direction of travel.
* **Lifecycle:** constructor (inject), `ngOnInit`/`effect`, `ngOnChanges`, `ngOnDestroy`; prefer `takeUntilDestroyed()`/`DestroyRef` over manual unsubscribe.

## Services and dependency injection

Hierarchical injectors (root, route, component); `providedIn: 'root'` tree-shakable singletons; `inject()` function; injection tokens for configuration; functional interceptors/guards use `inject` too. Testing: `TestBed.configureTestingModule({ providers })`, overriding providers, `HttpTestingController`.

## RxJS

*Analogy:* an Observable is a conveyor belt of values over time; operators are stations that transform, filter or merge the belt.
* Cold (HTTP, creates work per subscription) vs hot (shared); `shareReplay`, `share`. **Flattening:** `switchMap` (cancel previous - search-as-you-type, route params), `mergeMap` (parallel), `concatMap` (ordered queue), `exhaustMap` (ignore while busy - submit buttons). Combination: `combineLatest`, `forkJoin` (all complete; **cancels siblings on first error** - seen in the dashboard tests), `merge`.
* Errors: `catchError`, `retry` (only idempotent), `finalize`. Avoid nested subscribes; avoid subscribing in templates when `async`/signals do it; `toSignal`/`toObservable` bridge worlds.
* HTTP-specific: cancellation by unsubscribe (cancels the XHR), timeouts (`timeout`), polling (`timer`/`interval` + `switchMap`).

## Signals

`signal(value)` (writable), `computed(() => ...)` (lazy, memoised, tracks dependencies automatically), `effect(() => ...)` (side effects; use sparingly), `input()`/`model()`. Signals give synchronous, glitch-free derived state and precise change detection; keep RxJS for async streams and convert at the edge (`toSignal`). Mutation: `set`/`update` with new references (immutable updates).
**Project use:** view state (`loading/error/rows`), `computed` `viewState` from three signals, role flags in `AuthService`, form value -> signal via `toSignal(valueChanges)`.

## Reactive forms

Typed `FormGroup/FormControl`, `FormBuilder.nonNullable`, sync/async validators, cross-field validators on the group (`transactionShapeValidator`), `statusChanges/valueChanges`, `markAllAsTouched` on submit, disabled-while-pending buttons, error display after touch, accessible errors (`mat-error`, `role="alert"`), `patchValue` vs `setValue`. Server-side errors mapped back to fields (the error envelope's `violations[]`).

## Routing

Lazy `loadComponent`; functional `CanActivateFn` guards; route `data`/`title`/`resolve`; `withComponentInputBinding()` binds route/query params to component `input()`s (used for `id` and `?tab=`); `returnUrl` handling (validate as an in-app path); preloading strategies; nested routes with a shell.

## HTTP interceptors

Functional `HttpInterceptorFn`; **order matters** (the outermost sees the final error); cross-cutting only (auth header, correlation id, error normalisation, retry for idempotent GETs, loading indicators); attach tokens only to your own API origin; clone requests (immutable); handle 401 (sign out/redirect) once.

## Performance

OnPush + signals; `track`; lazy routes/`@defer`; bundle budgets; avoid heavy template functions (use `computed`/pure pipes); virtual scrolling for big lists; image optimisation; HTTP caching/`shareReplay`; avoid polling storms (visible-tab only); measure with Angular DevTools and Lighthouse.

## Testing

Karma/Jasmine (or Jest/Vitest): `TestBed`, `ComponentFixture`, `fakeAsync/tick`, `HttpTestingController` (`expectOne`, `flush`, `match`), spies, `input` setting via `fixture.componentRef.setInput`; test behaviour users see; page-level journeys with an e2e tool (here puppeteer-core; Playwright/Cypress in teams). **Gotchas seen here:** `forkJoin` cancels siblings on the first error (tests must flush only the failing request); `TestBed` can be configured once per test; periodic timers must be torn down (`fixture.destroy()`).

## Secure frontend practices

No `innerHTML`/`bypassSecurityTrust*`; Angular sanitises by default; strict CSP and Trusted Types where possible; token in memory (or HttpOnly cookie via BFF); same-origin API proxy; validate redirect targets; avoid secrets in the bundle; dependency hygiene (`npm audit`); don't trust client-side validation or role checks (server enforces); handle money as strings; avoid leaking data in URLs/logs.
