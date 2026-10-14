import { EventEmitter } from 'node:events';
import mineflayer from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { config } from './config.js';
import { sleep } from './rcon.js';

const { pathfinder, Movements, goals } = pathfinderPkg;
export { goals };

// A mineflayer bot that keeps itself connected. `onSpawn(bot)` runs after every (re)spawn.
export function managedBot(username, onSpawn) {
  const ev = new EventEmitter();
  let bot = null;
  let ready = false;
  let stopped = false;

  const connect = () => {
    bot = mineflayer.createBot({
      host: config.mc.host,
      port: config.mc.port,
      version: config.mc.version,
      username,
      auth: 'offline',
      hideErrors: true,
    });
    bot.loadPlugin(pathfinder);

    bot.once('spawn', async () => {
      const moves = new Movements(bot);
      moves.canDig = false;
      moves.allow1by1towers = false;
      moves.allowParkour = false;
      moves.allowSprinting = false;
      moves.scafoldingBlocks = [];
      bot.pathfinder.setMovements(moves);
      try {
        await onSpawn?.(bot);
      } catch (err) {
        ev.emit('log', `${username} spawn setup: ${err.message}`);
      }
      ready = true;
      ev.emit('ready', bot);
    });
    bot.on('chat', (from, message) => ev.emit('chat', from, message));
    bot.on('kicked', (reason) => ev.emit('log', `${username} kicked: ${JSON.stringify(reason)}`));
    bot.on('error', (err) => ev.emit('log', `${username} error: ${err.message}`));
    bot.on('end', () => {
      ready = false;
      if (stopped) return;
      ev.emit('log', `${username} disconnected; reconnecting in 5s`);
      setTimeout(connect, 5000);
    });
  };

  // defineProperties, not Object.assign: assign would copy the getters' values once (null/false forever).
  return Object.defineProperties(ev, {
    start: { value: connect },
    stop: { value: () => { stopped = true; bot?.quit(); } },
    bot: { get: () => bot },
    ready: { get: () => ready },
  });
}

// Pathfind with a hard timeout; resolves false instead of throwing so callers can fall back to RCON tp.
export async function goTo(bot, goal, timeoutMs = 10000) {
  let timer;
  try {
    await Promise.race([
      bot.pathfinder.goto(goal),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    return true;
  } catch {
    bot.pathfinder.stop();
    await sleep(50);
    return false;
  } finally {
    clearTimeout(timer);
  }
}
