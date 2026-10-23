#!/usr/bin/env bash
# Post-deployment smoke test: cheap, read-only checks that prove the release is alive and the security posture did not regress.
# Usage: scripts/smoke-test.sh <base-url>          e.g. https://platform.example.invalid  or http://localhost:4280
# Exit code 0 = all checks passed.
set -uo pipefail

BASE="${1:-http://localhost:4280}"
FAILED=0
check() { # name expected_status url [header]
  local name="$1" expected="$2" url="$3" got
  got="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" 2>/dev/null || echo 000)"
  if [ "$got" = "$expected" ]; then echo "PASS  $name ($got)"; else echo "FAIL  $name (expected $expected, got $got) $url"; FAILED=1; fi
}

echo "[smoke] target: $BASE"
check "frontend is served"                           200 "$BASE/"
check "frontend health endpoint"                     200 "$BASE/healthz"
check "SPA deep link falls back to index.html"       200 "$BASE/transactions"
check "API rejects unauthenticated requests"         401 "$BASE/api/v1/accounts"
check "API rejects unauthenticated ops endpoints"    401 "$BASE/api/v1/ops/summary"
check "actuator is not exposed through the ingress"  404 "$BASE/actuator/prometheus"
check "unknown API paths are not found or denied"    401 "$BASE/api/v1/does-not-exist"

# security headers (do not regress)
headers="$(curl -sSI --max-time 10 "$BASE/" 2>/dev/null | tr -d '\r')"
for h in "x-content-type-options: nosniff" "x-frame-options: DENY" "content-security-policy:"; do
  if echo "$headers" | grep -qi "^$h"; then echo "PASS  header $h"; else echo "FAIL  missing header $h"; FAILED=1; fi
done

[ "$FAILED" = "0" ] && echo "[smoke] all checks passed" || echo "[smoke] FAILED"
exit "$FAILED"
