#!/usr/bin/env bash
# Installs the SCM AI Gateway (hybrid data plane) into Docker Desktop's local Kubernetes.
# Always pinned to the docker-desktop context so it can never touch a cloud cluster.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CTX="docker-desktop"
NS="airs-gw"
ENV_FILE="${GATEWAY_ENV_FILE:-$ROOT/.secrets/gateway.env}"  # setup.sh writes this from your SCM values.yaml
K="kubectl --context $CTX"

if ! kubectl config get-contexts -o name | grep -qx "$CTX"; then
  echo "No '$CTX' kube context. Enable Kubernetes in Docker Desktop → Settings → Kubernetes." >&2
  exit 1
fi
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }

# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

$K create namespace "$NS" --dry-run=client -o yaml | $K apply -f -

$K -n "$NS" create secret docker-registry airsgatewayregistrycredentials \
  --docker-server=registry.portkey.ai \
  --docker-username="$REGISTRY_USERNAME" \
  --docker-password="$REGISTRY_PASSWORD" \
  --dry-run=client -o yaml | $K apply -f -

# Optional AIRS_API_KEY in gateway.env: the Prisma AIRS guardrail falls back to this gateway env var
# when the guardrail has no credential of its own. (Without any key, the AIRS check FAILS OPEN.)
SECRET_KEYS="PORTKEY_CLIENT_AUTH,ORGANISATIONS_TO_SYNC"
EXTRA=()
if [[ -n "${AIRS_API_KEY:-}" ]]; then
  SECRET_KEYS="$SECRET_KEYS,AIRS_API_KEY"
  EXTRA=(--from-literal=AIRS_API_KEY="$AIRS_API_KEY")
fi

$K -n "$NS" create secret generic airs-gw-env \
  --from-literal=PORTKEY_CLIENT_AUTH="$PORTKEY_CLIENT_AUTH" \
  --from-literal=ORGANISATIONS_TO_SYNC="$ORGANISATIONS_TO_SYNC" \
  ${EXTRA[@]+"${EXTRA[@]}"} \
  --dry-run=client -o yaml | $K apply -f -

# Corporate TLS inspection: pass the inspecting root CA(s) to the pod (public certs, not secrets).
# Override with EXTRA_CA_NAMES="Name One,Name Two"; nothing found means a normal install.
EXTRA_CA_NAMES="${EXTRA_CA_NAMES:-PANW Enterprise Root CA2 G2}"
CA_PEM="$(mktemp)"; trap 'rm -f "$CA_PEM"' EXIT
IFS=',' read -r -a _cas <<< "$EXTRA_CA_NAMES"
for name in "${_cas[@]}"; do
  security find-certificate -a -c "$name" -p /Library/Keychains/System.keychain >> "$CA_PEM" 2>/dev/null || true
done
CA_VALUES=()
if grep -q "BEGIN CERTIFICATE" "$CA_PEM"; then
  echo "Adding corporate root CA(s) to the gateway: $EXTRA_CA_NAMES"
  $K -n "$NS" create configmap airs-gw-extra-ca --from-file=ca.pem="$CA_PEM" \
    --dry-run=client -o yaml | $K apply -f -
  CA_VALUES=(-f "$ROOT/values-extra-ca.yaml")
fi

helm repo add airs-gw https://portkey-ai.github.io/airs-gw-helm >/dev/null 2>&1 || true
helm repo update airs-gw >/dev/null

helm upgrade --install airs-gw airs-gw/airs-gw \
  --kube-context "$CTX" -n "$NS" \
  --version 1.2.0 \
  -f "$ROOT/values.yaml" \
  ${CA_VALUES[@]+"${CA_VALUES[@]}"} \
  --set "environment.secretKeys={$SECRET_KEYS}" \
  --wait --timeout 5m

$K -n "$NS" get pods,svc
echo
echo "Health: curl -s localhost:8787/v1/health   (expect \"Server is healthy\")"
