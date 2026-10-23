# Performance and reliability tests

| Asset | What it is | Status |
|---|---|---|
| `local-baseline.mjs` | Dependency-free Node load generator (6 scenarios + invariant checks) | **Executed** - results in `docs/validation/perf-baseline*.json` |
| `k6/account-queries.js` | concurrent account/balance reads, constant arrival rate | written, **not executed** (k6 was not installable here) |
| `k6/submit-throughput.js` | ramping submission rate, per-request idempotency keys | written, **not executed** |
| `k6/concurrent-withdrawals.js` | lock contention on one account (invariant checks in `teardown`) | written, **not executed** |
| `k6/transfers-and-duplicates.js` | opposing transfers (deadlock avoidance) + duplicate storms (idempotency) | written, **not executed** |
| `k6/history-query.js` | deep pagination over 1000+ rows | written, **not executed** |

## Measured versus illustrative

* **Measured**: only what `local-baseline.mjs` printed on the author's machine, stored verbatim in
  `docs/validation/perf-baseline.json` (current code) and `perf-baseline-before-drain-loop.json` (before one optimisation).
  Environment: developer laptop (which was also running other projects' services), one JVM, in-memory H2, Node client on
  the same host. **This is not a benchmark and says nothing about PostgreSQL, network latency, multiple instances or
  production hardware.** What it does prove is behavioural: under 16-32 concurrent clients no request failed with 5xx,
  one account never went negative, opposing transfers conserved money and never deadlocked, and 25 idempotency keys
  repeated ~1,100 times produced exactly 25 deposits.
* **Illustrative**: the thresholds in `k6/lib.js` (`TARGETS`) and the alert thresholds in
  `observability/prometheus/alert-rules.yml` are *starting points to tune against measurements*, not results.

## Running

```bash
# 1. start the platform with raised rate limits (otherwise the limiter - correctly - answers 429)
RATE_LIMIT_API_CAPACITY=1000000 RATE_LIMIT_API_REFILL=1000000 RATE_LIMIT_AUTH_CAPACITY=1000 RATE_LIMIT_AUTH_REFILL=1000 \
  JAVA_BIN=/path/to/jdk21/bin/java scripts/run-local.sh

# 2a. measured baseline (Node 18+)
node performance/local-baseline.mjs --seconds 8 --out docs/validation/perf-baseline.json

# 2b. k6 (install from https://k6.io)
API=http://localhost:18480 LOCAL_DEMO_PASSWORD=<value> k6 run performance/k6/concurrent-withdrawals.js
```

For a meaningful capacity test use the Docker Compose stack (real PostgreSQL), several `platform-service` replicas and a
load generator on a separate host, and compare against the dashboards in `observability/grafana`.

## How to read a result (investigation guide)

See `docs/operations/performance-troubleshooting.md` for the step-by-step approach to: high JVM memory, excessive GC,
thread starvation, slow SQL, connection-pool exhaustion, lock contention, elevated API latency, database outages and
partial service failures.
