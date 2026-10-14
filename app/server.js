import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';

import { config } from './src/config.js';
import { content, cardById, reloadContent, pick } from './src/content.js';
import { checkInput } from './src/safety.js';
import { evaluate } from './src/turn.js';
import { redteamHandler } from './src/redteam.js';
import { session } from './src/session.js';
import { gatewayHealthy, modelHealthy, directMode } from './src/gateway.js';
import { sentryTools, mcpStatus } from './src/mcp.js';
import { rcon, rconHealthy, sleep } from './src/rcon.js';
import { buildCastle, resetCastle } from './src/castle.js';
import { bridge, bridgeState, startBridgeWatcher, markClosed, close as closeBridge } from './src/bridge.js';
import { sentry, say, pullLever, cowCameo, sentryPosition, SENTRY_NAME } from './src/bot.js';
import { knight, approach, cross, retreat, home, position as knightPosition, KNIGHT_NAME } from './src/knight.js';
import { cut, bubble, clearBubbles } from './src/camera.js';
import { placeRabbit, removeRabbit, readSign } from './src/context.js';
import { lever } from './src/world.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const minecraftEnabled = process.env.NO_MINECRAFT !== '1';

// ---------- state ----------
const state = {
  busy: false,
  royalSeal: false, // staff encore: LLM proposes, a human approves
  pendingSeal: null, // { resolve, result }
  hidden: false,
  health: {},
  lastAttractAt: 0,
  wasIdle: false,
};

const publicState = () => ({
  visitor: session.visitor,
  hall: session.hall,
  model: config.model.current,
  models: config.model.choices,
  royalSeal: state.royalSeal,
  sealPending: !!state.pendingSeal,
  busy: state.busy,
  bridge: bridgeState(),
  hidden: state.hidden,
  health: state.health,
  direct: directMode(),
  preamble: content.preamble,
  levels: content.levels,
  bonus: content.bonus,
  cards: content.cards,
  idle: session.idle(),
});

// ---------- web + websocket ----------
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcast(type, data = {}) {
  const msg = JSON.stringify({ type, data, at: Date.now() });
  for (const ws of wss.clients) if (ws.readyState === 1) ws.send(msg);
}

wss.on('connection', (ws) => ws.send(JSON.stringify({ type: 'state', data: publicState() })));

app.use(express.json({ limit: '16kb' }));
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url)), { index: 'index.html' }));
app.get('/staff', (_req, res) => res.sendFile(fileURLToPath(new URL('./public/staff.html', import.meta.url))));

const staffOnly = (req, res, next) =>
  req.get('x-staff-pin') === config.staffPin ? next() : res.status(401).json({ error: 'Staff PIN required' });

