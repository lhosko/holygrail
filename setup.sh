#!/usr/bin/env bash
# One-command setup for Storm the Castle on a Mac with Docker Desktop (docs/QUICKSTART.md).
#
#   ./setup.sh <values.yaml>   first run: the file SCM gave you at Deploy Hybrid. Asks for the two keys the demo
#                              owner emailed you (input hidden) and your Minecraft username.
#   ./setup.sh                 re-run: keeps your .env and gateway secrets
#   flags: --force (rewrite .env and gateway.env)  --whisper (voice input)  --no-smoke (skip the AIRS smoke test)
#
# Safe to re-run: every step checks first. Kubernetes work is pinned to the docker-desktop context.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
CTX="docker-desktop"
GW_ENV="$ROOT/gateway/.secrets/gateway.env"
GATEWAY_IMAGE="registry.portkey.ai/airsgw/gateway_enterprise:2.21.0" # matches chart airs-gw 1.2.0 in gateway/install.sh

VALUES=""; FORCE=0; WHISPER=0; SMOKE=1
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    --whisper) WHISPER=1 ;;
    --no-smoke) SMOKE=0 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    -*) echo "Unknown flag $a" >&2; exit 1 ;;
    *) VALUES="$a" ;;
  esac
done

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '    \033[32m✓\033[0m %s\n' "$*"; }
die()  { printf '\n\033[1;31mSetup stopped:\033[0m %s\n' "$*" >&2; exit 1; }
envval() { grep -E "^$1=" "$2" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

# Waits up to $2 seconds for URL $1 to answer.
wait_http() {
  local i
  for ((i = 0; i < $2; i += 5)); do curl -fsS -m 4 "$1" >/dev/null 2>&1 && return 0; sleep 5; done
  return 1
}

# ---------------------------------------------------------------------------------------------------------------------
step "Checking your Mac"
[[ "$(uname)" == "Darwin" ]] || die "This setup is for macOS."
command -v docker >/dev/null || die "Docker Desktop isn't installed: https://www.docker.com/products/docker-desktop/"
docker info >/dev/null 2>&1 || die "Docker Desktop isn't running. Start it, wait for the whale icon to settle, re-run."
ok "Docker Desktop running"

ver="$(docker compose version --short 2>/dev/null | sed 's/^v//')"
major="${ver%%.*}"; rest="${ver#*.}"; minor="${rest%%.*}"
if [[ -z "$ver" ]] || (( major < 2 || (major == 2 && minor < 38) )); then
  die "Docker Compose ${ver:-?} is too old for the model runner. Update Docker Desktop (Settings → Software updates)."
fi
ok "Docker Compose $ver"

kubectl_ok=1; command -v kubectl >/dev/null || kubectl_ok=0
if (( kubectl_ok )) && ! kubectl config get-contexts -o name 2>/dev/null | grep -qx "$CTX"; then
  die "Kubernetes isn't enabled. Docker Desktop → Settings → Kubernetes → Enable Kubernetes → Apply, wait until it's green, re-run."
fi

# Ports must be free, or held by Docker (that's us, from an earlier run).
for p in 8787 3000 25565; do
  # lsof exits 1 when nothing is listening; under pipefail that would end the script silently.
  holder="$(lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1}' || true)"
  if [[ -n "$holder" && "$holder" != com.docke* ]]; then
    die "Port $p is in use by '$holder'. Stop it (lsof -nP -iTCP:$p -sTCP:LISTEN) and re-run."
  fi
done
ok "Ports 8787, 3000, 25565 available"

# ---------------------------------------------------------------------------------------------------------------------
step "Tools"
missing=()
for t in kubectl helm; do command -v "$t" >/dev/null || missing+=("$t"); done
if ((${#missing[@]})); then
  command -v brew >/dev/null || die "Need ${missing[*]}. Install Homebrew first: https://brew.sh"
  brew install "${missing[@]}"
fi
kubectl config get-contexts -o name | grep -qx "$CTX" \
  || die "Kubernetes isn't enabled. Docker Desktop → Settings → Kubernetes → Enable Kubernetes → Apply, wait until it's green, re-run."
command -v python3 >/dev/null || die "python3 is missing. Run: xcode-select --install"
ok "kubectl, helm, python3"

# ---------------------------------------------------------------------------------------------------------------------
step "Secrets"
# Gateway registration: from the values.yaml SCM gives you at Deploy Hybrid, plus the shared AIRS key.
if [[ -n "$VALUES" ]]; then
  [[ -f "$VALUES" ]] || die "Can't find $VALUES"
  if [[ ! -f "$GW_ENV" || $FORCE -eq 1 || "$VALUES" -nt "$GW_ENV" ]]; then
    gw="$(python3 scripts/scm-values.py "$VALUES")" || die "Couldn't read the gateway registration from $VALUES."
    airs="$(envval AIRS_API_KEY "$GW_ENV")"
    while [[ -z "$airs" ]]; do read -r -s -p "    AIRS API key (from the demo owner's email, input hidden): " airs; echo; done
    mkdir -p "$(dirname "$GW_ENV")"; chmod 700 "$(dirname "$GW_ENV")"
    ( umask 077; printf '%s\nAIRS_API_KEY=%s\n' "$gw" "$airs" > "$GW_ENV" )
    ok "Wrote gateway/.secrets/gateway.env"
  fi
fi
[[ -f "$GW_ENV" ]] || die "No gateway registration yet. Run: ./setup.sh <the values.yaml you downloaded from SCM Deploy Hybrid>"

if [[ ! -f .env || $FORCE -eq 1 ]]; then
  key="$(envval GATEWAY_API_KEY .env)"
  while [[ -z "$key" ]]; do read -r -s -p "    Gateway service key (from the demo owner's email, input hidden): " key; echo; done
  player="$(envval CAMERA_PLAYER .env)"
  while [[ -z "$player" ]]; do read -r -p "    Your Minecraft Java username (the TV camera player): " player; done
  pin="$(printf '%04d' $((RANDOM % 10000)))"
  # Values go in through the environment so the key never shows up in `ps`.
  ( umask 077
    SC_KEY="$key" SC_PLAYER="$player" SC_RCON="$(openssl rand -hex 16)" SC_PIN="$pin" python3 - > .env.tmp <<'PY'
import os, re, sys
app = {'GATEWAY_API_KEY': os.environ['SC_KEY'], 'CAMERA_PLAYER': os.environ['SC_PLAYER'],
       'RCON_PASSWORD': os.environ['SC_RCON'], 'STAFF_PIN': os.environ['SC_PIN']}
for line in open('example.env'):
    m = re.match(r'^([A-Z0-9_]+)=', line)
    sys.stdout.write('%s=%s\n' % (m.group(1), app[m.group(1)]) if m and m.group(1) in app else line)
PY
  ) && mv .env.tmp .env
  ok "Wrote .env (camera player $player, staff PIN $pin)"
else
  ok "Keeping your .env (--force rewrites it; delete .env to enter a new service key)"
fi
[[ -n "$(envval GATEWAY_API_KEY .env)" ]] || die ".env has no GATEWAY_API_KEY. Delete .env and re-run."

# ---------------------------------------------------------------------------------------------------------------------
step "Model (Docker Model Runner)"
# What the gateway needs is Model Runner answering on host TCP 12434. Test that; only try to switch it on if it doesn't
# (the `docker desktop` CLI can fail even when Model Runner is already on, e.g. an old plugin or admin-locked settings).
DMR_URL="http://localhost:12434/engines/v1/models"
if ! curl -fsS -m 4 "$DMR_URL" >/dev/null 2>&1; then
  docker desktop enable model-runner --tcp 12434 >/dev/null 2>&1 || true
  wait_http "$DMR_URL" 30 \
    || die "Model Runner isn't answering on localhost:12434. Docker Desktop → Settings → AI → Enable Docker Model Runner and Enable host-side TCP support (port 12434) → Apply, re-run."
fi
ok "Model Runner on localhost:12434"
MODEL="$(envval MODEL .env)"; MODEL="${MODEL:-ai/llama3.1:8B-Q4_K_M}"
if docker model inspect "$MODEL" >/dev/null 2>&1; then
  ok "$MODEL already pulled"
else
  echo "    Pulling $MODEL (about 5 GB, once)..."
  docker model pull "$MODEL"
  ok "$MODEL pulled"
fi

# ---------------------------------------------------------------------------------------------------------------------
step "AI gateway (local Kubernetes)"
# Pre-pull on the host: Kubernetes reads the host image store, and pulling through its own mirror sometimes fails
# with ImagePullBackOff (docs/SCM-SETUP.md section 4).
if docker image inspect "$GATEWAY_IMAGE" >/dev/null 2>&1; then
  ok "Gateway image present"
else
  # Subshell keeps the registry creds out of this script's environment.
  # shellcheck disable=SC1090
  if ( set -a; source "$GW_ENV"; set +a
       printf %s "$REGISTRY_PASSWORD" | docker login registry.portkey.ai -u "$REGISTRY_USERNAME" --password-stdin >/dev/null 2>&1 \
       && docker pull -q "$GATEWAY_IMAGE" >/dev/null; rc=$?
       docker logout registry.portkey.ai >/dev/null 2>&1; exit $rc ); then
    ok "Gateway image pulled"
  else
    echo "    (couldn't pre-pull the gateway image; letting Kubernetes try)"
  fi
fi
"$ROOT/gateway/install.sh" >/dev/null || die "Gateway install failed. See: kubectl --context $CTX -n airs-gw get pods"
wait_http "http://localhost:8787/v1/health" 120 \
  || die "Gateway isn't answering on localhost:8787. Check: kubectl --context $CTX -n airs-gw get pods; kubectl --context $CTX -n airs-gw logs deploy/airs-gw"
ok "Gateway healthy on localhost:8787"

# ---------------------------------------------------------------------------------------------------------------------
step "Guard's MCP tool (local Kubernetes)"
"$ROOT/infra/taunts/deploy.sh" >/dev/null || die "Taunts MCP deploy failed. See: kubectl --context $CTX -n storm-castle get pods"
ok "Taunts server running"

# ---------------------------------------------------------------------------------------------------------------------
if (( WHISPER )); then
  step "Whisper (voice input)"
  command -v whisper-server >/dev/null || brew install whisper-cpp
  "$ROOT/scripts/setup-whisper.sh"
  ok "Whisper on 127.0.0.1:8178"
fi

# ---------------------------------------------------------------------------------------------------------------------
step "Game (Minecraft server + app)"
docker compose up -d --build
echo "    Waiting for the app (the first start builds the castle; a few minutes)..."
wait_http "http://localhost:3000/api/state" 600 || die "App didn't come up. See: docker compose logs app"
ok "App up on localhost:3000"

if (( SMOKE )); then
  step "Smoke test through the gateway (about 5 AIRS scans)"
  python3 scripts/gateway-smoke.py || die "Smoke test failed. The gateway runs but SCM checks don't behave as expected; send the output above to the demo owner."
fi

# ---------------------------------------------------------------------------------------------------------------------
cat <<EOF

$(printf '\033[1;32mReady.\033[0m')
  Attendee view   http://localhost:3000
  Staff view      http://localhost:3000/staff   (PIN $(envval STAFF_PIN .env))
  Minecraft       Java 1.21.4 → Multiplayer → Direct Connection → localhost, as $(envval CAMERA_PLAYER .env). Press F1.
  Stop            docker compose down          Remove everything: ./teardown.sh
EOF
