# ADR-012: Access token held in memory only in the SPA

* **Status:** accepted (with a documented production follow-up)

## Context
Browser storage is readable by any script that runs in the page; a single XSS would exfiltrate a token from `localStorage`/`sessionStorage`.

## Decision
Keep the access token in a signal inside `AuthService` (memory only); attach it only to `/api/` requests; strict CSP, no `innerHTML`, Angular sanitisation left on; sign out on 401.

## Alternatives
`localStorage`/`sessionStorage` (convenient, XSS-readable); HttpOnly cookie via a backend-for-frontend (best practice for browsers, needs a BFF and CSRF protection); service-worker token handling.

## Consequences
+ nothing to steal from storage; the token dies with the tab; trivially testable (a unit test asserts storage stays empty);
- a page reload needs a new sign-in (acceptable for a back-office tool; the production answer is authorization-code + PKCE with silent renewal or a BFF).
