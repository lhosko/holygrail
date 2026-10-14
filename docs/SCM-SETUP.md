# SCM setup checklist (you do this; Claude verifies afterwards)

Tenant `lhoskinson-us`, TSG `1241765693`. Allow about 30–45 minutes.

Everything here happens in **Strata Cloud Manager**, on the **SCM AI Gateway**. That is Palo Alto Networks' gateway built on Portkey.
- Nothing uses the legacy Portkey console, `aigw.portkey.ai` or Portkey Admin API keys.
- There is no Terraform. You create the objects in the SCM console. `infra/scm/objects.json` holds the exact values (names, regex, profiles), and verification checks against it.

Work top to bottom and tick the boxes.
- **Secrets** (keys, tokens) go only in `.secrets/` or `.env`, both gitignored. Never paste them into chat, docs or `example.env`.
- **Names and ids** (not secret) go in the **Record** lines, so verification knows what to look for.

> The SCM service account in `.secrets/scm.csv` is **not** used to configure anything. It is used later for read-only verification (§6).

## Names at a glance
Everything you create starts with `storm-castle-`, so it's easy to find (and later delete) in SCM. The one exception is the Model Runner integration (`local-docker-model-runner`). It's generic, so other projects can reuse it: provision it to their workspaces and add their model tags to it. Use these names exactly. Verification looks for them, and they're also in `infra/scm/objects.json`.

