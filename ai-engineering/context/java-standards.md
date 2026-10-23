# Java coding standards

* Java 21: records for DTOs/results, sealed interfaces for closed result sets (`ClearingResult`), pattern-matching `switch` (exhaustive - no `default` where the compiler can check), `var` only when the type is obvious.
* Constructor injection only; fields `final`; no static state except constants and pure utilities.
* Names reveal intent (`reserveWithdrawal`, not `process2`); methods do one thing; keep methods short enough to read without scrolling.
* **Domain rules are pure** (inputs in, decision out, no I/O); I/O sits at the edges (repositories, adapters).
* **Exceptions:** `ApiException` carries `HttpStatus`, a stable `code` and a client-safe message. Business failure = persisted terminal state or `ApiException`; technical failure = let it propagate. Never swallow with `catch (Exception)` + log. Never put internals in messages.
* **Transactions:** boundaries are visible in code (`TransactionTemplate` / `@Transactional(MANDATORY)`); keep them short; no I/O inside; never rely on self-invocation of `@Transactional`.
* **Concurrency:** lock order is documented; `@Version` on entities that can conflict (wrapper `Long`); unique constraints decide races; use `compareTo` for money; share nothing mutable.
* **Collections/streams:** bounded results only; prefer paging in the query to filtering in memory; no `findAll()` on growing tables.
* **Logging:** SLF4J placeholders; INFO for state changes, WARN for expected abnormal conditions, ERROR once per unexpected exception at the boundary that maps it; never PII/tokens/bodies.
* **Time:** inject `Clock`; store UTC (`Instant`); never `LocalDateTime.now()` in domain code.
* **Formatting:** project style; no wildcard imports in main code; Javadoc explains *why* (constraints, trade-offs), not what.
* **Dependencies:** standard library first; each new library needs a reason and an ADR.
