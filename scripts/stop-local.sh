#!/usr/bin/env bash
# Stops every process recorded by scripts/run-local.sh (.run/pids/<name>.pid).
# Git Bash on Windows: uses `taskkill //PID <winpid> //F //T` (second line of the pid file); otherwise `kill`.
# Only pids written by run-local.sh are touched.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_DIR="$ROOT/.run/pids"

log() { echo "[stop-local] $*"; }

[ -d "$PID_DIR" ] || { log "nothing to stop"; exit 0; }

stop_one() {
  local name="$1" pidfile="$PID_DIR/$1.pid" pid winpid
  [ -f "$pidfile" ] || return 0
  pid="$(sed -n '1p' "$pidfile")"
  winpid="$(sed -n '2p' "$pidfile")"
  if command -v taskkill >/dev/null 2>&1 && [ -n "$winpid" ]; then
    if taskkill //PID "$winpid" //F //T >/dev/null 2>&1; then log "stopped $name (windows pid $winpid)"; else log "$name was not running"; fi
  elif [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true   # SIGTERM => Spring graceful shutdown
    for _ in $(seq 1 25); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
    if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null || true; log "force-killed $name"; else log "stopped $name"; fi
  else
    log "$name was not running"
  fi
  rm -f "$pidfile"
}

for name in platform-service clearing-simulator frontend; do stop_one "$name"; done
for pidfile in "$PID_DIR"/*.pid; do [ -e "$pidfile" ] && stop_one "$(basename "$pidfile" .pid)"; done
log "done"
