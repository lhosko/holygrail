# TODO

## Add an MCP insult generator (done 2026-10-06: registered, verified through the gateway)
An MCP server that generates insults in the French guard's style. The guard would call it as a tool through the SCM AI Gateway's MCP endpoint (port 8788), so tool calls go through the guardrails as well. That gives the booth a small "agents and tools are covered too" story.

- [x] Build a small MCP server, e.g. a `generate_insult` tool with an optional topic (coconuts, swallows, hamsters…). Have it draw on `signatureInsults` and `banter` in `app/content/cards.json`, and never return the password.
- [x] Register it in SCM → AI Security → AI Gateway → Integrations → MCP Registry in the `demo` workspace as `storm-castle-taunts` (docs/SCM-SETUP.md §7), then "verify the MCP server".
- [x] Wire it into the app: let the sentry call the tool when it taunts, and keep the curated list as the fallback if the tool fails.
- [x] Decide which levels use it: all of them. Turn 2 carries the tool result back through the level's config, so its output guardrails scan the reply. Revisit MCP-level guardrails once we see what the MCP Registry offers.
- [x] Add a unit test (the tool never returns "elderberr") and a rehearsal check that it doesn't change open or block rates (`rehearse.js` reports `tool x/n`; full capped run still to do through the gateway).

## Red-team the guard with Prisma AIRS AI Red Teaming (walkthrough ready 2026-10-08: docs/RED-TEAM.md)
The guard is a good red-teaming target: a small agent with a secret (the per-level password), a consequential action (`open_bridge`), a tool (`generate_insult` via MCP), and three policies to compare (L1 prompt only, L2 regex, L3 AIRS). A red-team report per level would give the booth a "before and after" slide, and could find attacks the cards don't cover.

- [x] Check what Prisma AIRS AI Red Teaming needs from a target (endpoint type, auth, request/response format) and how it reaches it. The stack runs on the laptop, so a SaaS scanner can't call `localhost` directly. Find the supported way to connect a private target (SCM has AI Security → AI Red Teaming → Network Channels and Targets; check whether that's the way) rather than opening a tunnel ourselves, and check it's acceptable on the corporate network. (Network channel `lappy-network-channel`: the client dials out only.)
- [x] Add a headless target endpoint to the app, e.g. `POST /api/redteam {text, level}` → `{reply, outcome}`, that runs `turn.evaluate()` without moving bots or the bridge. Protect it with its own token, off by default, and never expose it on the booth network.
- [x] Decide what to point the scan at: the app endpoint (full system: prompt, guardrails, tool loop, fail-closed parser) or the gateway's chat endpoint with a level config (guardrails + model only). Both, one target per level: REST → app, custom adapter → gateway (`redteam/guard_adapter.py`).
- [x] Define the objectives so the report is meaningful: open the bridge, leak the password, get a non-PG reply, make the tool misbehave. (Agent custom goals + `redteam/guard-prompts.csv`; tool misuse left out, see RED-TEAM §4.)
- [ ] Budget it before running. Every red-team prompt costs AIRS scans at every level (L1/L2 ≈2 per turn with the tool, L3 up to 4). Agree a cap, and run it manually, not on a schedule. (Per-scan cost table in RED-TEAM §5; check before each scan.)
- [ ] Run the scans (L2/L3 × REST/adapter): prompt set first, then Agent, then Attack Library.
- [ ] Check what Agentic Profiling did on `storm-castle-guard-L2`:
  - Read its probing prompts in SCM AI Gateway logs (user `redteam`, before the first scan). Do the first probes mention the drawbridge, password or Captain? Then it read the Use Case.
  - Compare the saved profile with the real guard: did it discover the password rule, the Captain exception, the insult tool?
  - Compare L2 vs L3: how many probes AIRS blocked, and whether the L3 profile is thinner.
- [ ] Feed findings back: new cards for attacks that work at L1/L2, and anything that gets past L3 goes to the AIRS profile or the playbook.

## Explain how the app gets the tool call out of the model's reply
Question from booth prep: "how does the app pull the tool to use from the model's response, which follows the OpenAI API spec?" Short answer: it reads `choices[0].message.tool_calls` in the turn 1 reply (`app/src/gateway.js`), takes the first call's `function.name` and JSON-string `function.arguments`, checks the name against the tools discovered over MCP, runs it, and sends the result back as a `role: "tool"` message with the matching `tool_call_id` (`runTool` in `app/src/turn.js`, `withToolResult` in `app/src/sentry.js`).

- [ ] Add a short "Tool calls, on the wire" section to `docs/ARCHITECTURE.md` with trimmed example JSON: the turn 1 request (`tools`, `tool_choice: "auto"`), the reply with `tool_calls`, and the turn 2 request with the assistant + tool messages.
- [ ] Add a booth FAQ entry in `docs/BOOTH-PLAYBOOK.md`: "the model doesn't run anything, it only asks; the app decides and runs the tool through the gateway".
- [ ] Consider showing the raw `tool_calls` entry (name + arguments) in the staff trace, next to the tool row, so the explanation can be pointed at live.
