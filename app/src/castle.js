import { rcon, rconAll } from './rcon.js';
import { G, STAND, WALK, castle, gate, moat, bridge, lever, visitor } from './world.js';

const fill = (x1, y1, z1, x2, y2, z2, block, mode = '') =>
  `fill ${x1} ${y1} ${z1} ${x2} ${y2} ${z2} ${block}${mode ? ' ' + mode : ''}`;

export function raisedBridgeCommands() {
  const { minX, maxX, raised, lowered } = bridge;
  return [
    fill(minX, lowered.y, lowered.minZ, maxX, lowered.y, lowered.maxZ, 'water'),
    fill(minX, raised.minY, raised.z, maxX, raised.maxY, raised.z, 'spruce_planks'),
    fill(gate.minX, gate.minY, gate.portcullisZ, gate.maxX, gate.maxY, gate.portcullisZ, 'iron_bars'),
  ];
}

// Three-frame "drawbridge lowering" animation; the caller spaces the frames out.
export function loweringFrames() {
  const { minX, maxX, raised, lowered } = bridge;
  return [
    [
      fill(gate.minX, gate.minY, gate.portcullisZ, gate.maxX, gate.maxY, gate.portcullisZ, 'air'),
      `playsound minecraft:block.piston.contract block @a ${0} ${STAND} ${raised.z} 2`,
    ],
    [
      fill(minX, raised.minY + 1, raised.z, maxX, raised.maxY, raised.z, 'air'),
      fill(minX, raised.minY, raised.z + 1, maxX, raised.minY, raised.z + 1, 'spruce_planks'),
      `playsound minecraft:block.wooden_door.close block @a 0 ${STAND} ${raised.z} 2`,
    ],
    [
      fill(minX, raised.minY, raised.z, maxX, raised.minY, raised.z + 1, 'air'),
      fill(minX, lowered.y, lowered.minZ, maxX, lowered.y, lowered.maxZ, 'spruce_planks'),
      `playsound minecraft:block.anvil.land block @a 0 ${STAND} ${raised.z} 1 0.6`,
    ],
  ];
}

export function raisingFrames() {
  const { minX, maxX, raised, lowered } = bridge;
  return [
    [
      fill(minX, lowered.y, lowered.minZ, maxX, lowered.y, lowered.maxZ, 'water'),
      fill(minX, raised.minY, raised.z + 1, maxX, raised.minY, raised.z + 1, 'spruce_planks'),
      `playsound minecraft:block.piston.extend block @a 0 ${STAND} ${raised.z} 2`,
    ],
    [
      fill(minX, raised.minY, raised.z + 1, maxX, raised.minY, raised.z + 1, 'air'),
      ...raisedBridgeCommands().slice(1),
      `playsound minecraft:block.iron_door.close block @a 0 ${STAND} ${raised.z} 2`,
    ],
  ];
}

export function leverCommand(powered = false) {
  return `setblock ${lever.x} ${lever.y} ${lever.z} lever[face=floor,facing=south,powered=${powered}]`;
}

