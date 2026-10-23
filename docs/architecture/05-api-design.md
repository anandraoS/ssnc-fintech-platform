# REST API design

The contract is machine-readable in [`specs/openapi.json`](../../specs/openapi.json) (generated from the running application by
springdoc and checked into the repository; `ApiContractIT` fails the build when code and contract drift apart). Real
request/response pairs captured from the running system are in `docs/api/examples.md`.

## Resource model and endpoints

| Resource | Endpoints (all under `/api/v1`) | Roles |
|---|---|---|
| Identity | `GET /me`; `POST /auth/token` (**local profile only**) | any authenticated; anonymous for login |
| Customers | `POST /customers`, `GET /customers`, `GET /customers/{id}`, `PATCH /customers/{id}`, `POST /customers/{id}/suspend`, `POST /customers/{id}/reactivate` | create/update: operations, admin; list: staff; get: staff or the customer themself; suspend: admin |
| Accounts | `POST /customers/{customerId}/accounts`, `GET /accounts`, `GET /accounts/{id}`, `GET /accounts/{id}/balance`, `POST /accounts/{id}/activate`, `.../suspend`, `.../close` | search/get/balance: owner or staff; lifecycle: operations/admin (close: admin) |
| Transactions | `POST /transactions`, `GET /transactions`, `GET /transactions/{id}`, `GET /accounts/{id}/transactions`, `POST /transactions/{id}/cancel`, `.../approve`, `.../reject`, `GET /transactions/{id}/attempts`, `GET /transactions/{id}/audit` | submit: customer (own accounts), operations, admin; approve/reject: a *different* operator or admin; attempts/audit: staff |
| Operations | `GET /ops/summary`, `/ops/health`, `/ops/audit-events`, `/ops/reconciliations`, `POST /ops/reconciliations/{id}/resolve`, `GET /ops/ledger-integrity`, `GET /ops/accounts/{id}/ledger`, `GET /ops/outbox`, `POST /ops/outbox/{id}/requeue`, `POST /ops/processing/drain` | staff; resolve: operations/admin; outbox/drain: admin |
| Platform | `/actuator/health/{liveness,readiness}`, `/actuator/prometheus` (management port in containers) | probes / Prometheus |

Design rules applied: resource-oriented nouns (`/accounts/{id}/transactions`), verbs only for state-changing *commands* that are
not CRUD (`/approve`, `/cancel`, `/activate`), plural collection names, UUID identifiers (not guessable sequential ids), DTOs
everywhere (entities are never serialised), unknown JSON properties rejected (mass-assignment defence).

## HTTP semantics and status codes

| Situation | Status | `code` |
|---|---|---|
| created resource (`POST` customer/account) | `201` + `Location` | - |
| transaction accepted for asynchronous processing | `202` + `Location` | - |
| business rejection of a *valid* request (transaction persisted as `REJECTED`) | `422` | `TRANSACTION_REJECTED` (+ `details.failureCode`) |
| malformed JSON / missing header / type mismatch / bean-validation failure | `400` | `MALFORMED_REQUEST`, `IDEMPOTENCY_KEY_REQUIRED`, `INVALID_PARAMETER`, `VALIDATION_ERROR` (+ `violations[]`) |
| unauthenticated / bad or expired token | `401` + `WWW-Authenticate: Bearer` | `UNAUTHENTICATED`, `INVALID_TOKEN` |
| authenticated but wrong role / maker-checker violation | `403` | `ACCESS_DENIED`, `MAKER_CHECKER_VIOLATION`, `TRANSACTION_NOT_PERMITTED` |
| not found **or not yours** (object-level authorization) | `404` | `ACCOUNT_NOT_FOUND`, `TRANSACTION_NOT_FOUND`, ... |
| state conflict, duplicate natural key, concurrent modification | `409` | `INVALID_STATE_TRANSITION`, `DUPLICATE_EMAIL`, `CONCURRENT_MODIFICATION` |
| semantic error on an otherwise valid request (idempotency key reuse, unsupported combination) | `422` | `IDEMPOTENCY_KEY_REUSED`, ... |
| body too large | `413` | `PAYLOAD_TOO_LARGE` |
| unsupported method / media type | `405` / `415` | `METHOD_NOT_ALLOWED`, `UNSUPPORTED_MEDIA_TYPE` |
| rate limited | `429` + `Retry-After` | `RATE_LIMITED` |
| lock wait timed out (retryable) | `503` + `Retry-After: 1` | `LOCK_TIMEOUT` |
| unexpected failure | `500` | `INTERNAL_ERROR` (generic message + correlation id only) |