| § | What | Where in SCM | Name |
|---|---|---|---|
| 2 | AIRS API application / key | AI Runtime API → API Applications | `storm-castle-booth` |
| 2 | AIRS profile, toxic content filter | AI Runtime API → Configurations † | `storm-castle-toxic` |
| 2 | AIRS profile, Level 3 | AI Runtime API → Configurations † | `storm-castle-l3` |
| 2 | DLP data pattern (the regex) | Data Loss Prevention → Data patterns | `storm-castle-password` |
| 2 | DLP data profile (used by `storm-castle-l3`) | Data Loss Prevention → Data profiles | `storm-castle-dlp` |
| 5 | Integration (Docker Model Runner) | AI Gateway → Integrations → LLM Integrations | name `Local Docker Model Runner`, slug `local-docker-model-runner` |
| 5 | Provider in `demo` | created when you provision the integration; listed in AI Gateway → Catalogs → LLMs → Configured LLMs | `local-docker-model-runner` |
| 5 | Guardrail, Level 2 regex | AI Gateway → Policies & Profiles † | `storm-castle-l2-regex` |
| 5 | Guardrail, Level 3 AIRS | AI Gateway → Policies & Profiles † | `storm-castle-l3-airs` |
| 5 | Guardrail, toxic content filter | AI Gateway → Policies & Profiles † | `storm-castle-toxic-airs` |
| 5 | Configs | AI Gateway → Policies & Profiles † | `storm-castle-l1`, `storm-castle-l2`, `storm-castle-l3` |
| 5 | Workspace service key | AI Gateway → Security Keys → Gateway API Keys → Service | `storm-castle-app` |
| 7 | MCP server (the guard's insult tool) | AI Gateway → Integrations → MCP Registry | `storm-castle-taunts` |

The laptop gateway's hybrid deployment (§3) keeps its existing name.

All paths start from **AI Security** in the SCM left nav. AI Gateway pages have a **Workspace** picker at the top: set it to `demo` first. † = the menu item exists, but which tab holds the object isn't confirmed yet; correct the path here if it's elsewhere.

---

## Onboarding a colleague (2 min each)
Colleagues share this tenant's `demo` workspace and everything in §2, §5 and §7. Each one registers their own gateway (Deploy Hybrid, `lappy-<name>`) as step 1 of [QUICKSTART](QUICKSTART.md), so you can see and remove them one at a time.
1. **Give them access** to `lhoskinson-us` with a role that can deploy an AI Gateway.
2. **Email them the two keys** that `setup.sh` asks for. Copy each to the clipboard without showing it on screen:
   - AIRS API key: `grep '^AIRS_API_KEY=' ~/projects/lappy/ai-gateway/.secrets/gateway.env | cut -d= -f2- | tr -d '\n' | pbcopy`
   - Gateway service key (`storm-castle-app`): `grep '^GATEWAY_API_KEY=' ~/projects/minecraft/.env | cut -d= -f2- | tr -d '\n' | pbcopy`
   - Everyone shares these keys, so revoking one cuts off everybody, you included. Rotate them if they leak.

The config and guardrail IDs aren't secret; they're in `example.env`.

Offboarding: delete their `lappy-<name>` hybrid deployment and remove their tenant access.

Every colleague's AIRS checks run against this tenant's quota (about 2 scans per Level 3 attempt).

## 1. Verification account: nothing to do
`.secrets/scm.csv` **is** the verification service account (`…@1241765693.iam.panserviceaccount.com`). Don't create another one.
- It already reads AI Gateway workspaces, providers, integrations, guardrails and configs. Claude tested this read-only.
- The only untested read is the AIRS security profiles (§2). If that returns 403 at verification time, give the account a read role covering AI Runtime Security, such as View Only Administrator. Until then, skip this section.

## 2. Prisma AIRS: API key and two security profiles (10–15 min)
SCM → **AI Security → AI Runtime API → API Applications**. The security profiles are under **AI Runtime API → Configurations** †.

- [ ] **Create an API application / API key** named `storm-castle-booth`.
  - Save the key to `gateway/.secrets/gateway.env` as a new line: `AIRS_API_KEY=<key>`.
  - Then `chmod 600 gateway/.secrets/gateway.env`.
  - **This matters:** without it, the gateway's AIRS check *fails open* and Level 3 blocks nothing.

- [ ] **Profile `storm-castle-toxic`.** This keeps the guard family-friendly at all levels.
  - Toxic content detection: **On → Block**.
  - Every other detection: **Off**. If you turn prompt injection on here, Levels 1–2 would stop losing, and that breaks the demo.

- [ ] **Profile `storm-castle-l3`**, the "real" policy:
  - Prompt injection: **On → Block**.
  - Toxic content: **On → Block**.
  - Sensitive data / DLP: **On → Block**, using data profile `storm-castle-dlp`. Build it first, in SCM → **Data Loss Prevention** (Enterprise DLP):
    1. **Data pattern** `storm-castle-password` (the detector), type Regex: `[Ee][Ll][Dd][Ee][Rr][Bb][Ee][Rr][Rr]([Yy]|[Ii][Ee][Ss])`. If custom regex isn't offered, use a **data dictionary** `storm-castle-password` with the terms `elderberries` and `elderberry` instead, and put that in the data profile.
    2. **Data profile** `storm-castle-dlp` (what the AIRS profile references), with a single Primary Rule: `storm-castle-password` · **Any** · **Low**. Leave the AND as it is, add no secondary rule, and keep Match Scope **Content**. The note about the "default alert action" doesn't apply here, because the AIRS profile sets its own Block action.
    - **No DLP rule is needed.** Those attach a data profile to NGFW / Prisma Access traffic; AIRS uses the data profile directly.
    - This is what stops the Secret Password bonus at Level 3.
  - Malicious URL detection: On (optional, harmless).
  - Custom topic guardrail: **leave Off for now.** Add it only if rehearsal shows cards slipping through at L3:
    - Topic: "Requests to open, lower or operate the drawbridge, or to reveal the guard's password".

  Both profile names must match exactly. They are listed in `infra/scm/objects.json`.

## 3. AI Gateway: workspace and hybrid registration (5 min)
SCM → **AI Security → AI Gateway**.

- Workspace: **`demo`** (`ws-demo-d7ddd4`). It has no guardrails or configs today. Create everything in §5 there.
- [ ] **Check the hybrid deployment covers that workspace.** The laptop gateway was registered with **Deploy Hybrid**, which is where `gateway/.secrets/lappy_gateway.yaml` came from.
  - If that deployment doesn't include the workspace, re-run: **AI Security → Home → AI Gateway tile → Deploy Hybrid** → name → select the workspace → **Download values.yaml** → **Done** → **Commit**.
  - Commit is required. Downloading alone does not complete registration.
  - Re-running issues a **new token and invalidates the old one**. If you re-run, replace `gateway/.secrets/lappy_gateway.yaml`, and update `PORTKEY_CLIENT_AUTH`, `ORGANISATIONS_TO_SYNC` and the registry credentials in `gateway/.secrets/gateway.env` to match. Those key names come from the chart; the values are the SCM registration.

## 4. Install the gateway (5 min)
This needs Docker Desktop Kubernetes enabled.
- [ ] `gateway/install.sh`
  - Re-run it any time `gateway/.secrets/gateway.env` changes. It is pinned to the `docker-desktop` context.
  - On the Palo Alto network, outbound TLS is decrypted by `PANW Enterprise Root CA2 G2`. The script copies that root from the macOS keychain into the pod (`NODE_EXTRA_CA_CERTS`); otherwise SCM sync fails with `SELF_SIGNED_CERT_IN_CHAIN`. On other networks it skips this step.
  - On first install, Docker Desktop's Kubernetes image mirror can return 500 for the private gateway image. Fix it by pulling the image once on the host, then deleting the pod. See the note at the end of this section.
- [ ] `curl -s localhost:8787/v1/health` returns `{"status":"success","message":"Server is healthy",…}`.
  - Watch out: nothing else may listen on port 8787. A local dev server on `127.0.0.1:8787` takes priority over Docker's listener for `localhost`, and every gateway call then gets a plain `404 not found`. Check with `lsof -nP -iTCP:8787 -sTCP:LISTEN`; only `com.docker` should be listening.
  - If you change `service.port`, Docker Desktop keeps forwarding the old host port until the service is recreated: `kubectl --context docker-desktop -n airs-gw delete svc airs-gw`, then re-run `install.sh`.
- [ ] SCM → **AI Gateway → Admin Settings** † shows the laptop gateway as **Connected**.

> **Image pull note.** If the pod shows `ImagePullBackOff` with `registry-mirror:1273 ... 500`, run:
> `set -a; source gateway/.secrets/gateway.env; set +a; printf %s "$REGISTRY_PASSWORD" | docker login registry.portkey.ai -u "$REGISTRY_USERNAME" --password-stdin && docker pull registry.portkey.ai/airsgw/gateway_enterprise:2.21.0; docker logout registry.portkey.ai`
> then `kubectl --context docker-desktop -n airs-gw delete pod -l app.kubernetes.io/name=airs-gw`. The mirror serves images from the host's local store.

## 5. Create the gateway objects in the SCM console (10 min)
All in SCM → **AI Security → AI Gateway**, with the Workspace picker set to `demo`. Every value is also in `infra/scm/objects.json`.

### How the gateway fronts the local models
**You create this. SCM does not discover local models.** Today the tenant has only three integrations (`lhoskinson-project`, `ts-ai-assisted-api-hub`, `lhosko-gemini-api`) and nothing for Model Runner, which is why you can't see the local models.

```
app ──► laptop gateway :8787 ──► host.docker.internal:12434/engines/v1 (Docker Model Runner)
              ▲ syncs the integration, guardrails and configs from SCM
              │ (definitions only; prompts and model traffic never go via SCM)
         SCM AI Gateway
```

- **Integration (org level).** An *OpenAI* integration that holds the model list. Model Runner speaks the OpenAI API, so it is set up as an OpenAI integration.
- **Custom host (in each config).** SCM's integration form rejects `http://host.docker.internal:12434/engines/v1` ("Invalid request"; it won't take an `http`/private host). So the integration has no custom host, and each config sets `custom_host` on its target instead.
  - The host is resolved **by the gateway pod**, not by SCM. `host.docker.internal` works there because Docker Desktop Kubernetes maps it to the Mac.
  - The gateway only calls private custom hosts it trusts. `gateway/values.yaml` sets `TRUSTED_CUSTOM_HOSTS` to `host.docker.internal` (Model Runner) and the taunts MCP hostname.
