import { rcon, rconAll, snbtText } from './rcon.js';
import { config } from './config.js';
import { camera as shots } from './world.js';

// Minecraft angles: yaw 0 = south (+z), 90 = west; positive pitch looks down.
export function lookAngles(pos, at) {
  const dx = at.x - pos.x;
  const dy = at.y - pos.y;
  const dz = at.z - pos.z;
  const yaw = (-Math.atan2(dx, dz) * 180) / Math.PI;
  const pitch = (-Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  return { yaw: Number(yaw.toFixed(1)), pitch: Number(pitch.toFixed(1)) };
}

let current = null;

// Cut the TV's spectator camera to a named shot. Harmless if the camera player is offline.
export async function cut(name) {
  const player = config.mc.cameraPlayer;
  const shot = shots[name];
  if (!player || !shot) return;
  const { yaw, pitch } = lookAngles(shot.pos, shot.at);
  const { x, y, z } = shot.pos;
  current = name;
  await rconAll([
    `gamemode spectator ${player}`,
    `tp ${player} ${x + 0.5} ${y} ${z + 0.5} ${yaw} ${pitch}`,
  ]).catch(() => {});
}

export const currentShot = () => current;

// Floating speech bubble (text_display) above a speaker. One bubble per speaker; auto-removed.
const bubbleTimers = new Map();
const COLORS = { sentry: 'gold', visitor: 'aqua', narrator: 'white' };

export async function bubble(speaker, text, pos, seconds = 7) {
  const tag = `bubble_${speaker}`;
  const clipped = text.length > 140 ? text.slice(0, 137) + '...' : text;
  clearTimeout(bubbleTimers.get(speaker));
  await rconAll([
    `kill @e[type=text_display,tag=${tag}]`,
    `summon text_display ${pos.x + 0.5} ${pos.y + 2.4} ${pos.z + 0.5} ` +
      `{Tags:["bubble","${tag}"],billboard:"center",line_width:180,background:-1073741824,` +
      `transformation:{left_rotation:[0f,0f,0f,1f],right_rotation:[0f,0f,0f,1f],translation:[0f,0f,0f],scale:[1.4f,1.4f,1.4f]},` +
      `text:${snbtText(clipped, COLORS[speaker] || 'white')}}`,
  ]).catch(() => {});
  bubbleTimers.set(
    speaker,
    setTimeout(() => rcon(`kill @e[type=text_display,tag=${tag}]`).catch(() => {}), seconds * 1000),
  );
}

export async function clearBubbles() {
  for (const t of bubbleTimers.values()) clearTimeout(t);
  bubbleTimers.clear();
  await rcon('kill @e[type=text_display,tag=bubble]').catch(() => {});
}
