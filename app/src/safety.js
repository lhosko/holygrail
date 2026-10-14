import { config } from './config.js';
import { content, pick } from './content.js';

let lastAttackAt = 0;

// Booth hygiene for the input: length, control characters, pacing. Not a security control.
export function checkInput(raw) {
  const text = String(raw ?? '')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return { ok: false, reason: 'Say or type something for the guard first!' };
  if (text.length > config.booth.maxInputChars) {
    return { ok: false, reason: `That's a long speech! Keep it under ${config.booth.maxInputChars} characters.` };
  }
  const wait = config.booth.minSecondsBetweenAttacks * 1000 - (Date.now() - lastAttackAt);
  if (wait > 0) return { ok: false, reason: 'The guard is catching his breath. One moment...' };
  lastAttackAt = Date.now();
  return { ok: true, text };
}

// When a guardrail blocks, the guard still reacts in-game, but with curated lines only.
export function cannedLine(outcome) {
  if (outcome === 'blocked_regex' || outcome === 'blocked_airs_input') return pick(content.blockedTaunts);
  return pick(content.taunts);
}
