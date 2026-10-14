import { EventEmitter } from 'node:events';
import { rcon, rconAll, sleep } from './rcon.js';
import { config } from './config.js';
import { lever } from './world.js';
import { leverCommand, loweringFrames, raisingFrames } from './castle.js';

// The sentry flips a real lever; this watcher animates the drawbridge to match it.
// (RCON animation instead of a piston contraption: no redstone timing to go wrong at the booth.)
// Events: 'opening', 'opened', 'closing', 'closed'.
export const bridge = new EventEmitter();

let state = 'closed'; // closed | opening | open | closing
let closeTimer = null;
let polling = null;

export const bridgeState = () => state;

async function leverPowered() {
  const out = await rcon(`execute if block ${lever.x} ${lever.y} ${lever.z} lever[powered=true]`);
  return /passed/i.test(out);
}

async function animate(frames) {
  for (const frame of frames) {
    await rconAll(frame);
    await sleep(700);
  }
}

async function open() {
  state = 'opening';
  bridge.emit('opening');
  await animate(loweringFrames());
  state = 'open';
  bridge.emit('opened');
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => close().catch(() => {}), config.booth.bridgeOpenSeconds * 1000);
}

export async function close() {
  if (state === 'closed' || state === 'closing') return;
  clearTimeout(closeTimer);
  state = 'closing';
  bridge.emit('closing');
  await rcon(leverCommand(false)).catch(() => {});
  await animate(raisingFrames());
  state = 'closed';
  bridge.emit('closed');
}

// Used by reset: snap to closed without animating.
export function markClosed() {
  clearTimeout(closeTimer);
  state = 'closed';
}

export function startBridgeWatcher(intervalMs = 400) {
  if (polling) return;
  polling = setInterval(async () => {
    if (state === 'opening' || state === 'closing') return;
    try {
      const powered = await leverPowered();
      if (powered && state === 'closed') await open();
      else if (!powered && state === 'open') await close();
    } catch {
      // RCON down; the next tick retries.
    }
  }, intervalMs);
}

export function stopBridgeWatcher() {
  clearInterval(polling);
  polling = null;
  clearTimeout(closeTimer);
}
