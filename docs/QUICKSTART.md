# Quickstart: run Storm the Castle on your Mac

About 20 minutes, mostly downloads. Everything runs on your Mac except the gateway's control plane, which is the SCM tenant **`lhoskinson-us`**. The demo's guardrails, configs and AIRS profiles already exist there; your only console job is to register your own gateway (step 1).

## Short version
**You'll need:** a Mac with about 15 GB free, Docker Desktop with Kubernetes enabled (Settings → Kubernetes → Enable, wait for green), Homebrew, and the two keys from the demo owner's email. Minecraft Java 1.21.4 is optional.

1. **Register your gateway:** in Strata Cloud Manager, switch to tenant `lhoskinson-us` → AI Security → Home → AI Gateway tile → **Deploy Hybrid**. Name it `lappy-<yourname>`, select workspace `demo`, then **Download values.yaml** → **Done** → **Commit** (Commit is required).
2. **Run setup:**
   ```bash
   git clone https://github.com/lhosko/holygrail.git storm-the-castle && cd storm-the-castle
   ./setup.sh ~/Downloads/<the values.yaml you downloaded>
   ```
   It asks for the **AIRS API key** and the **gateway service key** (paste them; nothing shows as you type) and your Minecraft username. Please don't forward the keys or put them in chat or git.

Setup takes about 15 minutes and ends with the URLs and your staff PIN. The detailed steps and troubleshooting follow.

## Before you start
- [ ] **A Mac** (Apple Silicon recommended: the guard is an 8B model running locally) with about 15 GB free.
- [ ] **Docker Desktop**, recent. Then turn on **Settings → Kubernetes → Enable Kubernetes → Apply** and wait until it shows green.
- [ ] **Homebrew** (https://brew.sh). Setup uses it to install `kubectl` and `helm` if you don't have them.
- [ ] **Access to the SCM tenant `lhoskinson-us`**, with permission to deploy an AI Gateway. Ask the demo owner if you can't see it.
- [ ] **Two keys from the demo owner's email:** the **AIRS API key** and the **gateway service key**. Keep them out of chat, docs and git.
- [ ] **Minecraft Java Edition** on version 1.21.4, for the TV view. It's optional: without it, use the browser view (`VIEWER=1` below).

## 1. Register your gateway in SCM (5 min)
This gives the gateway on your laptop its own identity in the tenant.
1. Sign in at https://stratacloudmanager.paloaltonetworks.com and switch to the tenant **`lhoskinson-us`** using the tenant picker at the top.
2. In the left nav go to **AI Security → Home**. On the **AI Gateway** tile, choose **Deploy Hybrid**.
3. Name it **`lappy-<yourname>`**, for example `lappy-jsmith`.
   - Always create a new deployment with your own name. Never re-run or edit someone else's: that issues a new token and disconnects their gateway.
4. Select the workspace **`demo`**.
5. Click **Download values.yaml**, then **Done**, then **Commit**.
   - **Commit is required.** Downloading alone doesn't finish the registration.
   - The file lands in `~/Downloads`. It contains your gateway's credentials: don't share or commit it.

## 2. Run setup (15 min)
```bash
git clone https://github.com/lhosko/holygrail.git storm-the-castle && cd storm-the-castle
./setup.sh ~/Downloads/<the values.yaml from step 1>
```
It asks for three things: the **AIRS API key** and the **gateway service key** (paste them; nothing shows as you type), then your **Minecraft username**. Then it:
1. checks Docker, Kubernetes and the ports,
2. installs kubectl and helm,
3. writes `.env` and `gateway/.secrets/gateway.env` (both gitignored),
4. pulls the model,
5. starts your AI gateway and the guard's tool on local Kubernetes,
6. starts the Minecraft server and the app,
7. sends a few test prompts through the gateway.

It ends with **Ready.**, the URLs and your staff PIN. In SCM, AI Gateway → Admin Settings should now show `lappy-<yourname>` as **Connected**.

## 3. Play
- **Attendee view:** http://localhost:3000. This is the screen people play on.
- **Staff view:** http://localhost:3000/staff (PIN from setup, also in `.env`). All health dots should be green.
- **Minecraft:** Multiplayer → Direct Connection → `localhost`, using the username you gave. Press **F1** for the clean camera.

Voice input is optional: `./setup.sh --whisper` installs local speech-to-text.

## Day to day
| | |
|---|---|
| Start again (after a reboot) | Start Docker Desktop, then `./setup.sh`. It skips what's already done. |
| Stop | `docker compose down` |
| Remove everything | `./teardown.sh` (`--all` also deletes the world). Then delete your `lappy-<yourname>` deployment in SCM if you're done for good. |
| Running the booth | [BOOTH-PLAYBOOK](BOOTH-PLAYBOOK.md) |

## If something goes wrong
`setup.sh` stops at the first problem and prints the fix. The common ones:

| Symptom | Fix |
|---|---|
| "Kubernetes isn't enabled" | Docker Desktop → Settings → Kubernetes → Enable, wait for green, re-run. |
| "Port 8787/3000/25565 is in use" | Something else is listening. Stop it, or find it with the `lsof` command shown. |
| "Couldn't read the gateway registration" | That isn't the Deploy Hybrid values.yaml. Download it again from step 1. |
| Gateway not healthy, or SCM doesn't show it Connected | `kubectl --context docker-desktop -n airs-gw get pods`. `ImagePullBackOff`: re-run `./setup.sh`. `CrashLoopBackOff`: the registration wasn't committed or was replaced. Redo step 1 with a new name, then `./setup.sh ~/Downloads/<new values.yaml> --force`. |
| Smoke test fails with 401 | The service key was mistyped. Delete `.env` and re-run `./setup.sh` to enter it again. |
| Level 3 never blocks anything | The AIRS key was mistyped. Re-run `./setup.sh ~/Downloads/<values.yaml> --force` and enter it again. |
| Guard says "dozed off" | Check `docker model ls` shows the model, then `docker compose logs app`. |
| No Minecraft licence | Set `VIEWER=1` in `.env`, run `docker compose up -d app`, then open http://localhost:3007. |
