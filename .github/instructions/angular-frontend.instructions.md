---
applyTo: "frontend/src/**/*.{ts,html,scss}"
---
Follow `ai-engineering/context/angular-standards.md`.
- Standalone components, `ChangeDetectionStrategy.OnPush`, signals (`signal`, `computed`, `input()`), `inject()`; no `any`; strict templates.
- Every data view uses `<app-state-view>` for loading / error (with retry) / empty / ready. Forms are typed Reactive Forms with visible labels and announced errors.
- Money is a **string** end to end; no arithmetic on it in TypeScript; format with `MoneyPipe`.
- The access token stays in memory (`AuthService`); never use `localStorage`/`sessionStorage`, `innerHTML` or `bypassSecurityTrust*`.
- HTTP goes through `ApiService`; new calls get a spec using `HttpTestingController`; role-aware UI is a convenience, never the enforcement.
