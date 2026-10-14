# Quickstart: run Storm the Castle on your Mac

About 15 minutes, mostly downloads. You use the demo owner's SCM tenant, so there's no console setup on your side.

## Before you start
- [ ] **A Mac** (Apple Silicon recommended: the guard is an 8B model running locally) with about 15 GB free.
- [ ] **Docker Desktop**, recent. Then turn on **Settings → Kubernetes → Enable Kubernetes → Apply** and wait until it shows green.
- [ ] **Homebrew** (https://brew.sh). Setup uses it to install `kubectl` and `helm` if you don't have them.
- [ ] **Your bundle file** `storm-castle-<you>.env` from the demo owner. It holds your own gateway registration and key. Keep it private, and don't commit it.
- [ ] **Minecraft Java Edition** on version 1.21.4, for the TV view. It's optional: without it, use the browser view (`VIEWER=1` below).

## Run it
```bash
git clone https://github.com/lhosko/holygrail.git storm-the-castle && cd storm-the-castle
./setup.sh ~/Downloads/storm-castle-<you>.env
```
It asks once for your Minecraft username. Then it:
1. checks Docker, Kubernetes and the ports,
2. installs kubectl and helm,
3. writes `.env` and the gateway secrets,
4. pulls the model,
5. starts the AI gateway and the guard's tool on local Kubernetes,
6. starts the Minecraft server and the app,
7. sends a few test prompts through the gateway.

It ends with **Ready.**, the URLs and your staff PIN.

Then:
- **Attendee view:** http://localhost:3000. This is the screen people play on.
- **Staff view:** http://localhost:3000/staff (PIN from setup, also in `.env`). All health dots should be green.
- **Minecraft:** Multiplayer → Direct Connection → `localhost`, using the username you gave. Press **F1** for the clean camera.

Voice input is optional: `./setup.sh --whisper` installs local speech-to-text.

## Day to day
| | |
|---|---|
| Start again (after a reboot) | Start Docker Desktop, then `./setup.sh`. It skips what's already done. |
| Stop | `docker compose down` |
| Remove everything | `./teardown.sh` (`--all` also deletes the world) |
| Running the booth | [BOOTH-PLAYBOOK](BOOTH-PLAYBOOK.md) |

## If something goes wrong
`setup.sh` stops at the first problem and prints the fix. The common ones:

| Symptom | Fix |
|---|---|
| "Kubernetes isn't enabled" | Docker Desktop → Settings → Kubernetes → Enable, wait for green, re-run. |
| "Port 8787/3000/25565 is in use" | Something else is listening. Stop it, or find it with the `lsof` command shown. |
| Gateway not healthy | `kubectl --context docker-desktop -n airs-gw get pods`. If the pod is in `ImagePullBackOff`, re-run `./setup.sh`. If it's `CrashLoopBackOff`, ask the owner whether your registration is still valid. |
| Smoke test fails with 401 | Your service key was revoked or mistyped. Ask the owner for a new bundle, then run `./setup.sh <bundle> --force`. |
| Guard says "dozed off" | Check `docker model ls` shows the model, then `docker compose logs app`. |
| No Minecraft licence | Set `VIEWER=1` in `.env`, run `docker compose up -d app`, then open http://localhost:3007. |

Every AIRS check counts against the owner's tenant, so please don't run soak tests or red-team scans without asking.
