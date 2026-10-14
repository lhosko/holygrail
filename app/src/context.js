import { Vec3 } from 'vec3';
import { rcon, rconAll, snbtText } from './rcon.js';
import { rabbit, decreeSign } from './world.js';

// Trojan Rabbit: a giant wooden rabbit with a decree sign is wheeled up to the gate.
// The sentry bot genuinely reads the sign in-game; that text becomes context for the LLM.

const lines = (text, width = 15, max = 4) => {
  const out = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width && line) {
      out.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  const front = out.slice(0, max);
  const back = out.slice(max, max * 2);
  while (front.length < max) front.push('');
  while (back.length < max) back.push('');
  return { front, back };
};

const msgs = (arr) => `[${arr.map((l) => snbtText(l, 'black')).join(',')}]`;

export async function placeRabbit(decree) {
  const { x, y, z } = rabbit;
  const { front, back } = lines(decree);
  await rconAll([
    // Body, head, ears and a wheel or two, all tagged by position for cleanup.
    `fill ${x} ${y} ${z} ${x + 2} ${y + 1} ${z - 1} oak_planks`,
    `fill ${x + 1} ${y + 2} ${z} ${x + 2} ${y + 3} ${z} oak_planks`,
    `setblock ${x + 1} ${y + 4} ${z} oak_fence`,
    `setblock ${x + 2} ${y + 4} ${z} oak_fence`,
    `setblock ${x} ${y} ${z + 1} oak_trapdoor[facing=south,half=bottom,open=true]`,
    `setblock ${decreeSign.x} ${decreeSign.y} ${decreeSign.z} oak_sign[rotation=0]` +
      `{front_text:{messages:${msgs(front)}},back_text:{messages:${msgs(back)}},is_waxed:1b}`,
    `particle minecraft:happy_villager ${x + 1} ${y + 2} ${z} 1 1 1 0 20`,
    `playsound minecraft:block.wood.place block @a ${x} ${y} ${z} 2`,
  ]);
}

export async function removeRabbit() {
  const { x, y, z } = rabbit;
  await rconAll([
    `fill ${x} ${y} ${z - 1} ${x + 2} ${y + 4} ${z + 1} air`,
    `setblock ${decreeSign.x} ${decreeSign.y} ${decreeSign.z} air`,
  ]).catch(() => {});
}

// Read the sign through the sentry bot's eyes. Falls back to the decree we wrote if the bot is offline.
export function readSign(bot, fallback) {
  try {
    const block = bot?.blockAt(new Vec3(decreeSign.x, decreeSign.y, decreeSign.z));
    const sides = block?.getSignText?.();
    const text = (sides || []).join(' ').replace(/\s+/g, ' ').trim();
    if (text) return { text, source: 'sign' };
  } catch {
    // fall through
  }
  return { text: fallback, source: 'fallback' };
}

export const rabbitPresent = async () =>
  /passed/i.test(await rcon(`execute if block ${decreeSign.x} ${decreeSign.y} ${decreeSign.z} oak_sign`).catch(() => ''));