// ---------- the attempt ----------
async function runAttack({ text, cardId, source = 'ui' }) {
  const v = session.visitor;
  const level = v.level;
  const scenario = v.scenario;
  const card = cardById(cardId);

  let gateContext = null;
  if (scenario === 'trojan') {
    const decree = card?.decree || content.cards['trojan-gift'].decree;
    gateContext = minecraftEnabled ? readSign(sentry.bot, decree).text : decree;
  }

  broadcast('attempt', { text, cardId, level, scenario, source, gateContext });
  log(`attempt L${level}${scenario ? '/' + scenario : ''} card=${cardId || 'own'}: ${text.slice(0, 80)}`);

  const walking = minecraftEnabled
    ? Promise.all([cut('wide'), approach().catch(() => {})]).then(() => bubble('visitor', text, knightPosition()))
    : Promise.resolve();

  const result = await evaluate({ text, level, scenario, cardId, gateContext, metadata: { visitor: v.id } });
  const earned = session.record({ level, scenario, outcome: result.outcome });
  result.knightName = earned || v.knightName;
  result.earned = !!earned;
  if (result.outcome === 'opened' && state.royalSeal) result.awaitingSeal = true;
  log(`  -> ${result.outcome} (${result.latencyMs ?? '-'}ms) ${result.error || ''}`);
  broadcast('result', result);

  // Choreography runs after the UI already has the verdict.
  (async () => {
    try {
      await Promise.race([walking, sleep(8000)]);
      if (minecraftEnabled) {
        await cut('sentry');
        await bubble('sentry', result.dialogue, sentryPosition());
        say(result.dialogue);
        if (result.cow) await cowCameo();
      }
      await sleep(2500);

      let open = result.outcome === 'opened';
      if (open && state.royalSeal) {
        broadcast('seal_pending', { dialogue: result.dialogue, traceId: result.traceId });
        open = await new Promise((resolve) => {
          state.pendingSeal = { resolve };
          setTimeout(() => resolve(false), 60000);
        });
        state.pendingSeal = null;
        broadcast('seal_decided', { approved: open });
        if (!open && minecraftEnabled) {
          await bubble('sentry', 'Hmm, no royal seal? Then ze bridge stays UP!', sentryPosition());
          say('Hmm, no royal seal? Then ze bridge stays UP!');
        }
      }

      if (open && minecraftEnabled) {
        await cut('lever');
        const opened = new Promise((r) => bridge.once('opened', r));
        await pullLever(log);
        await Promise.race([opened, sleep(12000)]);
        await cut('bridge');
        await sleep(800);
        cut('courtyard');
        await cross();
      } else if (minecraftEnabled) {
        await retreat();
      }
      if (minecraftEnabled) await cut('wide');
    } catch (err) {
      log(`choreography error: ${err.message}`);
    } finally {
      state.busy = false;
      broadcast('ready', { busy: false });
    }
  })();

  return result;
}

app.post('/api/attack', async (req, res) => {
  if (state.busy) return res.status(409).json({ error: 'The guard is still dealing with the last knight!' });
  const input = checkInput(req.body?.text);
  if (!input.ok) return res.status(400).json({ error: input.reason });
  state.busy = true;
  broadcast('ready', { busy: true });
  try {
    res.json(await runAttack({ text: input.text, cardId: req.body?.cardId || null }));
  } catch (err) {
    state.busy = false;
    log(`attack error: ${err.stack || err}`);
    res.status(500).json({ error: 'Something went wrong. Try again!' });
  }
});

// Headless target for Prisma AIRS AI Red Teaming: no choreography, session or busy flag. Off unless REDTEAM_TOKEN is set.
app.post(
  '/api/redteam',
  redteamHandler({ evaluate, token: config.redteam.token, maxInFlight: config.redteam.maxInFlight, maxChars: config.booth.maxInputChars }),
);

// Push-to-talk audio (16 kHz mono WAV from the browser) -> local whisper-server.
app.post('/api/transcribe', express.raw({ type: ['audio/wav', 'audio/x-wav', 'application/octet-stream'], limit: '8mb' }), async (req, res) => {
  if (!req.body?.length) return res.status(400).json({ error: 'No audio received' });
  const form = new FormData();
  form.append('file', new Blob([req.body], { type: 'audio/wav' }), 'speech.wav');
  form.append('model', 'whisper-1');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  form.append('prompt', config.whisper.prompt);
  const started = performance.now();
  try {
    const r = await fetch(`${config.whisper.url.replace(/\/$/, '')}/v1/audio/transcriptions`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: json.error?.message || json.error || `Whisper HTTP ${r.status}` });
    session.touch();
    res.json({ text: String(json.text || '').trim(), ms: Math.round(performance.now() - started) });
  } catch (err) {
    res.status(502).json({ error: `Speech service unavailable (${err.message}). Type instead!` });
  }
});

app.get('/api/state', (_req, res) => res.json(publicState()));

app.post('/api/visitor', async (_req, res) => {
  session.newVisitor();
  await setScenario(null);
  broadcast('state', publicState());
  res.json(publicState());
  // The preamble ends on the guard's line; he shouts it in-game as the new knight arrives.
  const closer = content.preamble?.closer;
  if (closer && minecraftEnabled && sentry.ready) {
    say(closer);
    bubble('sentry', closer, sentryPosition()).catch(() => {});
  }
});

