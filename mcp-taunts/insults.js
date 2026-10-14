import { readFileSync, statSync } from 'node:fs';

// Insults are assembled from curated, PG content in the booth's cards.json (insultKit, signatureInsults, banter).
// Nothing the caller sends is ever echoed back: topic is matched against a fixed list, so a model can't launder a
// secret (or anything rude) through the tool's arguments.
export const TOPICS = ['coconuts', 'swallows', 'hamsters', 'horses', 'kings', 'knights', 'general'];

export const normalizeTopic = (topic) => {
  const t = String(topic ?? '').trim().toLowerCase();
  return TOPICS.includes(t) ? t : 'general';
};

const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];

export function generateInsult(content, topic, rnd = Math.random) {
  const kit = content.insultKit || {};
  const t = normalizeTopic(topic);
  const theme = kit.topics?.[t];
  const nouns = [...(theme?.nouns || []), ...(theme ? [] : kit.nouns || [])];
  const lines = theme?.lines?.length ? theme.lines : content.signatureInsults || [];

  // Half the time a curated one-liner, otherwise "<opener> you <adjective> <noun>!".
  const insult =
    rnd() < 0.5 || !nouns.length || !kit.openers?.length || !kit.adjectives?.length
      ? pick(lines, rnd)
      : `${pick(kit.openers, rnd)} you ${pick(kit.adjectives, rnd)} ${pick(nouns, rnd)}!`;
  return { topic: t, insult };
}

// Re-reads cards.json when it changes, so content edited at the booth applies without a restart.
export function contentLoader(path) {
  let cached;
  let mtime = 0;
  return () => {
    const m = statSync(path).mtimeMs;
    if (!cached || m !== mtime) {
      cached = JSON.parse(readFileSync(path, 'utf8'));
      mtime = m;
    }
    return cached;
  };
}