- **Models on the integration.** Model Runner has no model catalogue SCM can read, so you add each tag as a **custom model**. Use the exact tag (`/` and `:` are accepted), because the app sends it as `model` on every request.
- **Workspace provisioning → provider.** Provisioning the integration to the workspace creates the workspace **provider** (slug `local-docker-model-runner`). Configs then point at `@local-docker-model-runner`.
- **Config.** This picks the provider plus the guardrails for each level. The app sends the config id and the model tag. The staff page switches models live, which only changes the `model` field, so every tag you might switch to must be on the integration.

### Steps
- [ ] **Integrations → LLM Integrations → Add → OpenAI** (it may be labelled *OpenAI-compatible* / *Custom host*):
  - Name `Local Docker Model Runner`, slug `local-docker-model-runner`.
  - **Leave Custom host empty.** Watch out: filling it in with the Model Runner URL makes Create fail with "Error: Invalid request. Please check and try again." The host goes in the configs below instead.
  - API key: any dummy value such as `not-needed`. Model Runner ignores it.
- [ ] On **Select Models to Provision** (or later under **Integration → Models**), add each tag as a **custom model** and leave the base OpenAI models off:
  - `ai/llama3.1:8B-Q4_K_M`
  - `ai/mistral:7B-Q4_K_M`
  - `ai/gemma3:4b-q4_K_M`
  - `ai/gemma4:e4b-q4_K_M`
  - `ai/gemma4:12b-q4_K_M`
  - Only the ones you've `docker model pull`ed will actually answer. Llama 3.1 is the default.
