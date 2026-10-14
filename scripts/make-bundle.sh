#!/usr/bin/env bash
# Owner side: builds the one file a colleague needs for ./setup.sh (docs/SCM-SETUP.md, "Onboarding a colleague").
#
#   scripts/make-bundle.sh <colleague> <values.yaml downloaded from SCM Deploy Hybrid>
#
# Takes the gateway registration from the SCM download, the shared config/guardrail IDs from your .env, and prompts
# (no echo) for the colleague's own service key. AIRS_API_KEY comes from your gateway.env (GATEWAY_ENV_FILE overrides
# the path), or is prompted for. Writes storm-castle-<colleague>.env (mode 600, gitignored). Never prints a secret.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="${1:-}"; VALUES="${2:-}"
[[ -n "$NAME" && -f "$VALUES" ]] || { echo "Usage: $0 <colleague> <scm-values.yaml>" >&2; exit 1; }
[[ "$NAME" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "Colleague name: letters, digits, - and _ only." >&2; exit 1; }
[[ -f "$ROOT/.env" ]] || { echo "Missing $ROOT/.env (the shared CONFIG_* IDs are read from it)." >&2; exit 1; }
OWNER_GW_ENV="${GATEWAY_ENV_FILE:-$ROOT/gateway/.secrets/gateway.env}"
OUT="$ROOT/storm-castle-$NAME.env"

# Pull the registration out of the SCM values.yaml (flat, known layout: imageCredentials[0] + environment.data).
GW="$(python3 - "$VALUES" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
def get(key):
    m = re.search(r'^\s*-?\s*%s:\s*(.+?)\s*$' % key, text, re.M)
    if not m:
        sys.exit("values.yaml has no %s. Is it the Deploy Hybrid download?" % key)
    return m.group(1).strip().strip('"').strip("'")
for env, key in [("REGISTRY_USERNAME", "username"), ("REGISTRY_PASSWORD", "password"),
                 ("PORTKEY_CLIENT_AUTH", "PORTKEY_CLIENT_AUTH"), ("ORGANISATIONS_TO_SYNC", "ORGANISATIONS_TO_SYNC")]:
    print("%s=%s" % (env, get(key)))
PY
)"

envval() { grep -E "^$1=" "$2" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

AIRS_API_KEY="$(envval AIRS_API_KEY "$OWNER_GW_ENV")"
if [[ -z "$AIRS_API_KEY" ]]; then
  read -r -s -p "AIRS_API_KEY (storm-castle-booth app, shared): " AIRS_API_KEY; echo
fi
read -r -s -p "GATEWAY_API_KEY for $NAME (their own SCM service key): " GATEWAY_API_KEY; echo
[[ -n "$GATEWAY_API_KEY" ]] || { echo "A service key is required." >&2; exit 1; }

for k in CONFIG_L1 CONFIG_L2 CONFIG_L3; do
  [[ -n "$(envval "$k" "$ROOT/.env")" ]] || { echo "$k is empty in your .env." >&2; exit 1; }
done

umask 077
{
  echo "# Storm the Castle bundle for $NAME, made $(date +%F). Secret: keep it out of chat and email."
  echo "# Use: ./setup.sh <this file>"
  echo "# --- gateway ---"
  echo "$GW"
  echo "AIRS_API_KEY=$AIRS_API_KEY"
  echo "# --- app ---"
  echo "GATEWAY_API_KEY=$GATEWAY_API_KEY"
  for k in CONFIG_L1 CONFIG_L2 CONFIG_L3 GUARDRAIL_TOXIC_ID GUARDRAIL_REGEX_ID GUARDRAIL_AIRS_ID; do
    echo "$k=$(envval "$k" "$ROOT/.env")"
  done
} > "$OUT"
chmod 600 "$OUT"
echo "Wrote $OUT. Send it to $NAME over a secure channel."
