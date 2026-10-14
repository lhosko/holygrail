// Castle geometry, shared by the castle builder, the bots, the bridge and the camera.
// Superflat default: grass top block at y=-61, so players stand at y=-60.
// +x = east, +z = south. The castle is north of the moat; visitors approach from the south.

export const G = -61; // ground block level
export const STAND = G + 1; // feet level on the ground
export const WALK = G + 9; // feet level on the battlement walkway (wall top is G+8)

export const castle = {
  minX: -12, maxX: 12,
  minZ: -26, maxZ: -6, // front (south) face at z=-6
  frontWall: { zOuter: -6, zInner: -8 }, // 3 blocks thick: battlement walkway
  height: 8,
};

export const gate = { minX: -1, maxX: 1, minY: STAND, maxY: STAND + 3, portcullisZ: -7 };

export const moat = { minX: -18, maxX: 18, minZ: -5, maxZ: -3, depth: 2 };

// Raised drawbridge stands vertically in front of the gate; lowered it spans the moat.
export const bridge = {
  minX: gate.minX, maxX: gate.maxX,
  raised: { z: moat.minZ, minY: STAND, maxY: STAND + 2 },
  lowered: { y: G, minZ: moat.minZ, maxZ: moat.maxZ },
};

export const sentryPost = { x: 3, y: WALK, z: -6, yaw: 0 }; // between merlons, facing south
export const lever = { x: 9, y: WALK, z: -7 };
export const cowSpot = { x: -4, y: WALK, z: -7 };

export const visitor = {
  home: { x: 0, y: STAND, z: 8 },
  moatEdge: { x: 0, y: STAND, z: -1 },
  courtyard: { x: 0, y: STAND, z: -14 },
};

// Trojan Rabbit: giant wooden rabbit + decree sign on the visitor's bank, east of the path.
export const rabbit = { x: 4, y: STAND, z: -1 };
export const decreeSign = { x: 2, y: STAND, z: -1 };

// Camera shots: position + point to look at (yaw/pitch computed in camera.js).
export const camera = {
  wide: { pos: { x: 15, y: STAND + 8, z: 13 }, at: { x: 0, y: STAND + 3, z: -6 } },
  sentry: { pos: { x: 7, y: WALK + 1, z: 3 }, at: { x: sentryPost.x, y: WALK + 1, z: sentryPost.z } },
  lever: { pos: { x: 14, y: WALK + 3, z: 0 }, at: { x: lever.x, y: WALK, z: lever.z } },
  bridge: { pos: { x: 7, y: STAND + 4, z: 5 }, at: { x: 0, y: G, z: -4 } },
  courtyard: { pos: { x: 0, y: WALK + 7, z: 2 }, at: { x: 0, y: STAND, z: -14 } },
};
