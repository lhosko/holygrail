#!/usr/bin/env bash
# Builds the taunts MCP server and runs it in Docker Desktop's local Kubernetes (namespace storm-castle).
# Re-run after changing mcp-taunts/ or app/content/cards.json. Pinned to the docker-desktop context.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CTX="docker-desktop"
NS="storm-castle"
K="kubectl --context $CTX"

if ! kubectl config get-contexts -o name | grep -qx "$CTX"; then
  echo "No '$CTX' kube context. Enable Kubernetes in Docker Desktop → Settings → Kubernetes." >&2
  exit 1
fi

# Docker Desktop's Kubernetes pulls through a mirror of the host's image store, so a local tag is enough.
docker build -t storm-castle-taunts:local "$ROOT/mcp-taunts"

$K apply -f "$ROOT/infra/taunts/k8s.yaml"
$K -n "$NS" create configmap taunts-content --from-file=cards.json="$ROOT/app/content/cards.json" \
  --dry-run=client -o yaml | $K apply -f -
$K -n "$NS" rollout restart deploy/taunts
$K -n "$NS" rollout status deploy/taunts --timeout 120s
$K -n "$NS" get pods,svc
