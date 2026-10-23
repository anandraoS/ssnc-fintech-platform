# ADR-007: URI versioning, strict input, committed OpenAPI contract

* **Status:** accepted

## Context
Several internal applications will consume the API and cannot all upgrade together.

## Decision
Version in the URI (`/api/v1`); within a major version only non-breaking changes (add optional fields/endpoints/error codes). Money as strings, scale per currency. Strict input
(`FAIL_ON_UNKNOWN_PROPERTIES`) because the API is the system of record; clients are tolerant readers. The OpenAPI document is generated from the running app, committed
(`specs/openapi.json`) and compared in `ApiContractIT` and in CI (`git diff --exit-code`).

## Alternatives
Header / media-type versioning (cleaner URIs, harder to route, test and see in logs); date-based versions (Stripe style: powerful, needs per-account pinning machinery);
GraphQL (different trade-offs, not requested).

## Consequences
+ a breaking change is a visible, reviewed diff; versions run side by side; easy cache/gateway routing;
- strict input means a client that sends an extra field gets a 400 (deliberate; documented);
- deprecation requires process (headers, usage metrics, sunset date) - written in the API chapter.