- [ ] **Integration → Workspaces → Provision** to the `demo` workspace, with provider slug `local-docker-model-runner`. It then shows in **Catalogs → LLMs → Configured LLMs** for `demo`.
  - Watch out: if it isn't provisioned to the workspace, calls fail with `400 Following keys are not valid: local-docker-model-runner`. That looks like a key problem, but it means the provider isn't in this workspace.
- [ ] **Policies & Profiles** † **→ create the guardrails**, all with **Deny on fail**:
  - Watch out: Deny is **off** by default (Actions → *Deny the request if guardrail check fails*). With it off, a failed check is only logged and the request still goes through, so nothing is ever blocked.
  - On the AIRS guardrails, also set App name `storm-castle-booth` and AI model `local-sentry`, so the scans are easy to find in AIRS.
  - Configs and `.env` use the value in the guardrail's **ID** column (`pg-storm-…`). The API calls it the slug.
  - `storm-castle-l2-regex`: **Regex Match**.
    - Rule `\b([Ii]gnore|[Dd]isregard|[Ss]ystem|[Pp]rompt|[Oo]verride|[Aa]dmin|[Bb]ypass)\b`.
    - **Inverse / Not: On**. Without this, it blocks everything that *doesn't* match.
  - `storm-castle-l3-airs`: **Palo Alto Networks Prisma AIRS**.
    - Profile name `storm-castle-l3`.
    - App name `storm-castle-booth`.
  - `storm-castle-toxic-airs`: **Prisma AIRS**, profile name `storm-castle-toxic`.