**Why 404 and not 403 for someone else's object?** A `403` confirms the record exists. The platform answers `404` for objects
the caller may not see (and writes an `ACCESS_DENIED` audit event) so ids cannot be enumerated (OWASP API1). Role failures are
`403` because the endpoint's existence is not secret.

## The error envelope

Every non-2xx response has the same shape, produced by `GlobalExceptionHandler` (and by `ErrorResponses` for filter-level errors):

```json
{
  "timestamp": "2026-10-18T12:00:00Z",
  "status": 400,
  "code": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "path": "/api/v1/transactions",
  "correlationId": "7f3c1e52-...",
  "violations": [ { "field": "amount", "message": "must be greater than zero" } ],
  "details": { }
}
```

`message` never contains stack traces, SQL, class names or the offending payload (`ServerErrorIT` throws an exception carrying a
fake JDBC URL and password and asserts none of it reaches the client).

## Pagination, filtering, sorting

`?page=0&size=20&sort=createdAt,desc` on every collection. `size` is capped at 100 (`spring.data.web.pageable.max-page-size`);
`sort` accepts a **whitelist** per resource (`PageableSupport.restrictSort`) and a deterministic tie-break on `id` is appended, so
paging is stable and clients cannot sort by internal columns or trigger unindexed sorts. Responses use a stable envelope
(`items, page, size, totalElements, totalPages`) instead of leaking Spring Data's `Page` JSON. Transaction search filters:
`status` (repeatable), `type`, `accountId`, `reference`, `from`, `to`, `minAmount`, `maxAmount`, `currency`. For very deep
histories the documented evolution is keyset pagination (`created_at, id`) - offset paging is O(offset).

## Idempotency, correlation, limits

* `POST /transactions` **requires** `Idempotency-Key` (8-80 characters of `[A-Za-z0-9._:-]`). See the integrity chapter.
* `X-Correlation-Id` is accepted if it is a safe token (`[A-Za-z0-9._-]{8,64}`, which blocks log injection) or generated, put in the
  logging MDC, echoed on the response and stored in audit rows. `X-API-Version: 1` is returned on every response.
* Request bodies larger than 64 KB are rejected before parsing (`RequestSizeLimitFilter`, counts bytes for chunked bodies too).
* Rate limiting: token bucket per authenticated subject (240/min default) and, much stricter, per client address for login
  (10/min). In-memory per instance; the production substitute is a shared store or the API gateway (threat model).

## Versioning and backward compatibility

* **URI versioning** (`/api/v1`): simple, cache- and gateway-friendly, visible in logs. Alternatives (header/media-type
  versioning) are more "pure" but harder to test by hand and to route.
* **Compatibility rules** (a change is *non-breaking* if clients written against v1 keep working):
  *allowed in v1:* add optional request fields, add response fields, add endpoints, add new enum values **only where clients are told to
  tolerate unknown values**, add new error codes; *breaking (needs v2):* remove or rename a field, change a type or the meaning/scale of a
  value, make an optional field required, tighten validation that rejects previously valid input, change status codes of existing flows.
* **Tolerant reader:** the SPA ignores unknown fields; the API itself is *strict* on input (`FAIL_ON_UNKNOWN_PROPERTIES`) because
  it is the system of record - the asymmetry is deliberate (be liberal in what you accept only when ambiguity cannot cost money).
* **Contract tests:** `ApiContractIT` compares the committed `specs/openapi.json` with the live document (operations and schemas);
  CI also fails on `git diff specs/openapi.json` after the build, so an unreviewed API change cannot merge.
* **Deprecation process:** announce in the changelog, add `Deprecation`/`Sunset` response headers and an OpenAPI `deprecated: true`, run both
  versions side by side, monitor usage per client from metrics, then remove.

## Example requests and responses

Success, validation failure, authentication failure, authorization failure, conflict, business rejection and server error are all
shown with real captured output in the "REST API examples" chapter (generated into `docs/api/examples.md`).
