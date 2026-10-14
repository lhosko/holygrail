#!/usr/bin/env bash
# One-command setup for Storm the Castle on a Mac with Docker Desktop (docs/QUICKSTART.md).
#
#   ./setup.sh <storm-castle-you.env>   first run: the bundle the demo owner sent you
#   ./setup.sh                          re-run: keeps your .env and gateway secrets
#   flags: --force (rewrite .env from the bundle)  --whisper (voice input)  --no-smoke (skip the AIRS smoke test)
#
# Safe to re-run: every step checks first. Kubernetes work is pinned to the docker-desktop context.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
CTX="docker-desktop"
GW_ENV="$ROOT/gateway/.secrets/gateway.env"
GATEWAY_IMAGE="registry.portkey.ai/airsgw/gateway_enterprise:2.21.0" # matches chart airs-gw 1.2.0 in gateway/install.sh

BUNDLE=""; FORCE=0; WHISPER=0; SMOKE=1
for a in "$@"; do
  case "$a" in
    --force) FORCE=1 ;;
    --whisper) WHISPER=1 ;;
    --no-smoke) SMOKE=0 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    -*) echo "Unknown flag $a" >&2; exit 1 ;;
    *) BUNDLE="$a" ;;
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
  holder="$(lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1}')"
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
if [[ -n "$BUNDLE" ]]; then
  [[ -f "$BUNDLE" ]] || die "Can't find bundle file $BUNDLE"
  for k in REGISTRY_USERNAME REGISTRY_PASSWORD PORTKEY_CLIENT_AUTH ORGANISATIONS_TO_SYNC GATEWAY_API_KEY CONFIG_L1; do
    [[ -n "$(envval "$k" "$BUNDLE")" ]] || die "The bundle has no $k. Ask the demo owner for a fresh one."
  done
fi

if [[ -n "$BUNDLE" && ( ! -f "$GW_ENV" || $FORCE -eq 1 || "$BUNDLE" -nt "$GW_ENV" ) ]]; then
  mkdir -p "$(dirname "$GW_ENV")"; chmod 700 "$(dirname "$GW_ENV")"
  ( umask 077; for k in REGISTRY_USERNAME REGISTRY_PASSWORD PORTKEY_CLIENT_AUTH ORGANISATIONS_TO_SYNC AIRS_API_KEY; do
      echo "$k=$(envval "$k" "$BUNDLE")"; done > "$GW_ENV" )
  ok "Wrote gateway/.secrets/gateway.env"
fi
[[ -f "$GW_ENV" ]] || die "No gateway secrets yet. Run: ./setup.sh <the storm-castle-*.env file the demo owner sent you>"

if [[ ! -f .env || $FORCE -eq 1 ]]; then
  [[ -n "$BUNDLE" ]] || die "No .env yet. Run: ./setup.sh <the storm-castle-*.env file the demo owner sent you>"
  player="$(envval CAMERA_PLAYER .env)"
  while [[ -z "$player" ]]; do read -r -p "    Your Minecraft Java username (the TV camera player): " player; done
  pin="$(printf '%04d' $((RANDOM % 10000)))"
  ( umask 077
    python3 - "$BUNDLE" "$player" "$(openssl rand -hex 16)" "$pin" > .env <<'PY'
import re, sys
bundle, player, rcon, pin = sys.argv[1:]
vals = {}
for line in open(bundle):
    m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.rstrip('\n'))
    if m: vals[m.group(1)] = m.group(2)
app = {k: vals.get(k, '') for k in ['GATEWAY_API_KEY', 'CONFIG_L1', 'CONFIG_L2', 'CONFIG_L3',
                                    'GUARDRAIL_TOXIC_ID', 'GUARDRAIL_REGEX_ID', 'GUARDRAIL_AIRS_ID']}
app.update(CAMERA_PLAYER=player, RCON_PASSWORD=rcon, STAFF_PIN=pin)
for line in open('example.env'):
    m = re.match(r'^([A-Z0-9_]+)=', line)
    sys.stdout.write('%s=%s\n' % (m.group(1), app[m.group(1)]) if m and m.group(1) in app else line)
PY
  )
  ok "Wrote .env (camera player $player, staff PIN $pin)"
else
  ok "Keeping your .env (use --force with a bundle to rewrite it)"
fi
[[ -n "$(envval GATEWAY_API_KEY .env)" ]] || die ".env has no GATEWAY_API_KEY. Re-run with your bundle and --force."

# ---------------------------------------------------------------------------------------------------------------------
step "Model (Docker Model Runner)"
docker desktop enable model-runner --tcp 12434 >/dev/null 2>&1 \
  || die "Couldn't enable Model Runner. Docker Desktop → Settings → AI → Enable Docker Model Runner + host-side TCP (port 12434)."
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
