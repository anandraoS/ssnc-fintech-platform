---
applyTo: "backend/**/*.java"
---
Follow `ai-engineering/context/java-standards.md` and `ai-engineering/context/api-rules.md`.
- Constructor injection, `final` fields, records for DTOs, no field `@Autowired` in main code.
- Business rules go in small pure classes (`*Validator`, `*Policy`) so they can be unit-tested without Spring.
- Transaction boundaries are explicit: `TransactionTemplate` where a boundary must exclude an external call, `@Transactional(propagation = MANDATORY)` for code that must never run without one.
- Only technical exceptions propagate out of processors (so retries run); business failures become a persisted terminal state.
- Log with SLF4J placeholders, never concatenation; never log tokens, bodies, PII; mask account numbers with `Masking`.
- Every new query that can return many rows is paged and has a whitelisted sort; check the index.
