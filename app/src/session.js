import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { config } from './config.js';
import { content, pick } from './content.js';

// One visitor at a time: their quest progress, plus the day's Hall of Knights.
const hallPath = fileURLToPath(new URL('../data/hall-of-knights.json', import.meta.url));
const today = () => new Date().toISOString().slice(0, 10);

function loadHall() {
  try {
    const all = JSON.parse(readFileSync(hallPath, 'utf8'));
    return all.date === today() ? all : { date: today(), knights: [], stats: {} };
  } catch {
    return { date: today(), knights: [], stats: {} };
  }
}

let hall = loadHall();

function saveHall() {
  try {
    mkdirSync(dirname(hallPath), { recursive: true });
    writeFileSync(hallPath, JSON.stringify(hall, null, 2));
  } catch {
    // Non-fatal: the board just won't survive a restart.
  }
}

function freshVisitor() {
  return {
    id: Math.random().toString(36).slice(2, 8),
    startedAt: Date.now(),
    level: 1,
    scenario: null, // null | 'trojan' | 'password'
    attempts: 0,
    wins: {}, // level/scenario -> outcome
    knightName: null,
  };
}

let visitor = freshVisitor();
let lastActivity = 0;

export const session = {
  get visitor() { return visitor; },
  get hall() { return hall; },

  newVisitor() {
    visitor = freshVisitor();
    lastActivity = Date.now();
    return visitor;
  },

  touch() { lastActivity = Date.now(); },
  idle() { return Date.now() - lastActivity > config.booth.idleSeconds * 1000; },

  setLevel(level) {
    visitor.level = [1, 2, 3].includes(Number(level)) ? Number(level) : visitor.level;
    this.touch();
  },

  setScenario(scenario) {
    visitor.scenario = ['trojan', 'password'].includes(scenario) ? scenario : null;
    this.touch();
  },

  // Record an attempt. Returns the knight name if this attempt earned a place in the Hall.
  record({ level, scenario, outcome }) {
    visitor.attempts += 1;
    hall.stats[outcome] = (hall.stats[outcome] || 0) + 1;
    const won = outcome === 'opened' || outcome === 'leaked';
    let earned = null;
    if (won) {
      const key = scenario || `L${level}`;
      visitor.wins[key] = outcome;
      if (!visitor.knightName) {
        const n = content.knightNames;
        visitor.knightName = `${pick(n.titles)} ${pick(n.names)} ${pick(n.epithets)}`;
        earned = visitor.knightName;
      }
      const entry = hall.knights.find((k) => k.id === visitor.id);
      if (entry) entry.feats = [...new Set([...entry.feats, key])];
      else hall.knights.unshift({ id: visitor.id, name: visitor.knightName, feats: [key], at: new Date().toISOString() });
      hall.knights = hall.knights.slice(0, 50);
    }
    saveHall();
    this.touch();
    return earned;
  },

  resetHall() {
    hall = { date: today(), knights: [], stats: {} };
    saveHall();
  },
};
