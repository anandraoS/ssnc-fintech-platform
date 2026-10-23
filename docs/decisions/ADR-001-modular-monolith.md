# ADR-001: Modular monolith instead of microservices

* **Status:** accepted * **Deciders:** architecture lead * **Date:** project start

## Context
The platform needs customer/account management, transaction processing, audit and reporting. The brief asks for separate deployable services
only where the separation gives a meaningful benefit and warns against distributed transactions "merely to demonstrate microservices".
The core invariants (balance == ledger, a transfer is all-or-nothing, idempotent submission) need a single transaction boundary.

## Decision
Deliver one Spring Boot deployable (`platform-service`) organised as modules with enforced one-directional dependencies, plus one small separate service
(`clearing-simulator`) because it models a genuinely separate external system.

## Alternatives considered
1. **Microservices per module** (customer, account, transaction, audit) - atomic transfers would require a saga/2PC; invariants become eventually consistent; 4x the
   pipelines, dashboards, contracts and failure modes for a one-team scope. Rejected.
2. **Monolith + separate worker deployment** - cheap and compatible with the design (`app.processing.dispatcher-enabled`); kept as the *first* extraction step.
3. **Event-sourced core** - powerful audit but heavy; the append-only ledger and audit trail give most of the benefit. Rejected for scope.

## Consequences
+ one local ACID transaction protects every money invariant; simple operations; fast tests; trivial local run.
- one deployable means one blast radius (mitigated by rolling updates, probes, async worker, and the option to run a dedicated worker pool);
- scaling is all-or-nothing (the database is the real bottleneck anyway).

## Migration path
Dispatcher/processor as a separate deployment of the same artefact -> audit/ops read models behind events -> `customer` -> only then, with measurements, anything touching balances.
The `AccountClosureGuard` port already keeps `account` independent of `transaction` persistence.
