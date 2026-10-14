// Builds (or rebuilds) the castle over RCON. Idempotent: run again to reset the world.
//   docker compose run --rm app node scripts/build-castle.js
import { buildCastle } from '../src/castle.js';

const { errors } = await buildCastle();
process.exit(errors.length ? 1 : 0);
