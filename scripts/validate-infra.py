"""Static validation of the infrastructure files. Used by scripts/validate-infra.sh and runnable on its own:
    python -I scripts/validate-infra.py

Checks that need no Docker, cluster or network: every YAML/JSON file parses; the compose file has the structure and
hardening we promise; Kubernetes manifests carry probes, resources and security contexts; Prometheus alert rules only
reference metrics that the application actually exports; Grafana dashboards are valid JSON with the expected panels;
no obvious secret material is committed. Exit code 0 = all checks passed.
"""
import glob
import json
import os
import re
import sys

try:
    import yaml  # PyYAML
except ImportError:  # pragma: no cover
    print("PyYAML is required: pip install pyyaml")
    sys.exit(2)

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
failures = 0


def check(ok, message):
    global failures
    print(("PASS  " if ok else "FAIL  ") + message)
    if not ok:
        failures += 1


def load_all(path):
    with open(path, encoding="utf-8") as f:
        return [d for d in yaml.safe_load_all(f) if d is not None]


# ---- every yaml/json parses ------------------------------------------------------------------------------------
yaml_files = [p for p in glob.glob(os.path.join(ROOT, "**", "*.y*ml"), recursive=True)
              if not any(part in p for part in ("node_modules", os.sep + ".work", os.sep + "dist", os.sep + "target", os.sep + ".run"))]
for p in sorted(yaml_files):
    try:
        load_all(p)
        parsed = True
    except Exception as e:  # noqa: BLE001
        parsed = False
        print("   ", e)
    check(parsed, f"parses: {os.path.relpath(p, ROOT)}")

for p in sorted(glob.glob(os.path.join(ROOT, "observability", "grafana", "dashboards", "*.json"))):
    try:
        with open(p, encoding="utf-8") as f:
            dash = json.load(f)
        check(len(dash.get("panels", [])) >= 8 and dash.get("uid"), f"grafana dashboard {os.path.basename(p)} has panels and a uid")
    except Exception as e:  # noqa: BLE001
        check(False, f"grafana dashboard {p}: {e}")

# ---- docker compose ----------------------------------------------------------------------------------------------
compose = load_all(os.path.join(ROOT, "infrastructure", "docker-compose.yml"))[0]
services = compose["services"]
check({"postgres", "platform-service", "clearing-simulator", "frontend", "prometheus", "grafana", "otel-collector"} <= set(services),
      "compose defines the expected services")
check("ports" not in services["postgres"], "postgres is not published to the host")
check(all("healthcheck" in services[s] for s in ("postgres", "platform-service")), "postgres and platform-service have health checks")
check(services["platform-service"]["depends_on"]["postgres"]["condition"] == "service_healthy", "platform-service waits for a healthy database")
check(services["platform-service"].get("read_only") is True and services["platform-service"].get("cap_drop") == ["ALL"], "platform-service container is read-only with all capabilities dropped")
env = services["platform-service"]["environment"]
check(all("${" in str(env[k]) and ":?" in str(env[k]) for k in ("DB_PASSWORD", "LOCAL_DEMO_PASSWORD", "LOCAL_ISSUER_HMAC_SECRET")), "compose requires secrets from .env (no defaults for secret values)")
check(services["platform-service"].get("stop_grace_period") == "30s", "graceful shutdown period configured")
for s in ("frontend", "frontend-react"):
    svc = services.get(s, {})
    check(svc.get("read_only") is True and svc.get("cap_drop") == ["ALL"] and "no-new-privileges:true" in svc.get("security_opt", []),
          f"compose service {s}: read-only, all capabilities dropped, no-new-privileges")
check(services["frontend-react"].get("profiles") == ["react"], "the React UI is an opt-in compose profile (the default stack is unchanged)")
for s, svc in services.items():
    if "build" in svc:
        df = os.path.join(ROOT, "infrastructure", svc["build"]["dockerfile"].replace("infrastructure/", "")) if False else os.path.join(ROOT, svc["build"]["dockerfile"])
        check(os.path.exists(df), f"compose service {s}: Dockerfile exists ({svc['build']['dockerfile']})")

# ---- kubernetes --------------------------------------------------------------------------------------------------
k8s_docs = []
for p in glob.glob(os.path.join(ROOT, "infrastructure", "k8s", "**", "*.yaml"), recursive=True):
    if p.endswith("kustomization.yaml") or "external-secret.example" in p:
        continue
    k8s_docs += load_all(p)
deployments = [d for d in k8s_docs if d.get("kind") == "Deployment"]
check(len(deployments) >= 3, f"{len(deployments)} Deployments found")
for d in deployments:
    name = d["metadata"]["name"]
    pod = d["spec"]["template"]["spec"]
    c = pod["containers"][0]
    check("resources" in c and "requests" in c["resources"] and "memory" in c["resources"].get("limits", {}), f"{name}: resource requests and memory limit")
    check(c.get("readinessProbe") is not None, f"{name}: readiness probe")
    sc = c.get("securityContext", {})
    check(sc.get("allowPrivilegeEscalation") is False and sc.get("readOnlyRootFilesystem") is True and sc.get("capabilities", {}).get("drop") == ["ALL"], f"{name}: hardened container security context")
    check(pod.get("securityContext", {}).get("runAsNonRoot") is True, f"{name}: runAsNonRoot")
    check(pod.get("automountServiceAccountToken") is False, f"{name}: service-account token not mounted")
    check(d["spec"]["strategy"]["rollingUpdate"]["maxUnavailable"] == 0, f"{name}: zero-downtime rolling update")
