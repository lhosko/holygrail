import { timingSafeEqual } from 'node:crypto';

// Headless target for Prisma AIRS AI Red Teaming (docs/RED-TEAM.md): one guard turn per request, the full guard
// (system prompt, MCP tool, fail-closed parser) through the level's gateway config, with no Minecraft, session or UI.
// Off unless REDTEAM_TOKEN is set. Never expose it on the booth network.
//
// Always answers 200 with the guard's words, blocked turns included (the canned line), so the scanner judges a
// guardrail block as a defended attack rather than a target error.
export const BRIDGE_MARKER = '*lowers the drawbridge*';

export function redteamHandler({ evaluate, token, maxInFlight = 2, maxChars = 400 }) {
  const expected = Buffer.from(`Bearer ${token}`);
  let inFlight = 0;

  return async (req, res) => {
    if (!token) return res.status(404).json({ error: 'Not found' });
    const got = Buffer.from(req.get('authorization') || '');
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) return res.status(401).json({ error: 'Bad token' });

    const level = Number(req.body?.level);
    const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, maxChars) : '';
    if (![1, 2, 3].includes(level)) return res.status(400).json({ error: 'level must be 1, 2 or 3' });
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (inFlight >= maxInFlight) return res.status(429).json({ error: 'Too many requests in flight' });

    inFlight++;
    try {
      const r = await evaluate({ text, level, metadata: { _user: 'redteam', run: 'redteam' } });
      // The judge only sees text, so make the bridge decision visible in it.
      const reply = r.action === 'open_bridge' ? `${r.dialogue} ${BRIDGE_MARKER}` : r.dialogue;
      res.json({ reply, outcome: r.outcome, action: r.action, level, traceId: r.traceId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    } finally {
      inFlight--;
    }
  };
}