app.post('/api/level', (req, res) => {
  session.setLevel(req.body?.level);
  broadcast('state', publicState());
  res.json(publicState());
});

async function setScenario(scenario) {
  const before = session.visitor.scenario;
  session.setScenario(scenario);
  const after = session.visitor.scenario;
  if (!minecraftEnabled || before === after) return;
  if (after === 'trojan') {
    await placeRabbit(content.cards['trojan-gift'].decree).catch((e) => log(`rabbit: ${e.message}`));
    await cut('wide');
  } else if (before === 'trojan') {
    await removeRabbit();
  }
}

app.post('/api/scenario', async (req, res) => {
  await setScenario(req.body?.scenario || null);
  broadcast('state', publicState());
  res.json(publicState());
});

// ---------- staff ----------
app.post('/api/staff/check', staffOnly, (_req, res) => res.json({ ok: true }));

app.post('/api/staff/model', staffOnly, (req, res) => {
  const model = req.body?.model;
  if (!config.model.choices.includes(model)) return res.status(400).json({ error: 'Unknown model' });
  config.model.current = model;
  log(`model -> ${model}`);
  broadcast('state', publicState());
  res.json(publicState());
});

app.post('/api/staff/royal-seal', staffOnly, (req, res) => {
  state.royalSeal = !!req.body?.enabled;
  broadcast('state', publicState());
  res.json(publicState());
});

app.post('/api/staff/seal', staffOnly, (req, res) => {
  if (!state.pendingSeal) return res.status(409).json({ error: 'Nothing awaiting the Royal Seal' });
  state.pendingSeal.resolve(!!req.body?.approve);
  res.json({ ok: true });
});

app.post('/api/staff/hide', staffOnly, (req, res) => {
  state.hidden = req.body?.hidden ?? !state.hidden;
  broadcast('hide', { hidden: state.hidden });
  res.json({ hidden: state.hidden });
});

app.post('/api/staff/reset', staffOnly, async (_req, res) => {
  await resetWorld();
  res.json(publicState());
});

app.post('/api/staff/rebuild', staffOnly, async (_req, res) => {
  const { errors } = await buildCastle(log);
  await resetWorld();
  res.json({ errors: errors.length });
});

app.post('/api/staff/open', staffOnly, async (_req, res) => {
  await pullLever(log);
  res.json({ ok: true });
});

app.post('/api/staff/reload-content', staffOnly, (_req, res) => {
  reloadContent();
  broadcast('state', publicState());
  res.json({ ok: true });
});

app.post('/api/staff/reset-hall', staffOnly, (_req, res) => {
  session.resetHall();
  broadcast('state', publicState());
  res.json({ ok: true });
});

app.post('/api/staff/camera', staffOnly, async (req, res) => {
  await cut(req.body?.shot || 'wide');
  res.json({ ok: true });
});

async function resetWorld() {
  state.busy = false;
  state.pendingSeal?.resolve(false);
  markClosed();
  if (minecraftEnabled) {
    await resetCastle().catch((e) => log(`reset: ${e.message}`));
    await clearBubbles();
    await removeRabbit();
    if (session.visitor.scenario === 'trojan') await placeRabbit(content.cards['trojan-gift'].decree).catch(() => {});
    await home();
    await cut('wide');
  }
  broadcast('state', publicState());
}

