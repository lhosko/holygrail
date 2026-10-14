# Storm the Castle 🏰

A walk-up conference booth demo. Attendees try to trick an LLM-powered Minecraft guard into lowering a drawbridge. The game shows three security postures on the **same AI gateway**:

1. System prompt only.
2. Regex guardrail.
3. Prisma AIRS.

The gateway is the **SCM AI Gateway**, Palo Alto Networks' Portkey-based gateway, running as a hybrid data plane on local Kubernetes and managed from Strata Cloud Manager.

There are also two bonus scenarios: indirect injection (Trojan Rabbit) and data leakage (Secret Password).

- [Architecture](docs/ARCHITECTURE.md)
- [SCM AI Gateway / AIRS setup](docs/SCM-SETUP.md)
- [Booth playbook](docs/BOOTH-PLAYBOOK.md)

## Run it on your Mac
Register your own gateway in SCM tenant `lhoskinson-us` (Deploy Hybrid), then with Docker Desktop + Kubernetes enabled:
```bash
./setup.sh ~/Downloads/<values.yaml from Deploy Hybrid>
```
Details and troubleshooting are in **[QUICKSTART](docs/QUICKSTART.md)**. If you're the owner onboarding someone, see [SCM-SETUP → Onboarding a colleague](docs/SCM-SETUP.md#onboarding-a-colleague-2-min-each).

## Owner setup (new tenant, by hand)
This is what `setup.sh` automates, plus the SCM console work it depends on.
1. **Docker Desktop:**
   - Settings → Kubernetes → Enable.
   - Then run `docker desktop enable model-runner --tcp 12434`.
   - Then `docker model pull ai/llama3.1:8B-Q4_K_M` (and any of `ai/mistral:7B-Q4_K_M`, `ai/gemma3:4b-q4_K_M`, `ai/gemma4:e4b-q4_K_M`, `ai/gemma4:12b-q4_K_M`; tags verified on Docker Hub).
2. **Whisper:** `brew install whisper-cpp && scripts/setup-whisper.sh`. This gives you a Mac-wide STT on `127.0.0.1:8178`.
3. **Gateway:** `gateway/install.sh`. It reads `gateway/.secrets/gateway.env` and is pinned to the `docker-desktop` context.
4. **SCM objects:** follow [SCM-SETUP](docs/SCM-SETUP.md). It covers the AIRS profiles, then the integration, guardrails, configs and service key in the SCM console.
5. **Configure:** `cp example.env .env`, then fill in the SCM values (`GATEWAY_API_KEY`, `CONFIG_L1/2/3`, guardrail ids), `CAMERA_PLAYER`, `RCON_PASSWORD` and `STAFF_PIN`.
6. **Run:** `docker compose up -d --build`. The castle builds itself on first start.
   - Attendee view: http://localhost:3000
   - Staff view: http://localhost:3000/staff
   - Minecraft: `localhost:25565`

## Handy commands
```bash
cd app && npm test                                                       # unit tests (no services needed)
docker compose run --rm --no-deps app node scripts/rehearse.js --runs 5  # success-rate targets (uses AIRS scans, capped)
docker compose exec app node scripts/soak.js --duration 15m              # manual, capped soak test
docker compose exec app node scripts/build-castle.js                     # rebuild the world
```