export async function buildCastle(log = console.log) {
  const { minX, maxX, minZ, maxZ, height } = castle;
  const top = G + height;
  const cmds = [
    // World rules: calm, bright, no mobs, nothing breaks.
    'gamerule doDaylightCycle false',
    'time set 6000',
    'gamerule doWeatherCycle false',
    'weather clear',
    'gamerule doMobSpawning false',
    'gamerule mobGriefing false',
    'gamerule doFireTick false',
    'gamerule fallDamage false',
    'gamerule drowningDamage false',
    'gamerule announceAdvancements false',
    'gamerule showDeathMessages false',
    'gamerule commandBlockOutput false',
    'gamerule spawnRadius 0',
    `setworldspawn ${visitor.home.x} ${visitor.home.y} ${visitor.home.z}`,
    'kill @e[type=!player]',

    // Clear and re-lay the site (split so each fill stays under the block limit).
    fill(-26, STAND, -34, 26, STAND + 20, -8, 'air'),
    fill(-26, STAND, -7, 26, STAND + 20, 20, 'air'),
    fill(-26, G - 2, -34, 26, G - 1, 20, 'dirt'),
    fill(-26, G, -34, 26, G, 20, 'grass_block'),
    fill(-1, G, moat.maxZ + 1, 1, G, visitor.home.z + 3, 'dirt_path'),

    // Walls: thick front battlement, thinner sides/back, courtyard floor.
    fill(minX, STAND, castle.frontWall.zInner, maxX, top, castle.frontWall.zOuter, 'stone_bricks'),
    fill(minX, STAND, minZ, maxX, top, minZ, 'stone_bricks'),
    fill(minX, STAND, minZ, minX, top, maxZ, 'stone_bricks'),
    fill(maxX, STAND, minZ, maxX, top, maxZ, 'stone_bricks'),
    fill(minX + 1, G, minZ + 1, maxX - 1, G, castle.frontWall.zInner - 1, 'coarse_dirt'),
    fill(minX, STAND, castle.frontWall.zOuter, maxX, STAND + 1, castle.frontWall.zOuter, 'mossy_stone_bricks'),

    // Corner towers.
    ...[[minX, -7], [maxX, -7], [minX, minZ], [maxX, minZ]].flatMap(([x, z]) => [
      fill(x - 1, STAND, z - 1, x + 1, top + 4, z + 1, 'stone_bricks'),
      `setblock ${x - 1} ${top + 5} ${z - 1} stone_brick_wall`,
      `setblock ${x + 1} ${top + 5} ${z - 1} stone_brick_wall`,
      `setblock ${x - 1} ${top + 5} ${z + 1} stone_brick_wall`,
      `setblock ${x + 1} ${top + 5} ${z + 1} stone_brick_wall`,
    ]),

    // Gate opening through the front wall.
    fill(gate.minX, gate.minY, castle.frontWall.zInner, gate.maxX, gate.maxY, castle.frontWall.zOuter, 'air'),

    // French-blue banners either side of the gate.
    `setblock -4 ${STAND + 5} ${castle.frontWall.zOuter + 1} blue_wall_banner[facing=south]`,
    `setblock 4 ${STAND + 5} ${castle.frontWall.zOuter + 1} white_wall_banner[facing=south]`,
    `setblock -6 ${STAND + 5} ${castle.frontWall.zOuter + 1} red_wall_banner[facing=south]`,

    // Moat (two deep, source blocks throughout).
    fill(moat.minX, G - 1, moat.minZ, moat.maxX, G, moat.maxZ, 'water'),

    // Lever on the battlement walkway, then drawbridge raised + portcullis down.
    leverCommand(false),
    ...raisedBridgeCommands(),
  ];

  // Merlons along the front parapet (gap at the sentry post, x=3) and the other walls.
  for (let x = minX; x <= maxX; x += 2) {
    cmds.push(`setblock ${x} ${WALK} ${castle.frontWall.zOuter} stone_bricks`);
    cmds.push(`setblock ${x} ${WALK} ${minZ} stone_bricks`);
  }
  for (let z = minZ; z <= maxZ; z += 2) {
    cmds.push(`setblock ${minX} ${WALK} ${z} stone_bricks`);
    cmds.push(`setblock ${maxX} ${WALK} ${z} stone_bricks`);
  }

  const results = await rconAll(cmds);
  const errors = results
    .map((r, i) => ({ r, cmd: cmds[i] }))
    .filter(({ r }) => /unknown|incorrect|invalid|error|expected/i.test(r || ''));
  for (const e of errors) log(`castle: ${e.cmd} -> ${e.r}`);
  log(`castle: ${cmds.length} commands, ${errors.length} errors`);
  return { commands: cmds.length, errors };
}

// Quick reset between visitors: close bridge, lever off, clear props and bubbles.
export async function resetCastle() {
  await rconAll([
    leverCommand(false),
    ...raisedBridgeCommands(),
    'kill @e[tag=bubble]',
    'kill @e[tag=cameo]',
    'kill @e[tag=trojan]',
  ]);
  await rcon(`fill 2 ${STAND} -1 2 ${STAND} -1 air`).catch(() => {});
}
