import { Rcon } from 'rcon-client';
import { config } from './config.js';

// Single shared RCON connection with lazy reconnect and serialized commands.
let client = null;
let connecting = null;
let queue = Promise.resolve();

async function connect() {
  if (client) return client;
  if (!connecting) {
    connecting = Rcon.connect({
      host: config.mc.rconHost,
      port: config.mc.rconPort,
      password: config.mc.rconPassword,
    })
      .then((c) => {
        c.on('end', () => { client = null; });
        c.on('error', () => { client = null; });
        client = c;
        return c;
      })
      .finally(() => { connecting = null; });
  }
  return connecting;
}

export function rcon(command) {
  const run = queue.then(async () => {
    try {
      const c = await connect();
      return await c.send(command);
    } catch (err) {
      client = null;
      throw err;
    }
  });
  queue = run.catch(() => {});
  return run;
}

export async function rconAll(commands) {
  const out = [];
  for (const cmd of commands) out.push(await rcon(cmd));
  return out;
}

export async function rconHealthy() {
  try {
    await rcon('list');
    return true;
  } catch {
    return false;
  }
}

// Text component JSON for 1.21.4 NBT, safely embedded in a single-quoted SNBT string.
export function snbtText(text, color = 'white') {
  const json = JSON.stringify({ text, color });
  return `'${json.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
