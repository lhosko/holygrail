// Soak test for the running booth (server + bots + Minecraft). Run it by hand, with you nearby.
// It always stops at the first of: --duration, --max-requests, --max-airs. Nothing is scheduled.
//
//   docker compose exec app node scripts/soak.js                     # 15 min, <=100 requests, L1/L2
//   docker compose exec app node scripts/soak.js --include-l3 --max-airs 20
//
// AIRS cost: every reply is scanned by the toxic content filter (1 scan at L1/L2), L3 adds the prompt scan. Turns where
// the guard calls its MCP tool make two LLM calls, so they cost double. The cap counts actual scans reported back by the gateway.
import { content } from '../src/content.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const parseDuration = (s) => {
  const m = String(s).match(/^(\d+)(s|m|h)?$/);
  if (!m) throw new Error(`Bad --duration ${s}`);
  return Number(m[1]) * { s: 1, m: 60, h: 3600 }[m[2] || 'm'] * 1000;
};

const base = args.url || `http://localhost:${process.env.PORT || 3000}`;
const until = Date.now() + parseDuration(args.duration || '15m');
const maxRequests = Number(args['max-requests'] || 100);
const maxAirs = Number(args['max-airs'] || (args['include-l3'] ? 20 : 100));
const levels = args['include-l3'] ? [1, 2, 3] : [1, 2];
const cards = ['royal-order', 'french-order', 'new-orders', 'bonjour'];

const post = async (path, body) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const getState = async () => (await fetch(`${base}/api/state`)).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`Soak: ${base}, levels ${levels.join(',')}, until ${new Date(until).toLocaleTimeString()}, ` +
  `max ${maxRequests} requests / ${maxAirs} AIRS scans. Ctrl-C to stop early.`);

const tally = {};
let requests = 0;
let airs = 0;
let stuckBridge = 0;
let reason = 'duration reached';

while (Date.now() < until) {
  if (requests >= maxRequests) { reason = 'max requests reached'; break; }
  if (airs >= maxAirs) { reason = 'max AIRS scans reached'; break; }

  // Wait for the previous attempt's choreography (and the bridge) to finish.
  for (let i = 0; i < 60; i++) {
    const s = await getState().catch(() => null);
    if (s && !s.busy && s.bridge === 'closed') break;
    if (i === 59) stuckBridge++;
    await sleep(1000);
  }

  const level = levels[requests % levels.length];
  const cardId = cards[Math.floor(requests / levels.length) % cards.length];
  await post('/api/level', { level });
  const { status, json } = await post('/api/attack', { text: content.cards[cardId].text, cardId });
  requests++;
  const outcome = status === 200 ? json.outcome : `http_${status}`;
  tally[outcome] = (tally[outcome] || 0) + 1;
  airs += (json.verdicts || []).filter((v) => v.kind === 'airs' || v.kind === 'toxic').length;

  const s = await getState().catch(() => ({ health: {} }));
  const h = s.health || {};
  const down = Object.entries(h).filter(([, v]) => v === false).map(([k]) => k);
  console.log(`${new Date().toLocaleTimeString()} #${requests} L${level} ${cardId.padEnd(13)} -> ${outcome.padEnd(14)} ` +
    `${json.latencyMs ?? '-'}ms  airs=${airs}${down.length ? '  DOWN: ' + down.join(',') : ''}`);
  await sleep(4000);
}

console.log(`\nStopped: ${reason}. ${requests} requests, ${airs} AIRS scans, bridge-stuck waits: ${stuckBridge}`);
console.log(JSON.stringify(tally));
process.exit(0);
