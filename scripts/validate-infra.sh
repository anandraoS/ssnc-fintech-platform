#!/usr/bin/env bash
# Validates infrastructure configuration. Always runs the dependency-light static checks; runs the stronger checks
# (docker compose config, kubeconform, hadolint) when those tools are installed (they are in CI).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATUS=0

echo "== static checks (python scripts/validate-infra.py)"
python -I "$ROOT/scripts/validate-infra.py" || STATUS=1

if command -v docker >/dev/null 2>&1; then
  echo "== docker compose config"
  ( cd "$ROOT" && POSTGRES_PASSWORD=x LOCAL_DEMO_PASSWORD=x LOCAL_ISSUER_HMAC_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx GRAFANA_ADMIN_PASSWORD=x \
      docker compose -f infrastructure/docker-compose.yml config -q ) && echo "PASS  compose config" || { echo "FAIL  compose config"; STATUS=1; }
else
  echo "SKIP  docker compose config (docker not installed)"
fi

if command -v kubeconform >/dev/null 2>&1; then
  echo "== kubeconform"
  kubeconform -strict -summary -ignore-missing-schemas "$ROOT"/infrastructure/k8s/base/{namespace,config-and-policies,platform-service,frontend}.yaml \
    "$ROOT"/infrastructure/k8s/overlays/test/clearing-simulator.yaml || STATUS=1
else
  echo "SKIP  kubeconform (not installed)"
fi

if command -v hadolint >/dev/null 2>&1; then
  echo "== hadolint"
  for f in "$ROOT"/infrastructure/docker/*.Dockerfile; do hadolint --ignore DL3018 --ignore DL3016 "$f" || STATUS=1; done
else
  echo "SKIP  hadolint (not installed)"
fi

exit $STATUS