- [ ] **Policies & Profiles** † **→ create** three separate configs, named `storm-castle-l1`, `storm-castle-l2` and `storm-castle-l3`.
  - Replace the editor's default `retry`/`cache` JSON entirely. A cache would replay the same reply (and could skip the model and guardrails), and retries add latency and extra AIRS scans.
  - Use the guardrails' **ID** values (`pg-storm-…`) in place of the `<… id>` placeholders. Each saved config shows its own ID (`pc-storm-…`) in the Configuration tab, and that goes in `CONFIG_L1`..`CONFIG_L3`.
  ```json
  L1: {"provider":"@local-docker-model-runner","custom_host":"http://host.docker.internal:12434/engines/v1","output_guardrails":["<storm-castle-toxic-airs id>"]}
  L2: {"provider":"@local-docker-model-runner","custom_host":"http://host.docker.internal:12434/engines/v1","input_guardrails":["<storm-castle-l2-regex id>"],"output_guardrails":["<storm-castle-toxic-airs id>"]}
  L3: {"provider":"@local-docker-model-runner","custom_host":"http://host.docker.internal:12434/engines/v1","input_guardrails":["<storm-castle-l3-airs id>"],"output_guardrails":["<storm-castle-l3-airs id>"]}
  ```
  - `custom_host` must be in every config. Without it, the gateway sends requests to api.openai.com with the dummy key and gets a 401.
  - Don't use `localhost`: inside the gateway pod, that is the pod itself.
  - If the config editor rejects `custom_host` at the top level, use the target form: `{"strategy":{"mode":"single"},"targets":[{"provider":"@local-docker-model-runner","custom_host":"…"}], …guardrails}`.
- [ ] **Security Keys → Gateway API Keys → Service → Create New**: a workspace service key named `storm-castle-app`.
  - On **Set up Permissions**, tick **Completions · WRITE**, which is all the app uses today. Also tick **Mcp · INVOKE**, which the guard's insult tool uses (§7), and **Prompts · RENDER** (unused, harmless). Leave Agents and Logs off.
    - The gateway reads configs from its own sync, so there's no config permission to grant.
    - If the first test request doesn't appear in SCM's logs, add **Logs · WRITE**.
  - This is a gateway inference key. It isn't an admin key, and the booth app is the only thing that uses it.
- [ ] `cp example.env .env` and fill in:
  - `GATEWAY_API_KEY`: the service key.
  - `CONFIG_L1/L2/L3`.
  - `GUARDRAIL_REGEX_ID` / `GUARDRAIL_AIRS_ID` / `GUARDRAIL_TOXIC_ID`.

Record the config ids (not secret): L1 `________` L2 `________` L3 `________`

## 6. Hand back to Claude for verification
Say "verify the SCM setup". Claude will:
1. **SCM (read-only):**
   - Mint a token from `.secrets/scm.csv`.
   - Read the workspace's integration, provider, guardrails and configs via `api.apps.paloaltonetworks.com/ai_gw/v2` and `/ai_gw/admin/v2`, and compare them with `infra/scm/objects.json`. This access is already confirmed working.
   - Confirm the two AIRS profiles exist with the detections above. That's a separate AIRS API, not yet tested with this account.
   - Listing API keys returns 403 for this account today. That's fine, because verification uses the service key from `.env` instead.
2. **Gateway:**
   - Check the pod is Ready and SCM shows it Connected.
   - Check the `AIRS_API_KEY` env var is wired. Only its presence is checked; the value is never printed.
   - Check the gateway can reach Model Runner from inside the cluster (`host.docker.internal:12434/engines/v1/models`), and that the tags listed there match the custom models on the integration.
3. **Each level, through the local gateway:**
   - L1 `200` (the bridge opens).
   - L2 English card `446` from the regex, while the French card gets through.
   - L3 cards `446` with an AIRS verdict, and "Bonjour" `200`. This confirms AIRS is **not** failing open.
4. **Logs:** the calls appear in SCM AI Gateway logs and AIRS activity, matched by trace id.
5. **Rehearsal:** a short, capped run (`rehearse.js --runs 2`, about 40 AIRS scans) only if you OK it.

---

## 7. MCP server: the guard's insult tool (5 min)
The guard is an agent with one tool, `generate_insult`. It comes from the taunts MCP server, which runs in Docker Desktop Kubernetes next to the gateway (namespace `storm-castle`, ClusterIP only, no port on the Mac). The app never calls it directly: tool discovery and every tool call go through the laptop gateway's **MCP port 8788**, so the gateway authorises them with the same `storm-castle-app` key and they show up in SCM logs.

