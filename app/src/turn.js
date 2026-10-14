import { chat, newTraceId } from './gateway.js';
import { buildMessages, parseReply, withToolResult } from './sentry.js';
import { sentryTools, callTool, viaGateway } from './mcp.js';
import { cannedLine } from './safety.js';
import { content, explain, pick } from './content.js';
import { config } from './config.js';

// One attempt, minus Minecraft: gateway -> guardrail verdicts -> parsed decision -> outcome.
// Shared by the server and the rehearsal/soak scripts.
//
// With the guard's MCP tools on, a turn can take two LLM calls: the first may ask for generate_insult, the app runs
// it through the gateway's MCP port, and the second writes the reply with the insult in hand. Both calls go through
// the same level's guardrails. At most one tool round per turn.
//
// outcome: opened | leaked | taunted | blocked_regex | blocked_airs | blocked_toxic | error
export async function evaluate({ text, level, scenario = null, cardId = null, gateContext = null, model, metadata = {}, useTools = config.mcp.enabled }) {
  const tools = useTools ? await sentryTools() : [];
  const messages = buildMessages(text, { gateContext, level, tools: tools.length > 0 });
  const traceId = newTraceId();
  const meta = { scenario: scenario || 'none', card: cardId || 'own', ...metadata };

  let res = await chat({ level, messages, model, traceId, tools, metadata: { ...meta, turn: '1' } });
  const turns = [turnSummary(1, res)];
  let tool = null;

  if (res.ok && !res.blocked && res.toolCalls?.length) {
    tool = await runTool(res.toolCalls[0], tools, traceId, level, metadata._user);
    res = await chat({ level, messages: withToolResult(messages, tool.call, tool.result), model, traceId, metadata: { ...meta, turn: '2' } });
    turns.push(turnSummary(2, res));
    delete tool.call;
  }

  const base = {
    level,
    scenario,
    cardId,
    traceId,
    status: res.status,
    latencyMs: turns.reduce((s, t) => s + (t.latencyMs || 0), 0) + (tool?.ms || 0),
    model: res.model,
    usage: res.usage,
    verdicts: turns.flatMap((t) => t.verdicts.map((v) => ({ ...v, turn: t.turn }))),
    turns,
    tool,
    direct: res.direct,
    gateContext,
  };

  if (!res.ok) {
    return { ...base, outcome: 'error', error: res.error, dialogue: cannedLine('error'), action: 'taunt', cow: false };
  }

  if (res.blocked) {
    const b = res.blockedBy;
    const outcome = b.kind === 'regex' ? 'blocked_regex' : b.kind === 'toxic' ? 'blocked_toxic' : 'blocked_airs';
    const lineKind = outcome === 'blocked_airs' && b.phase === 'input' ? 'blocked_airs_input' : outcome;
    return {
      ...base,
      outcome,
      blockedBy: b,
      dialogue: cannedLine(lineKind),
      action: 'taunt',
      cow: outcome !== 'blocked_toxic' && Math.random() < 0.3,
      explain: explain(cardId, outcome),
    };
  }

  const reply = parseReply(res.content, { level });
  let outcome = 'taunted';
  if (scenario === 'password' && reply.leaked) outcome = 'leaked';
  else if (reply.action === 'open_bridge') outcome = 'opened';
  else if (reply.leaked) outcome = 'leaked';

  return {
    ...base,
    outcome,
    dialogue: tool ? withInsult(tool.result, reply.dialogue) : reply.dialogue,
    raw: res.content,
    parsed: reply.parsed,
    action: reply.action,
    cow: reply.cow,
    explain: explain(cardId, outcome),
  };
}

// The guard shouts the tool's insult first, unless the model already quoted it.
const squash = (t) => t.toLowerCase().replace(/[^a-z]/g, '');
export function withInsult(insult, dialogue) {
  if (!insult || squash(dialogue).includes(squash(insult))) return dialogue;
  return `${insult} ${dialogue}`.trim();
}

function turnSummary(turn, res) {
  return { turn, status: res.status, latencyMs: res.latencyMs, verdicts: res.verdicts || [], error: res.ok ? undefined : res.error };
}

// Runs the model's tool call through the gateway. Only discovered tools are callable; anything that goes wrong becomes
// a curated insult, so the second call always has a tool answer to work with (marked fallback in the trace).
async function runTool(call, tools, traceId, level, user) {
  const name = call.function?.name || '';
  let args = {};
  try {
    args = JSON.parse(call.function?.arguments || '{}');
  } catch {
    // keep {}: the server falls back to its general topic
  }
  const started = performance.now();
  const out = { call: { ...call, id: call.id || 'call-1', type: 'function' }, name, args, viaGateway: viaGateway(), fallback: false };
  try {
    if (!tools.some((t) => t.function.name === name)) throw new Error(`unknown tool "${name}"`);
    out.result = await callTool(name, args, { traceId, level, user });
  } catch (err) {
    out.error = err.message;
    out.fallback = true;
    out.result = pick(content.signatureInsults);
  }
  out.ms = Math.round(performance.now() - started);
  return out;
}
