# API design rules

1. Resource-oriented URLs, plural nouns, UUID ids; command sub-resources only for non-CRUD state changes (`/approve`, `/cancel`).
2. Status codes: `201` created, `202` accepted for async work, `400` malformed/validation, `401` unauthenticated, `403` wrong role, `404` not found **or not yours**, `409` state/uniqueness/concurrency conflict, `413`, `415`, `422` valid request violating a business rule, `429`, `503` retryable lock timeout, `500` generic.
3. Every error uses the envelope `{timestamp,status,code,message,path,correlationId,violations?,details?}`; `code` is stable and documented; `message` is client-safe.
4. Requests/responses are DTO records with Bean Validation; unknown fields are rejected; money is a string; instants are ISO-8601 UTC.
5. Collections: `page`/`size` (cap 100), `sort` from a per-resource whitelist with an `id` tie-break; filters are explicit parameters; envelope `{items,page,size,totalElements,totalPages}`.
6. State-creating `POST`s require `Idempotency-Key`; replay returns the original outcome with `Idempotent-Replayed: true`; same key + different payload -> `422`.
7. Authorization: `@PreAuthorize` role rule **and** `AccessPolicy` object rule; foreign objects -> `404` + audit; mask PII per role.
8. Versioning: `/api/v1`; only additive changes inside a version; breaking change -> `/api/v2` + deprecation headers + side-by-side period.
9. Contract: regenerate `specs/openapi.json` (`mvn verify -DargLine=-Dopenapi.update=true`) and commit it; `ApiContractIT` and CI fail on drift.
10. Rate limits, body limits and timeouts are part of the API's behaviour and documented.
