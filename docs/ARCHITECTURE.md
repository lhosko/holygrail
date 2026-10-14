# Architecture

```
 Native macOS ───────────────────────────────────────────────────────────────────────────────
   Minecraft client (TV, spectator "Camera")        Docker Model Runner :12434 (llama.cpp + Metal)
   Chrome: attendee view :3000 · staff view /staff  whisper-server :8178 (whisper.cpp + Metal, launchd)
                 │                                             ▲                     ▲
 Docker Compose ─┼─────────────────────────────────────────────┼─────────────────────┼────────
   mc (Paper 1.21.4, RCON) ◄── bots + RCON ── app (Node: server.js, mineflayer, UI) ─┘ /api/transcribe
                                                   │ gateway service key + config id (L1/L2/L3)
                                                   ▼ host.docker.internal:8787 (chat) · :8788 (MCP)
 Docker Desktop Kubernetes ───────────────────────────────────────────────────────────────────
   ns airs-gw: SCM AI Gateway data plane + redis ── model calls ──► host.docker.internal:12434 (DMR)
                     └─ MCP /storm-castle-taunts ──► ns storm-castle: taunts (ClusterIP, generate_insult)
                                   │ config sync, logs, AIRS scans
                                   ▼
 SaaS: Strata Cloud Manager, tenant lhoskinson-us → SCM AI Gateway control plane + Prisma AIRS
```

## One attempt, end to end
1. The attendee taps a card or speaks. Audio goes to `/api/transcribe` → whisper-server, and the text comes back for editing or auto-send.
2. `POST /api/attack` runs booth hygiene only: length and pacing (`safety.js`).
3. `turn.evaluate()` builds the messages (`sentry.js`):
   - System prompt.
   - The visitor's line.
   - For the Trojan Rabbit, the sign text the sentry bot read in-game, as the **last** message.
4. `gateway.js` calls the local gateway with the level's saved config. The gateway runs:
   - Input guardrails: none / regex / AIRS.
   - The model, via DMR.
   - Output guardrails: AIRS toxic content filter / AIRS.
   - A denial returns **446** with `hook_results`, which are parsed into per-check verdicts.
   - **The insult tool.** Turn 1 offers the model one tool, `generate_insult{topic}`, discovered from the `taunts` MCP server through the gateway's MCP port. If the model calls it, `mcp.js` runs it via `:8788/storm-castle-taunts/mcp` (same key, same trace id), and turn 2 sends the tool result back through the same level config with the JSON schema and no tools. At L3 an attack is blocked on turn 1's input scan, so the tool never runs.
   - Llama 3.1 8B ignores tools when a JSON schema is also set, hence two turns. It also rarely quotes the tool's insult, so the app prepends it to the dialogue (`withInsult`). If the MCP call fails, a curated insult is used and the trace says "fallback". `MCP_TAUNTS=0` goes back to one call per turn.
5. The final reply is **JSON content** `{action, dialogue, cow}`. Opening the bridge is deliberately not a tool call. This keeps everything the model "does" visible to the AIRS response scan.
   - The parser fails closed: anything that isn't a clean `open_bridge` becomes a taunt.
6. The UI gets the verdict immediately. Then the game plays it out:
   - The knight walks up and a bubble shows the line.
   - The camera cuts to the sentry, who answers with a bubble and chat (plus an optional cow cameo).
   - On `open_bridge`, the sentry walks to the **real lever** and flips it. If Royal Seal mode is on, staff must approve first.
   - `bridge.js` sees the lever and animates the drawbridge over RCON. The knight crosses, fireworks go off, and the bridge auto-closes.

## Design choices worth knowing
- **The drawbridge is RCON-animated.**
  - The original plan was sticky pistons. The bot still flips a real lever, but `bridge.js` watches it and plays block-fill frames.
  - Why: no redstone timing to debug at the booth, and staff "Reset" always restores a known state.
- **Same gateway, three policies.** The app only switches the config id it sends (`x-portkey-config`, the header name in the gateway's Portkey-based wire protocol), so the story is "change the policy, not the app".
- **The toxic content filter runs on every level.**
  - AIRS toxic-content scanning on output keeps the booth family-friendly without giving L1 or L2 any input protection.
  - Cost: 1 AIRS scan per LLM call at L1/L2, 2 at L3. A turn that uses the insult tool makes two LLM calls, so 2 and 4.
- **Idle costs nothing.** Attract-mode taunts come from `content/cards.json`, not the LLM.
- **Royal Seal (staff encore).** The LLM proposes, a human disposes. This is LLM06 excessive agency, solved by architecture rather than detection.
- **Emergency `DIRECT_MODEL=1`** bypasses the gateway entirely, for when the network or SCM is down. The UI shows a red badge, because nothing is protected in this mode.

## Files
| Path | What |
|---|---|
| `setup.sh` / `teardown.sh` | one-command setup from the SCM Deploy Hybrid values.yaml (`scripts/scm-values.py` parses it), and removal |
| `gateway/` | sanitized Helm values + `install.sh` (pinned to `docker-desktop`); secrets in `gateway/.secrets/` (gitignored) |
| `infra/scm/objects.json` | the SCM AI Gateway objects you create in the console (integration, guardrails, 3 configs, service key, MCP server); verification and tests read it |
| `docker-compose.yml` | `mc`, `app`, DMR model |
| `infra/taunts/` | k8s manifest + `deploy.sh` for the MCP server (ns `storm-castle`, pinned to `docker-desktop`) |
| `mcp-taunts/` | MCP server with one tool, `generate_insult{topic}`; builds insults only from curated `cards.json` content (`insultKit`), never echoes model text |
| `app/src/mcp.js` | MCP client: tool discovery and calls through the gateway's MCP port |
| `app/server.js` | HTTP + WebSocket hub, attempt choreography, staff routes, health, attract mode |
| `app/src/turn.js` | gateway → verdicts → parsed decision → outcome (used by server and rehearsal) |
| `app/src/gateway.js` | gateway client and `hook_results` parser |
| `app/src/sentry.js` | persona prompt, JSON schema, fail-closed parser |
| `app/src/bot.js`, `knight.js`, `mcbot.js` | mineflayer bots with reconnect and pathfinding (RCON fallbacks) |
| `app/src/bridge.js`, `castle.js`, `world.js` | lever watcher + animation, castle builder, geometry |
| `app/src/camera.js` | spectator camera shots, text_display speech bubbles |
| `app/src/context.js` | Trojan Rabbit: build it, write the decree sign, read the sign |
| `app/src/session.js` | visitor progress, Hall of Knights (`data/hall-of-knights.json`) |
| `app/content/cards.json` | cards, technique tags, explainers, taunts (editable; staff "Reload") |
| `app/src/redteam.js` | `POST /api/redteam`, the headless AI Red Teaming target (off unless `REDTEAM_TOKEN` is set) |
| `app/scripts/` | `build-castle.js`, `rehearse.js`, `soak.js`, `redteam-artifacts.js` |
| `redteam/` | generated AI Red Teaming custom adapter + prompt set CSV (docs/RED-TEAM.md) |
| `scripts/setup-whisper.sh` | whisper.cpp model + launchd service on :8178 |
