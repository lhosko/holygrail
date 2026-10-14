import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Cards, explainers and taunt pools live in content/cards.json so they can be edited at the booth.
const path = fileURLToPath(new URL('../content/cards.json', import.meta.url));

export let content = JSON.parse(readFileSync(path, 'utf8'));

export function reloadContent() {
  content = JSON.parse(readFileSync(path, 'utf8'));
  return content;
}

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function cardById(id) {
  return id ? content.cards[id] : undefined;
}

export function explain(cardId, outcome) {
  return content.cards[cardId]?.explain?.[outcome] || content.explainDefault[outcome] || '';
}
