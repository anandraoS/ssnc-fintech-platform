# High-level and low-level design

## High-level design (HLD)

The system context, component architecture, data model, lifecycles and deployment are the chapters *System context and component architecture*, *Customer, account and transaction lifecycles*,
*Database design*, and *CI/CD and cloud deployment* of the architecture PDF. One-page summary:

* **Style:** modular monolith (ADR-001) + one simulator service; REST + JSON; PostgreSQL; asynchronous processing through a transactional outbox (ADR-006).
* **Key flows:** synchronous *validate and accept* (202) -> asynchronous *process* (ledger, optional external call) -> *finish* (completed / failed / reconciliation).
* **Invariants and who enforces them:** balance never negative (row lock + `CHECK`), balance == ledger (only `LedgerService` mutates, integrity check), once-only application (unique idempotency key, unique ledger postings), authorization (role + object-level), auditability (same-transaction audit rows, append-only table).
* **Quality attributes:** consistency over availability for money state; availability through stateless replicas, graceful shutdown, probes; observability by design; security by layered controls.
* **Main risks:** hot-account contention, external-network uncertainty, polling throughput of the in-database queue, single database as the scaling limit (see the risk register).

## Low-level design (LLD): submit-and-process a withdrawal

### Classes and responsibilities

| Class | Responsibility | Key collaborators |
|---|---|---|
| `TransactionController.submit` | HTTP <-> DTO, status mapping (202 / 422), replay header | `TransactionService` |
| `TransactionService.submit` | key validation, fingerprint, idempotent create in `TransactionTemplate`, race-loser replay | `AccessPolicy`, `TransactionValidator`, `OutboxService`, `AuditService`, repositories |
| `TransactionValidator.validate` | pure rule evaluation -> `ACCEPT/REVIEW/REJECT` + violations | `DailyLimitPolicy`, `MoneyPolicy` |
| `OutboxDispatcher.drain` | lease events, call handler, retry/backoff/dead-letter | `TransactionProcessor` |
| `TransactionProcessor.process` | Tx1 begin, external call, Tx2 finish; business vs technical failures | `LedgerService`, `ClearingClient`, `ReconciliationService` |
| `LedgerService` | row locks, authoritative checks, debit/credit/reversal, ledger entries | `AccountRepository.lockById`, `LedgerRepository` |
| `RestClearingClient` | HTTP call with timeouts, retry+jitter, circuit breaker, outcome mapping | `RetryExecutor`, Resilience4j `CircuitBreaker` |
| `ReconciliationService` | open/auto-resolve/manual-resolve, compensation | `ClearingClient`, `LedgerService` |

### Algorithm (processor, withdrawal)

```
process(id):
  try   started = tx { tx = load(id); if status != VALIDATED -> return NOTHING   # idempotent
                       tx.PROCESSING; ledger.reserveWithdrawal(tx)               # lock, re-check, debit, ledger entry
                       attempt(RESERVED); return (needsClearing, reference, amount, currency) }
  catch ApiException e  ->  tx { reload; PROCESSING -> FAILED(e.code) } ; return      # business failure: Tx1 rolled back
  # technical exceptions (lock timeout, DB down, optimistic conflict) propagate -> outbox retry
  result = clearing.authorize(reference, amount, currency)                            # NO transaction open here
  tx { tx = load(id); if status != PROCESSING -> return
       Authorized -> COMPLETED
       Declined | NotSent -> ledger.reverseWithdrawal(tx); FAILED
       Unknown -> RECONCILIATION_REQUIRED; reconciliation.open(tx) }
```

### SQL (essentials)

```sql
SELECT * FROM accounts WHERE id = :id FOR UPDATE;                                        -- lock (5 s bounded wait)
UPDATE accounts SET balance = :new, updated_at = now(), version = version + 1 WHERE id = :id AND version = :v;
INSERT INTO ledger_entries (transaction_id, account_id, entry_type, amount, balance_after, created_at) VALUES (...);  -- UNIQUE per (tx, account, type)
SELECT COALESCE(SUM(amount),0) FROM transactions WHERE source_account_id=:id AND transaction_type='WITHDRAWAL'
  AND created_at >= :since AND status IN ('PROCESSING','COMPLETED','RECONCILIATION_REQUIRED') AND id <> :self;   -- daily limit, under the lock
```

### Error handling matrix

| Failure | Where detected | Result |
|---|---|---|
| validation rule | `TransactionValidator` | `REJECTED`, 422, audited |
| insufficient funds at lock time | `LedgerService` (`ApiException`) | Tx1 rolls back, then `FAILED INSUFFICIENT_FUNDS` |
| lock wait > 5 s | JPA lock timeout | exception propagates, outbox retries, API-side 503 `LOCK_TIMEOUT` |
| optimistic conflict (cancel vs process) | `@Version` | loser retries/skips, API 409 |
| clearing decline / not sent / unknown | `ClearingResult` | `FAILED` + refund / `FAILED` + refund / `RECONCILIATION_REQUIRED` |
| crash between Tx1 and Tx2 | recovery job | `RECONCILIATION_REQUIRED` after 5 min |
| poison event | dispatcher | `DEAD` after 5 attempts + alert |

### Sequence and boundaries
See the *Account transfer sequence* and *Database transaction boundaries* diagrams.
