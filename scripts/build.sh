#!/usr/bin/env bash
# Builds everything that can be built without Docker: backend (compile + unit + integration tests + jars) and frontend
# (lint + unit tests + production bundle). Usage: scripts/build.sh [--skip-tests]
#
# JAVA_HOME is never set here: point JAVA_HOME at a JDK 21 yourself (or put JDK 21 first on PATH). Maven >= 3.9 is
# taken from MVN_BIN or PATH.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MVN_BIN="${MVN_BIN:-mvn}"
SKIP_TESTS="${1:-}"

echo "[build] backend"
if [ "$SKIP_TESTS" = "--skip-tests" ]; then
  "$MVN_BIN" -B -f "$ROOT/backend/pom.xml" package -DskipTests
else
  "$MVN_BIN" -B -f "$ROOT/backend/pom.xml" verify
fi

echo "[build] frontend"
cd "$ROOT/frontend"
[ -d node_modules ] || npm ci
npx ng lint
if [ "$SKIP_TESTS" != "--skip-tests" ]; then
  # CHROME_BIN must point to Chrome/Chromium/Edge; ChromeHeadlessNoSandbox is for containers/CI, EdgeHeadless for Windows.
  npx ng test --watch=false --browsers="${KARMA_BROWSER:-ChromeHeadlessNoSandbox}" --code-coverage
fi
npx ng build
echo "[build] done"
