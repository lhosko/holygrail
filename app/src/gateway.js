import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { RESPONSE_SCHEMA } from './sentry.js';

// One gateway, three policies: the tier only changes which saved config the request uses.
// Emergency mode (DIRECT_MODEL=1) talks straight to Docker Model Runner with no guardrails at all,
// for when SCM or the network is down. The UI labels it loudly.
export const directMode = () => process.env.DIRECT_MODEL === '1';

function classify(hook, check, phase, level) {
  const g = config.gateway.guardrails;
  if (hook.id && hook.id === g.regex) return 'regex';
  if (hook.id && hook.id === g.toxic) return 'toxic';
  if (hook.id && hook.id === g.airs) return 'airs';
  if (check.id?.startsWith('default.regex')) return 'regex';
  if (check.id?.startsWith('panw-prisma-airs')) return level === 3 ? 'airs' : phase === 'output' ? 'toxic' : 'airs';
  return check.id || 'unknown';
}

function airsDetail(data) {
  if (!data || typeof data !== 'object') return undefined;
  const flags = (o) => Object.entries(o || {}).filter(([, v]) => v === true).map(([k]) => k);
  return {
    action: data.action,
    category: data.category,
    profile: data.profile_name,
    scanId: data.scan_id,
    reportId: data.report_id,
    promptDetected: flags(data.prompt_detected),
    responseDetected: flags(data.response_detected),
  };
}

// Flatten hook_results into one verdict per check, tagged regex / airs / toxic.
// A check that errors is not a block: the gateway counts it as a pass (fails open) and lets the reply through.
// - Empty reply + AIRS 400: AIRS had nothing to scan (a tool-call-only reply has content ""). Shown as skipped.
// - Any other error (timeout, auth, 5xx, a 400 on real text): content went unscanned. Shown as failedOpen.
export function parseHookResults(hookResults, level, { emptyOutput = false } = {}) {
  const verdicts = [];
  for (const [key, phase] of [['before_request_hooks', 'input'], ['after_request_hooks', 'output']]) {
    for (const hook of hookResults?.[key] || []) {
      for (const check of hook.checks || []) {
        const kind = classify(hook, check, phase, level);
        const error = check.error ? String(check.error.message || check.error) : undefined;
        // Errors pass only if the guardrail as a whole passed (it would not with fail_on_error set).
        const errorPassed = Boolean(error) && hook.verdict !== false;
        const nothingToScan = errorPassed && phase === 'output' && emptyOutput && /\b400\b/.test(error);
        verdicts.push({
          kind,
          phase,
          passed: check.verdict !== false || errorPassed,
          deny: hook.deny === true,
          skipped: nothingToScan ? 'nothing to scan' : undefined,
          failedOpen: errorPassed && !nothingToScan,
          checkId: check.id,
          ms: check.execution_time ?? hook.execution_time,
          error,
          airs: kind === 'airs' || kind === 'toxic' ? airsDetail(check.data) : undefined,
        });
      }
    }
  }
  return verdicts;
}

export const newTraceId = () => `castle-${randomUUID()}`;

// With `tools`, the reply format is left free: Model Runner ignores the tools when a json_schema is also set.
// Both calls of a tool-using turn share one trace id, so SCM shows them (and the MCP call) together.
export async function chat({ level, messages, model = config.model.current, metadata = {}, maxTokens = 160, tools, traceId = newTraceId() }) {
  const body = {
    model,
    messages,
    temperature: config.model.temperature,
    max_tokens: maxTokens,
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  } else {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: 'sentry_reply', strict: true, schema: RESPONSE_SCHEMA },
    };
  }

  let url;
  let headers = { 'content-type': 'application/json' };
  if (directMode()) {
    url = `${(config.model.runnerUrl || 'http://model-runner.docker.internal/engines/v1').replace(/\/$/, '')}/chat/completions`;
  } else {
    const configId = config.gateway.configs[level];
    if (!configId) return { ok: false, error: `No gateway config set for level ${level} (CONFIG_L${level})`, traceId };
    url = `${config.gateway.url.replace(/\/$/, '')}/v1/chat/completions`;
    // The SCM AI Gateway data plane is built on Portkey, so these x-portkey-* header names are its own wire protocol.
    headers = {
      ...headers,
      'x-portkey-api-key': config.gateway.apiKey,
      'x-portkey-config': configId,
      'x-portkey-trace-id': traceId,
      'x-portkey-metadata': JSON.stringify({ _user: 'booth', app: 'storm-the-castle', level: String(level), ...metadata }),
    };
  }

  const started = performance.now();
  let res;
  let json;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.gateway.timeoutMs),
    });
    json = await res.json().catch(() => ({}));
  } catch (err) {
    return { ok: false, error: `Gateway unreachable: ${err.name === 'TimeoutError' ? 'timeout' : err.message}`, traceId };
  }
  const latencyMs = Math.round(performance.now() - started);

  const emptyOutput = !String(json.choices?.[0]?.message?.content ?? '').trim();
  const verdicts = parseHookResults(json.hook_results, level, { emptyOutput });
  const failedDeny = verdicts.find((v) => !v.passed && v.deny);
  const result = {
    traceId,
    status: res.status,
    latencyMs,
    model: json.model || model,
    usage: json.usage,
    verdicts,
    direct: directMode(),
  };

  if (res.status === 446) {
    return { ...result, ok: true, blocked: true, blockedBy: failedDeny || verdicts.find((v) => !v.passed) || { kind: 'unknown' } };
  }
  if (!res.ok && res.status !== 246) {
    const msg = json?.error?.message || json?.message || `HTTP ${res.status}`;
    return { ...result, ok: false, error: msg };
  }
  const message = json.choices?.[0]?.message || {};
  return { ...result, ok: true, blocked: false, content: message.content ?? '', toolCalls: message.tool_calls || [] };
}

export async function gatewayHealthy() {
  if (directMode()) return modelHealthy();
  try {
    const res = await fetch(`${config.gateway.url.replace(/\/$/, '')}/v1/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    try {
      // Some builds don't expose /v1/health; any HTTP answer means the pod is up.
      await fetch(config.gateway.url, { signal: AbortSignal.timeout(3000) });
      return true;
    } catch {
      return false;
    }
  }
}

export async function modelHealthy() {
  const base = (config.model.runnerUrl || 'http://model-runner.docker.internal/engines/v1').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/models`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
