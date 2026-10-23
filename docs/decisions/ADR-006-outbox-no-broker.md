# ADR-006: Transactional outbox with an in-process dispatcher; no message broker, no Redis (yet)

* **Status:** accepted

## Context
Submission must be fast and reliable, processing asynchronous and retryable, and the system must not lose or duplicate work. The brief mentions RabbitMQ/Kafka/Redis "where justified".

## Decision
Write an `outbox_events` row in the same transaction as the state change; a scheduled `OutboxDispatcher` claims events by **lease** (bump `attempts`, push `available_at`, optimistic `@Version`),
runs the processor, marks `DISPATCHED`, retries with exponential backoff (`2 s * 2^n`, capped at 5 min) and moves poison events to `DEAD` (the dead-letter state) after 5 attempts with an audit event and an alert.
Delivery is at-least-once; the consumer is idempotent. No broker and no Redis are deployed.

## Why not a broker or Redis now
* One module consumes the events; a broker adds an operational system, a second failure domain, and dual-write problems that the outbox exists to avoid.
* Redis would only back the rate limiter (and a cache we do not need). A shared limiter becomes necessary when running many instances behind no gateway.

## Alternatives
Kafka/RabbitMQ with the outbox publishing to it (needed for multiple independent consumers, replay, fan-out); `LISTEN/NOTIFY`; `SKIP LOCKED` polling workers; Spring Integration.

## Consequences
+ atomic with the business change, no extra infrastructure, simple local run, DLQ semantics visible in SQL and the ops UI;
- polling latency (500 ms default; the work-conserving drain loop removes the gap under load), database load from polling (an indexed query);
- when a second consumer, replay or cross-service fan-out appears: add a relay that publishes outbox rows to Kafka/RabbitMQ; producers do not change.