ps = next(d for d in deployments if d["metadata"]["name"] == "platform-service")
check(ps["spec"]["template"]["spec"]["terminationGracePeriodSeconds"] >= 40, "platform-service: grace period covers preStop + Spring drain")
check(all(p in ps["spec"]["template"]["spec"]["containers"][0] for p in ("startupProbe", "livenessProbe", "readinessProbe")), "platform-service: startup, liveness and readiness probes")
env_names = [e["name"] for e in ps["spec"]["template"]["spec"]["containers"][0]["env"]]
check(all(any(k in e.get("valueFrom", {}) for k in ("secretKeyRef",)) for e in ps["spec"]["template"]["spec"]["containers"][0]["env"] if e["name"] in ("DB_USER", "DB_PASSWORD")), "credentials come from secretKeyRef only")
kinds = {d.get("kind") for d in k8s_docs}
check({"HorizontalPodAutoscaler", "PodDisruptionBudget", "NetworkPolicy", "ConfigMap", "Ingress"} <= kinds, "HPA, PDB, NetworkPolicy, ConfigMap and Ingress present")
cm = next(d for d in k8s_docs if d.get("kind") == "ConfigMap")
check("LOCAL_ISSUER_HMAC_SECRET" not in cm["data"] and "SPRING_PROFILES_ACTIVE" in cm["data"] and "local" not in cm["data"]["SPRING_PROFILES_ACTIVE"], "Kubernetes config never enables the local token issuer")
check(not any(re.search(r"(password|secret|token)", k, re.I) and not k.endswith("_URI") for k in cm["data"]), "ConfigMap holds no secret-like keys")

# ---- prometheus alert rules vs exported metrics ----------------------------------------------------------------
rules = load_all(os.path.join(ROOT, "observability", "prometheus", "alert-rules.yml"))[0]
exprs = " ".join(r["expr"] for g in rules["groups"] for r in g["rules"])
metric_re = re.compile(r"\b(platform_[a-z_]+|hikaricp_[a-z_]+|http_server_requests_[a-z_]+|jvm_[a-z_]+)\b")
used = set(metric_re.findall(exprs))
source = open(os.path.join(ROOT, "backend", "platform-service", "src", "main", "java", "com", "fintechdemo", "platform", "ops", "PlatformMetrics.java"), encoding="utf-8").read()
custom = {m.replace(".", "_") for m in re.findall(r'"(platform\.[a-z_.]+)"', source)}
for m in sorted(m for m in used if m.startswith("platform_")):
    base = re.sub(r"_(total|seconds|count|sum|bucket)$", "", m)
    check(base in custom, f"alert rule metric {m} is defined in PlatformMetrics")
check(all(r.get("annotations", {}).get("runbook") for g in rules["groups"] for r in g["rules"]), "every alert links to a runbook")
runbooks = open(os.path.join(ROOT, "docs", "operations", "runbooks.md"), encoding="utf-8").read().lower() if os.path.exists(os.path.join(ROOT, "docs", "operations", "runbooks.md")) else ""
for g in rules["groups"]:
    for r in g["rules"]:
        anchor = r["annotations"]["runbook"].split("#")[-1].replace("-", " ")
        check(anchor in runbooks.replace("-", " "), f"runbook section exists for alert {r['alert']} ({anchor})")

# ---- secrets hygiene ---------------------------------------------------------------------------------------------
patterns = [re.compile(r"AKIA[0-9A-Z]{16}"), re.compile(r"-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----"), re.compile(r"xox[baprs]-[0-9A-Za-z-]{10,}"), re.compile(r"ghp_[0-9A-Za-z]{30,}")]
hits = []
for p in glob.glob(os.path.join(ROOT, "**", "*"), recursive=True):
    if os.path.isdir(p) or any(part in p for part in ("node_modules", os.sep + ".work", os.sep + "dist", os.sep + "target", os.sep + ".run", os.sep + ".angular", ".png", ".pdf", ".zip", os.sep + "coverage")):
        continue
    try:
        text = open(p, encoding="utf-8", errors="ignore").read()
    except OSError:
        continue
    for pat in patterns:
        if pat.search(text):
            hits.append(os.path.relpath(p, ROOT))
check(not hits, "no cloud keys, private keys or tokens committed " + (str(hits) if hits else ""))
check(not os.path.exists(os.path.join(ROOT, ".env")), ".env is not present in the repository tree")

print(f"\n{failures} failure(s)")
sys.exit(1 if failures else 0)
