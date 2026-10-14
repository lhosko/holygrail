#!/usr/bin/env bash
# Removes what ./setup.sh started: the compose stack, the AI gateway and the taunts MCP server (docker-desktop only).
#   ./teardown.sh           keeps the Minecraft world, pulled models and your secrets
#   ./teardown.sh --all     also deletes the world volume and the gateway image
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT" || exit 1
CTX="docker-desktop"
ALL=0; [[ "${1:-}" == "--all" ]] && ALL=1

if (( ALL )); then docker compose down -v; else docker compose down; fi
helm uninstall airs-gw --kube-context "$CTX" -n airs-gw 2>/dev/null
kubectl --context "$CTX" delete namespace airs-gw storm-castle --ignore-not-found
(( ALL )) && docker image rm registry.portkey.ai/airsgw/gateway_enterprise:2.21.0 storm-castle-taunts:local 2>/dev/null
echo "Done. Whisper (if installed) is separate: scripts/setup-whisper.sh --uninstall"
