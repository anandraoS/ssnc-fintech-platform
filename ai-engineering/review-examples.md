# Reviewing AI-generated code: five failure patterns with before/after

Assistants produce plausible, compiling, often *tested* code that is wrong in exactly the ways below. Each example shows a realistic generated snippet, the review reasoning and the corrected version
(from this repository). Use together with `.github/prompts/review-ai-code.prompt.md`.

## 1. Race condition

**Generated:**
```java
@Transactional
public void withdraw(UUID id, BigDecimal amount) {
    Account a = accounts.findById(id).orElseThrow();
    if (a.getBalance().compareTo(amount) >= 0) { a.setBalance(a.getBalance().subtract(amount)); }
}
```
**Review:** "What if two requests arrive together?" `@Transactional` gives atomicity of *this* transaction, not isolation from another reading the same row: both read 100 and both subtract 80. READ COMMITTED allows it; only a lock/version/constraint prevents it. The generated unit test (single thread) passes.
**Fixed:** `accounts.lockById(id)` (`FOR UPDATE`), check and mutate under the lock, DB `CHECK (balance >= 0)`, concurrency test (`ConcurrencyScenarios.concurrentWithdrawalsNeverOverspend`) on H2 **and** PostgreSQL.

## 2. Missing authorization

**Generated:**
```java
@GetMapping("/accounts/{id}") public Account get(@PathVariable UUID id) { return repo.findById(id).orElseThrow(); }
```
**Review:** authentication is configured globally, so it *looks* secure. The question is *whose* account - any logged-in customer can read any id (OWASP API1). It also returns the entity (field leakage) and a 500 for unknown ids.
**Fixed:** service call with `AccessPolicy.canViewAccount`, `404` + `ACCESS_DENIED` audit for foreign ids, DTO mapping; tests `SecurityIT.customerCannotReadOthersAccounts` and friends.

## 3. Incorrect monetary calculation

**Generated:**
```java
double fee = amount.doubleValue() * 0.015;
BigDecimal total = amount.add(BigDecimal.valueOf(fee));
if (total.equals(new BigDecimal("100.00"))) { ... }
```
**Review:** `double` introduces binary rounding; `valueOf(double)` bakes it in; `equals` is scale-sensitive (`100.0` != `100.00`); no rounding policy. A test with round numbers passes.
**Fixed:** `MoneyPolicy.percentageOf(amount, 150, currency)` (HALF_EVEN, currency scale), `compareTo`; tests `MoneyPolicyTest` (ties, equals vs compareTo, allocation to the cent).

## 4. Unsafe retry

**Generated:**
```java
@Retryable(maxAttempts = 5, backoff = @Backoff(delay = 100))
public void sendPayout(PayoutRequest r) { restTemplate.postForObject(url, r, Void.class); }
```
**Review:** a timeout does not mean "not executed"; retrying a non-idempotent POST can pay five times. Constant backoff without jitter makes clients retry in lock-step; no cap on total time; no circuit breaker; failure after retries is reported as *failure* although the outcome is *unknown*.
**Fixed:** retry only the idempotent `authorize(reference)`; `RetryExecutor` (exponential backoff, full jitter, bounded); breaker; result classified `Authorized | Declined | NotSent | Unknown` with reconciliation for `Unknown`; tests `RestClearingClientTest`, `RetryAndRateLimitTest`, `TransactionProcessorTest`.

## 5. Inadequate tests

**Generated:**
```java
@Test void withdrawalWorks() {
    when(accountRepo.findById(id)).thenReturn(Optional.of(account));
    service.withdraw(id, BigDecimal.TEN);
    verify(accountRepo).save(account);        // asserts the call, not the outcome
}
```
**Review:** the test restates the implementation; it would still pass if the balance were not reduced, if the amount were negated, or if two threads raced. No negative case, no invariant, everything mocked.
**Fixed:** assert observable outcomes (`balance == 750.00`, status `COMPLETED`), boundaries (`100.01`), authorization negatives, the invariant afterwards (`assertLedgerIntegrity()`), and a concurrency test; mutation check - remove the lock line and the concurrency test must fail.

## Review procedure in one paragraph
For each hunk ask: *what if it runs twice, concurrently, or dies in the middle?* *who is allowed, on whose data?* *what are the units and rounding?* *what does a timeout mean?* *which production bug would this test catch?* Then run the tests yourself.