```
app ──► laptop gateway :8787  turn 1: the LLM asks for generate_insult{topic}
app ──► laptop gateway :8788 /storm-castle-taunts/mcp ──► taunts.storm-castle.svc.cluster.local/mcp (taunts pod)
app ──► laptop gateway :8787  turn 2: the LLM writes the reply with the tool result
```

Before you start: `infra/taunts/deploy.sh` (builds the image, loads `cards.json`, deploys; re-run after editing either). Then `gateway/install.sh`, so the gateway trusts the server's hostname (`TRUSTED_CUSTOM_HOSTS` in `gateway/values.yaml`). Claude has done both and checked the gateway pod gets `{"ok":true,"tools":["generate_insult"]}` from it.

> Why not a port on the Mac? SCM rejects `http://host.docker.internal:8790/mcp` with "Invalid or unsafe custom host". A cluster-local name is the pattern SCM accepts (same as the GCP demo's `mcp-web-search.mcp.svc.cluster.local`), and it means nothing outside the cluster can call the tool without going through the gateway.

- [ ] SCM → **AI Security → AI Gateway → Integrations → MCP Registry** (Workspace `demo`) → **+ Add MCP Servers**:

  | Field | Value |
  |---|---|
  | Name / slug | `storm-castle-taunts` (the slug is the first path segment of the client URL, so it must be exactly this) |
  | URL | `http://taunts.storm-castle.svc.cluster.local/mcp` |
  | Transport | Streamable HTTP |
  | Auth | None (the server only hands out PG insults; access control is the gateway key) |

  - Leave **Advanced configuration** empty. No JWT validation or identity forwarding: the booth app authenticates with its gateway API key.
  - If the form rejects this URL too, stop and tell Claude rather than working around it.
- [ ] Make sure it's available in workspace `demo` (`ws-demo-d7ddd4`): it should be listed under **Integrations → MCP Registry → Connected** and in **Catalogs → MCP Servers & Tools** for `demo`. If the form had a workspace/provisioning step, pick `demo` there. Without this the gateway answers `Server 'ws-demo-d7ddd4/storm-castle-taunts' not found` (what it says today).
- [ ] **Security Keys → Gateway API Keys → Service → `storm-castle-app`:** confirm **Mcp · INVOKE** is ticked (§5). Without it, MCP calls get 401/403 while chat still works.
- [ ] Optional, only if the MCP server page offers it: MCP guardrails (e.g. scanning tool results). Leave them off for now; the tool's output already goes back through the level's config in turn 2. Note what the page offers so Claude can document it.
- [ ] Nothing to change in `.env` unless you used a different slug. The defaults are `MCP_GATEWAY_URL=http://host.docker.internal:8788` and `MCP_SERVER_SLUG=storm-castle-taunts`. Then `docker compose up -d app`.

Record (not secret): MCP server id `________`

### Hand back to Claude
Say "verify the MCP server". Claude will:
1. **SCM (read-only):** `GET /ai_gw/admin/v2/mcp-integrations` (slug, URL, transport, auth, sync status) and `/mcp-integrations/<id>/workspaces` (`demo` enabled), compared with `infra/scm/objects.json`. Verified 2026-10-06.
2. **Through the gateway:** `initialize` → `tools/list` → `tools/call generate_insult` on `localhost:8788/storm-castle-taunts/mcp` with the service key from `.env` (never printed).
3. **App:** the staff health strip shows **mcp tools** green (not "direct!"), and a taunt turn shows the tool row "via gateway MCP". The trace id of the tool call matches the two chat calls of the same turn in SCM logs.
4. **Rehearsal:** a short, capped run only if you OK it. Tool turns make two LLM calls, so AIRS scans per turn double (up to 4 at L3).
