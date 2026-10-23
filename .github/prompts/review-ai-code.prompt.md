---
mode: ask
description: Review a diff (especially AI-generated code) against the platform's failure patterns
---
Review the attached diff as a skeptical senior engineer. For **each** of the five categories below answer *safe*, *unsafe* or *not applicable*, quote the lines, and explain the failure scenario for anything unsafe:
1. **Race conditions / atomicity** - read-modify-write without a lock, check-then-act, two writes that must commit together, lock order, work inside a lock.
2. **Missing authorization** - role rule *and* object-level rule on every new endpoint/read; does a foreign id return 404? is there a BOLA test?
3. **Incorrect monetary calculations** - `double`/`float`, `equals` on `BigDecimal`, silent rounding, string money, scale.
4. **Unsafe retries / external calls** - retry of a non-idempotent call, no jitter/cap/timeout, external call inside a transaction, "unknown" treated as failure or success.
5. **Inadequate tests** - would the test fail if the code were wrong? negative paths? invariant asserted afterwards? flaky timing?
Finish with a verdict (approve / approve with comments / request changes) and a prioritised list. Do not suggest changes you have not reasoned through; flag anything you cannot judge from the diff.
