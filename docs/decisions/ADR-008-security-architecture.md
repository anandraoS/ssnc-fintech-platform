# ADR-008: Stateless JWT resource server with two-layer authorization

* **Status:** accepted

## Context
Customers and staff use the same API with very different rights; the most likely serious flaw in such systems is broken object-level authorization.

## Decision
Spring Security as an OAuth2 resource server validating JWT (signature, expiry, issuer) from an external OIDC provider. Roles from a claim map to authorities; unknown roles are ignored.
Authorization in two layers: `@PreAuthorize` for *what a role may do* and a pure `AccessPolicy` for *which objects the caller may touch* (customer scope via the `customer_id` claim, transfers inside one customer,
maker-checker). Foreign objects answer `404` and write an `ACCESS_DENIED` audit event. Stateless sessions, CSRF disabled **because** tokens travel in a header (re-enable if cookies are ever used),
CORS allow-list, secure headers, rate limit and body limit, deny-by-default routing. A local HS256 issuer exists for demos, refuses to start with a production profile, and is not part of the Kubernetes configuration.

## Alternatives
Opaque tokens + introspection (revocation friendly, extra hop per request); session cookies + CSRF protection (fine for a BFF); a gateway-only authorization (misses object-level rules that need domain data);
attribute-based access control engine (OPA/Cedar) - attractive at larger scale.

## Consequences
+ authorization rules are plain functions: exhaustively unit-tested and obvious to review; the same rule set applies to REST, search scoping and reads;
- the SPA keeps tokens in memory (reload = sign in again) pending an authorization-code + PKCE / BFF design;
- revocation relies on short token lifetimes (30 min) until the IdP's refresh-token rotation is integrated.
