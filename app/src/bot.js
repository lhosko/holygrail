import { Vec3 } from 'vec3';
import { managedBot, goTo, goals } from './mcbot.js';
import { rcon, rconAll, sleep } from './rcon.js';
import { leverCommand } from './castle.js';
import { sentryPost, lever, cowSpot } from './world.js';

export const SENTRY_NAME = 'FrenchSentry';

// The guard on the wall. It only leaves its post to pull the lever.
export const sentry = managedBot(SENTRY_NAME, async (bot) => {
  await rconAll([
    `gamemode adventure ${SENTRY_NAME}`,
    `effect give ${SENTRY_NAME} minecraft:resistance infinite 4 true`,
    `item replace entity ${SENTRY_NAME} armor.head with minecraft:chainmail_helmet`,
    `item replace entity ${SENTRY_NAME} armor.chest with minecraft:chainmail_chestplate`,
    `item replace entity ${SENTRY_NAME} weapon.mainhand with minecraft:stick`,
  ]);
  await returnToPost(bot);
});

const faceMoat = (bot) => bot.lookAt(new Vec3(sentryPost.x + 0.5, sentryPost.y + 1.2, 4));

async function returnToPost(bot) {
  await rcon(`tp ${SENTRY_NAME} ${sentryPost.x + 0.5} ${sentryPost.y} ${sentryPost.z + 0.5} 0 0`);
  await sleep(300);
  await faceMoat(bot);
}

export function say(text) {
  const bot = sentry.bot;
  if (sentry.ready && bot) bot.chat(text.slice(0, 250));
}

// Walk to the lever and flip it on. The bridge watcher does the rest.
// Falls back to setting the lever via RCON so the demo never stalls on pathfinding.
export async function pullLever(log = console.log) {
  const bot = sentry.bot;
  let flipped = false;
  if (sentry.ready && bot) {
    const reached = await goTo(bot, new goals.GoalNear(lever.x, lever.y, lever.z, 2), 8000);
    if (reached) {
      const block = bot.blockAt(new Vec3(lever.x, lever.y, lever.z));
      if (block?.name === 'lever') {
        try {
          await bot.lookAt(block.position.offset(0.5, 0.2, 0.5));
          await bot.activateBlock(block);
          flipped = true;
        } catch (err) {
          log(`sentry: activateBlock failed: ${err.message}`);
        }
      }
    } else {
      log('sentry: could not reach lever, using RCON fallback');
    }
  }
  if (!flipped) await rcon(leverCommand(true));
  setTimeout(() => sentry.ready && returnToPost(sentry.bot).catch(() => {}), 2500);
}

// "Fetchez la vache!" as a gentle cameo: a cow appears on the battlements, moos, and leaves.
export async function cowCameo(seconds = 4) {
  const { x, y, z } = cowSpot;
  await rconAll([
    `summon cow ${x + 0.5} ${y} ${z + 0.5} {Tags:["cameo"],NoAI:1b,Invulnerable:1b,Rotation:[0f,0f]}`,
    `particle minecraft:heart ${x + 0.5} ${y + 1.5} ${z + 0.5} 0.4 0.3 0.4 0 6`,
    `playsound minecraft:entity.cow.ambient neutral @a ${x} ${y} ${z} 2`,
  ]).catch(() => {});
  setTimeout(() => {
    rconAll([
      `particle minecraft:poof ${x + 0.5} ${y + 0.8} ${z + 0.5} 0.3 0.3 0.3 0 10`,
      'kill @e[type=cow,tag=cameo]',
    ]).catch(() => {});
  }, seconds * 1000);
}

export const sentryPosition = () => ({ ...sentryPost });
