import { Vec3 } from 'vec3';
import { managedBot, goTo, goals } from './mcbot.js';
import { rcon, rconAll, sleep } from './rcon.js';
import { visitor } from './world.js';

export const KNIGHT_NAME = 'SirVisitor';

// The attendee's avatar: walks up to the moat to make each attempt, crosses on success.
export const knight = managedBot(KNIGHT_NAME, async () => {
  await rconAll([
    `gamemode adventure ${KNIGHT_NAME}`,
    `effect give ${KNIGHT_NAME} minecraft:resistance infinite 4 true`,
    `item replace entity ${KNIGHT_NAME} armor.head with minecraft:iron_helmet`,
    `item replace entity ${KNIGHT_NAME} armor.chest with minecraft:iron_chestplate`,
    `item replace entity ${KNIGHT_NAME} armor.legs with minecraft:iron_leggings`,
    `item replace entity ${KNIGHT_NAME} armor.feet with minecraft:iron_boots`,
    `item replace entity ${KNIGHT_NAME} weapon.offhand with minecraft:shield`,
  ]);
  await home();
});

const at = (p) => `${p.x + 0.5} ${p.y} ${p.z + 0.5}`;

async function walk(p, timeoutMs = 9000) {
  const bot = knight.bot;
  if (!knight.ready || !bot) return false;
  const ok = await goTo(bot, new goals.GoalNear(p.x, p.y, p.z, 1), timeoutMs);
  if (!ok) await rcon(`tp ${KNIGHT_NAME} ${at(p)}`).catch(() => {});
  return ok;
}

export async function home() {
  await rcon(`tp ${KNIGHT_NAME} ${at(visitor.home)} 180 0`).catch(() => {});
}

export async function approach() {
  await walk(visitor.moatEdge);
  await knight.bot?.lookAt(new Vec3(0.5, visitor.moatEdge.y + 4, -6)).catch(() => {});
}

export const position = () => {
  const p = knight.bot?.entity?.position;
  return p ? { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) } : { ...visitor.moatEdge };
};

// Victory: across the bridge, fireworks in the courtyard, then back home ready for the next visitor.
export async function cross() {
  await walk(visitor.courtyard, 8000);
  const { x, y, z } = visitor.courtyard;
  const rocket = (dx, colors) =>
    `summon firework_rocket ${x + dx} ${y + 1} ${z} {LifeTime:25,FireworksItem:{id:"minecraft:firework_rocket",count:1,` +
    `components:{"minecraft:fireworks":{flight_duration:1,explosions:[{shape:"large_ball",has_twinkle:1b,colors:[I;${colors}]}]}}}}`;
  await rconAll([rocket(-2, '16711680,16777215'), rocket(2, '255,16777215')]).catch(() => {});
  await sleep(1200);
  await rcon(rocket(0, '16766720')).catch(() => {});
  await sleep(2500);
  await home();
}

// Defeat: a little slump, then trudge back.
export async function retreat() {
  const bot = knight.bot;
  if (knight.ready && bot) {
    bot.setControlState('sneak', true);
    await sleep(1200);
    bot.setControlState('sneak', false);
  }
  await walk(visitor.home);
}