// ---------- health ----------
async function whisperHealthy() {
  try {
    await fetch(config.whisper.url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

// Green when the guard's tools were discovered through the gateway. The taunts server is cluster-internal
// (infra/taunts), so the gateway is the only way to see it.
async function mcpHealthy() {
  if (!config.mcp.enabled) return null;
  return (await sentryTools()).length > 0;
}

async function cameraOnline() {
  if (!config.mc.cameraPlayer) return null;
  const list = await rcon('list').catch(() => '');
  return list.includes(config.mc.cameraPlayer);
}

async function checkHealth() {
  const [gateway, model, whisper, minecraft, cameraPlayer, mcp] = await Promise.all([
    gatewayHealthy(),
    modelHealthy(),
    whisperHealthy(),
    minecraftEnabled ? rconHealthy() : null,
    minecraftEnabled ? cameraOnline() : null,
    mcpHealthy(),
  ]);
  state.health = {
    gateway,
    model,
    whisper,
    minecraft,
    sentry: minecraftEnabled ? sentry.ready : null,
    knight: minecraftEnabled ? knight.ready : null,
    camera: cameraPlayer,
    configs: Object.values(config.gateway.configs).every(Boolean),
    mcp,
    mcpDetail: mcpStatus(),
  };
  broadcast('health', state.health);
}

// ---------- attract mode ----------
function attractTick() {
  const idle = session.idle();
  if (idle !== state.wasIdle) {
    state.wasIdle = idle;
    broadcast('idle', { idle });
  }
  if (!idle || state.busy) return;
  if (Date.now() - state.lastAttractAt < config.booth.attractTauntSeconds * 1000) return;
  state.lastAttractAt = Date.now();
  const line = pick(content.attractTaunts); // curated: idle time costs no tokens
  broadcast('attract', { line });
  if (minecraftEnabled && sentry.ready) {
    say(line);
    bubble('sentry', line, sentryPosition()).catch(() => {});
  }
}

// ---------- startup ----------
async function ensureCastle() {
  for (let i = 0; i < 30 && !(await rconHealthy()); i++) await sleep(2000);
  const leverThere = /passed/i.test(await rcon(`execute if block ${lever.x} ${lever.y} ${lever.z} lever`).catch(() => ''));
  if (!leverThere) {
    log('castle not found; building it');
    await buildCastle(log);
  } else {
    await resetCastle();
  }
}

server.listen(config.port, async () => {
  log(`Storm the Castle on http://localhost:${config.port}  (staff: /staff)`);
  if (directMode()) log('WARNING: DIRECT_MODEL=1, bypassing the gateway. No guardrails at any level.');
  setInterval(checkHealth, 10000);
  setInterval(attractTick, 5000);
  checkHealth();

  if (!minecraftEnabled) return log('NO_MINECRAFT=1: running without the game');
  await ensureCastle().catch((e) => log(`castle: ${e.message}`));
  startBridgeWatcher();
  for (const [name, b] of [[SENTRY_NAME, sentry], [KNIGHT_NAME, knight]]) {
    b.on('log', log);
    b.on('ready', () => log(`${name} ready`));
    b.start();
  }
  bridge.on('opened', () => broadcast('bridge', { state: 'open' }));
  bridge.on('closed', () => broadcast('bridge', { state: 'closed' }));

  // In-game backup input: type "!sentry <message>" in Minecraft chat.
  sentry.on('chat', async (from, message) => {
    if (from === SENTRY_NAME || from === KNIGHT_NAME || !message.startsWith('!sentry ')) return;
    if (state.busy) return;
    const input = checkInput(message.slice(8));
    if (!input.ok) return;
    state.busy = true;
    runAttack({ text: input.text, source: 'minecraft' }).catch(() => { state.busy = false; });
  });

  setTimeout(() => cut('wide'), 5000);

  if (config.booth.viewer) {
    sentry.once('ready', async (bot) => {
      try {
        const { mineflayer: viewer } = await import('prismarine-viewer');
        viewer(bot, { port: 3007, firstPerson: false, viewDistance: 4 });
        log('prismarine-viewer on http://localhost:3007');
      } catch (err) {
        log(`viewer unavailable: ${err.message}`);
      }
    });
  }
});

const shutdown = async () => {
  log('shutting down');
  await closeBridge().catch(() => {});
  sentry.stop();
  knight.stop();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
