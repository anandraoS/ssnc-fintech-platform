# ADR-013: Two frontends, one API contract

**Status:** accepted

## Context

The platform was built with an Angular 20 console. Teams and candidates also work with React, and the same REST API should be usable from either without changing the backend. The risk is drift: two frontends that slowly disagree about the API, about security behaviour, or about how a user-visible rule is worded.

## Decision

Add a React 19 console (`frontend-react/`) next to the Angular one and keep them aligned by construction:

* the API contract types (`core/models.ts`) and the idempotency-key class are the same source in both projects;
* both implement the same security behaviours (in-memory token, bearer on `/api/` only, correlation id, 401 ends the session, validated `returnUrl`);
* one browser end-to-end suite (`tests/e2e/ui-e2e.mjs --flavor angular|react`) drives both against the real backend, so any behavioural difference fails a test;
* the backend is unchanged, and so is its CORS allow-list: each edition is served same-origin behind a proxy that preserves the `Host` header (nginx in the images, `scripts/serve-frontend.mjs` and the Vite proxy locally).

## Alternatives considered

* **One frontend only.** Simplest to maintain; does not serve a team that works in React.
* **Shared UI library or micro-frontends.** Overkill for ten screens and would couple the editions through a build system.
* **Generate both clients from `openapi.json`.** The right next step once the API grows; today the hand-written types are 180 lines and are checked by the end-to-end suite and the backend's `ApiContractIT`.
* **Weaken CORS (a wildcard) or add the new origin to the allow-list to make the second UI work.** Rejected: the UI is same-origin behind the proxy. The first browser run answered 403 because a proxy rewrote the `Host` header; that was fixed instead (threat T13 stays untouched).

## Consequences

* Every UI change is made twice. The shared end-to-end suite and the identical wording keep the cost visible.
* A new endpoint or field needs the type changed in two places until the types are generated.
* The React edition has fewer dependencies (3 runtime) and a smaller initial bundle; the Angular edition has a batteries-included component library. Neither is "better": the choice is organisational.
* Deployment gets a second image, never a second backend.
