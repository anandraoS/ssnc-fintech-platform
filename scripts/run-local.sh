#!/usr/bin/env bash
# Starts the platform locally (profile "local"): clearing-simulator (18490) and platform-service (18480).
#
#   * Builds nothing: run `mvn -f backend/pom.xml package -DskipTests` first (see scripts/build.sh).
#   * Works in Git Bash on Windows and on Linux/macOS.
#   * Logs: .run/logs/<name>.log     PIDs: .run/pids/<name>.pid   (stop with scripts/stop-local.sh)
#
# Environment (all optional):
#   JAVA_BIN          java executable to use (default: java). JAVA_HOME is never set or exported here.
#   SERVER_PORT       platform port (default 18480)       CLEARING_PORT   simulator port (default 18490)
#   WAIT_TIMEOUT      seconds to wait for health (default 150)
#   JAVA_OPTS         extra JVM options (default -Xmx512m)
#   LOCAL_DEMO_PASSWORD / LOCAL_ISSUER_HMAC_SECRET  see .env.example (synthetic, local profile only)
#
# LOCAL DEVELOPMENT ONLY. Uses an in-memory database, the local token issuer and synthetic seed data.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JAVA_BIN="${JAVA_BIN:-java}"
SERVER_PORT="${SERVER_PORT:-18480}"
CLEARING_PORT="${CLEARING_PORT:-18490}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-150}"
JAVA_OPTS="${JAVA_OPTS:--Xmx512m}"
VERSION="1.0.0"

RUN_DIR="$ROOT/.run"
LOG_DIR="$RUN_DIR/logs"
PID_DIR="$RUN_DIR/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

log() { echo "[run-local] $*"; }
die() { echo "[run-local] ERROR: $*" >&2; exit 1; }

command -v "$JAVA_BIN" >/dev/null 2>&1 || die "java executable not found: $JAVA_BIN (set JAVA_BIN)"
command -v curl >/dev/null 2>&1 || die "curl is required for health checks"

PLATFORM_JAR="$ROOT/backend/platform-service/target/platform-service-$VERSION.jar"
SIM_JAR="$ROOT/backend/clearing-simulator/target/clearing-simulator-$VERSION.jar"
[ -f "$PLATFORM_JAR" ] || die "missing $PLATFORM_JAR - run scripts/build.sh first"
[ -f "$SIM_JAR" ] || die "missing $SIM_JAR - run scripts/build.sh first"

record_pid() { # name pid
  local name="$1" pid="$2" winpid=""
  # Git Bash: $! is the MSYS pid; /proc/<pid>/winpid holds the Windows pid that taskkill needs.
  if [ -r "/proc/$pid/winpid" ]; then winpid="$(cat "/proc/$pid/winpid" 2>/dev/null || true)"; fi
  { echo "$pid"; [ -n "$winpid" ] && echo "$winpid"; } >"$PID_DIR/$name.pid" || true
}

wait_healthy() { # name port
  local name="$1" port="$2" waited=0
  while [ "$waited" -lt "$WAIT_TIMEOUT" ]; do
    if curl -fsS --max-time 3 "http://localhost:$port/actuator/health" 2>/dev/null | grep -q '"status":"UP"'; then
      log "$name is healthy (port $port, ${waited}s)"
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  die "$name did not become healthy within ${WAIT_TIMEOUT}s - see $LOG_DIR/$name.log"
}

port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
for p in "$SERVER_PORT" "$CLEARING_PORT"; do
  # another application on the same port would make the health check pass for the WRONG process - refuse to start
  if port_in_use "$p"; then die "port $p is already in use by another process - choose another with SERVER_PORT / CLEARING_PORT"; fi
done

if [ -f "$PID_DIR/platform-service.pid" ]; then
  die "already running (found $PID_DIR/platform-service.pid) - run scripts/stop-local.sh first"
fi

log "starting clearing-simulator on :$CLEARING_PORT"
SERVER_PORT="$CLEARING_PORT" nohup "$JAVA_BIN" $JAVA_OPTS -jar "$SIM_JAR" >"$LOG_DIR/clearing-simulator.log" 2>&1 &
record_pid clearing-simulator $!
wait_healthy clearing-simulator "$CLEARING_PORT"

log "starting platform-service on :$SERVER_PORT (profile local, in-memory H2 + synthetic seed data)"
SPRING_PROFILES_ACTIVE=local SERVER_PORT="$SERVER_PORT" CLEARING_URL="http://localhost:$CLEARING_PORT" \
  nohup "$JAVA_BIN" $JAVA_OPTS -jar "$PLATFORM_JAR" >"$LOG_DIR/platform-service.log" 2>&1 &
record_pid platform-service $!
wait_healthy platform-service "$SERVER_PORT"

cat <<EOF

[run-local] Platform is up.

  API ................ http://localhost:$SERVER_PORT/api/v1       (health: /actuator/health, metrics: /actuator/prometheus)
  Swagger UI ......... http://localhost:$SERVER_PORT/swagger-ui.html
  Token (local) ...... POST http://localhost:$SERVER_PORT/api/v1/auth/token  {"username":"adam.admin","password":"<LOCAL_DEMO_PASSWORD>"}
  Clearing simulator . http://localhost:$CLEARING_PORT          (chaos: POST /simulator/chaos {"mode":"FAIL_5XX"})
  UI (static + proxy)  node scripts/serve-frontend.mjs           then open http://localhost:4280

  Demo users: alice.customer, bob.customer, carla.customer, sam.support, omar.ops, olivia.ops, adam.admin
  Stop with: scripts/stop-local.sh
EOF
