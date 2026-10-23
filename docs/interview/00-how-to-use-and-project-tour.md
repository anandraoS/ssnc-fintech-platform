# How to use this handbook, project setup and module tour

## How to use this guide

This handbook is the **second PDF**: a technical reference plus a bank of interview questions with model answers, all grounded in a working project (`ssnc-fintech-platform`).
Read it in three passes:

1. **Orientation (1 evening):** this chapter and the project tour; run the application (below) so every later sentence has something concrete behind it.
2. **Reference chapters (a week):** Java/Spring, system design, databases, Angular, DevOps/security, AI-assisted development. Each concept is explained with an *analogy*, a *minimal example*, the *pitfall*, and *where it lives in the project*.
3. **Question bank (ongoing):** 130+ questions, 40+ of them scenario based. Answer aloud first, then compare with the model answer; practise the "likely follow-up" questions - they are what separates a memorised answer from understanding.

How model answers are structured: **Short answer** (what you would say in 30 seconds) -> **Reasoning and implementation** -> **Alternatives and trade-offs** -> **Risks and pitfalls** -> **Likely follow-ups** -> **In this project** (a pointer you can show).
Interview tip: *lead with the principle, then the mechanism, then the evidence* ("I would take a row lock, because the check-then-act is a race; here is how it looks; we proved it with a 20-thread test").

> Honesty: the repository states what was executed and what was not (see the validation report). In an interview, do the same - "I ran X and measured Y; I did not run Z" is a strength, not a weakness.

## Project setup and execution

```bash
# prerequisites: JDK 21, Maven 3.9, Node 22+ (any recent LTS), a Chromium-based browser for UI tests. Docker is optional.
# 1. build everything and run all tests
mvn -f backend/pom.xml verify                         # unit + integration (incl. embedded PostgreSQL); jars in backend/*/target
( cd frontend && npm ci && npx ng lint && npx ng build )
# 2. start the backend (in-memory H2, synthetic seed data, local token issuer, simulator for the clearing network)
scripts/run-local.sh                                  # API http://localhost:18480, simulator :18490, Swagger UI /swagger-ui.html
# 3. serve the UI (static + /api proxy)  ->  http://localhost:4280
node scripts/serve-frontend.mjs
# 4. sign in: alice.customer / bob.customer / sam.support / omar.ops / olivia.ops / adam.admin  (password = your LOCAL_DEMO_PASSWORD, default "demo-password")
# 5. exercise it
node tests/e2e/e2e-api.mjs --with-chaos               # live API scenarios incl. timeouts, circuit breaker, reconciliation
node tests/e2e/ui-e2e.mjs                             # browser journeys
node performance/local-baseline.mjs                   # local load baseline (dev-machine numbers only)
# 6. optional: full local infrastructure with PostgreSQL, Grafana, Prometheus, Jaeger
cp .env.example .env   # edit CHANGE_ME values, then:
docker compose -f infrastructure/docker-compose.yml --env-file .env up --build
```

Things to try during practice: submit a withdrawal whose cents are `.13` (declined), `.99` (two transient 503s then success), `.66` (timeout but executed -> reconciliation); switch the simulator to `FAIL_5XX`
and watch the circuit breaker open on the dashboard's service-health card; submit 60,000 as an operator and approve it as the *other* operator; open the same account as the wrong customer and find the `ACCESS_DENIED` audit row.

## Module-by-module tour

| Module (package) | What it does | The one thing to be able to explain |
|---|---|---|
| `common` | `MoneyPolicy`, `ApiException`, error envelope, `GlobalExceptionHandler`, correlation-id and size-limit filters, paging whitelist, masking | why money is a string on the wire and why excess precision is rejected |
| `security` | JWT resource server, `AccessPolicy`, rate limiter, local issuer (profile-gated) | two-layer authorization and why foreign ids return 404 |
| `customer` | profiles, PII masking by role, suspend/reactivate | masking is a data-exposure control, enforced server-side |
| `account` | accounts, lifecycle state machine, `debit/credit` invariants, closure rules | the entity enforces its own invariants; balance changes only via the ledger service |
| `transaction` | state machine, validator, idempotent submit, outbox, processor, ledger, reconciliation, maintenance | the three-way outcome classification and why `Unknown` never refunds |
| `clearing` | port + REST adapter (timeouts, retry with jitter, circuit breaker) + in-process substitute | retries are only safe because the operation is idempotent |
| `audit` | immutable audit events | independent transaction for denials; append-only trigger |
| `ops` | dashboard read models, health, metrics | observability as a feature, not an afterthought |
| `clearing-simulator` | deterministic + chaos stand-in for the external network | testing failure modes you cannot trigger on a real provider |
| `frontend` | Angular 20 SPA | token in memory, idempotency key policy, state views, role-aware navigation |

## A 5-minute architecture story (rehearse this)

"It is a modular monolith because the money invariants need one transaction boundary; splitting account from transaction would force a saga for something a single ACID commit does for free. A client submits a
transaction with an idempotency key; one database transaction records it, validates it and writes an outbox event. A worker takes the event, locks the account rows in id order and applies the ledger postings;
withdrawals reserve funds first, call the external network *outside* any transaction, and classify the answer as authorized, declined, not-sent or unknown. Unknown goes to reconciliation with the funds held.
Security is a JWT resource server with role rules plus object-level checks; every change and denial is audited. I proved the properties with concurrency tests on H2 and on a real PostgreSQL, chaos scenarios against a simulator,
a ledger-integrity check after every run, and I measured one optimisation before and after."
