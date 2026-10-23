# ADR-011: Reserve funds first; classify external outcomes; reconcile the unknown

* **Status:** accepted

## Context
After a timeout we cannot know whether the clearing network executed a payout. Refunding would risk a double payment; completing would risk charging for nothing.

## Decision
1. Debit (reserve) the funds in Tx1 *before* calling the network - the customer cannot spend them twice and the platform cannot over-pay.
2. Treat the call result as `Authorized | Declined | NotSent | Unknown`. Only definite results change money state (`Declined`/`NotSent` -> reversal credit + `FAILED`; `Authorized` -> `COMPLETED`).
3. `Unknown` -> `RECONCILIATION_REQUIRED` + an OPEN `reconciliation_records` row; the funds stay reserved.
4. A scheduled reconciler looks the reference up at the network (idempotent read): authorized -> completed; declined, or not found after a grace period -> refund + `FAILED`.
5. Anything still unknown after 15 minutes raises an alert; operators resolve manually with maker-checker; every step is audited. A stuck `PROCESSING` row (crash) is moved to reconciliation by a maintenance job.

## Alternatives
Check funds then call then debit (race window, can overspend); assume failure on timeout (double payout risk); assume success (phantom payouts); distributed transaction (not available).

## Consequences
+ the platform is never wrong silently: money is either paid out exactly once or returned in full, and uncertainty is a visible, alertable state;
- customers see their balance reduced while a payout is unresolved (the correct, conservative behaviour); needs support runbooks (written);
- requires the network to deduplicate on our `reference` and to offer a lookup - a contract assumption recorded in the interface documentation.
