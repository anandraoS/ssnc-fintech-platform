# ADR-010: Money as BigDecimal / NUMERIC(19,4) / JSON string, rejected (not rounded) excess precision

* **Status:** accepted

## Decision
`BigDecimal` in Java, `NUMERIC(19,4)` in the database, JSON strings in the API, string-only handling in the SPA. Input with more decimals than the currency's minor units is rejected
(`AMOUNT_PRECISION`) instead of being rounded; unavoidable rounding (percentages, allocation) uses `HALF_EVEN`; comparisons use `compareTo`; allocation preserves the total to the cent.
Single place of policy: `MoneyPolicy`.

## Alternatives
* **Minor units as `long`** (cents): fast and exact, but awkward for fractional rates and currencies with different exponents; kept as a valid alternative.
* **JSON numbers**: lose precision in JavaScript above 2^53 and invite float arithmetic in clients.
* **Silent rounding of input**: hides client bugs and creates reconciliation differences.

## Consequences
+ exactness end to end; DB `CHECK`s catch any bypass; tests prove the policy (`MoneyPolicyTest`);
- clients must treat amounts as decimal strings; sums in clients need a decimal library (the SPA does no arithmetic).
