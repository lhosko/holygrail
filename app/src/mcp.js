import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config } from './config.js';

// The guard's tools come from the taunts MCP server, reached only through the SCM AI Gateway's MCP port,
// so the gateway authorises (Mcp · INVOKE on the app key) and logs every call.
// An empty slug means MCP_GATEWAY_URL is the taunts server itself (testing only, e.g. through kubectl port-forward:
// bypasses the gateway, labelled in the UI).
export const viaGateway = () => Boolean(config.mcp.serverSlug);
export const mcpUrl = () => [config.mcp.gatewayUrl.replace(/\/$/, ''), config.mcp.serverSlug, 'mcp'].filter(Boolean).join('/');

// A short-lived client per call: per-call headers carry the turn's trace id, so SCM shows the tool call next to the
// two LLM calls of the same turn. Local round trips are a few ms.
async function withClient(headers, fn, { user = 'booth' } = {}) {
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl()), {
    requestInit: {
      headers: {
        // The gateway key is only for the gateway; never hand it to the MCP server itself.
        ...(viaGateway() ? { 'x-portkey-api-key': config.gateway.apiKey } : {}),
        'x-portkey-metadata': JSON.stringify({ _user: user, app: 'storm-the-castle' }),
        ...headers,
      },
    },
  });
  const client = new Client({ name: 'storm-the-castle', version: '0.1.0' });
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`MCP timeout after ${config.mcp.timeoutMs}ms`)), config.mcp.timeoutMs),
  );
  try {
    return await Promise.race([
      (async () => {
        await client.connect(transport);
        return fn(client);
      })(),
      timeout,
    ]);
  } finally {
    client.close().catch(() => {});
  }
}

// MCP tool -> OpenAI-style function tool for the chat completion.
export function toOpenAiTool(tool) {
  const { $schema, ...parameters } = tool.inputSchema || { type: 'object', properties: {} };
  return { type: 'function', function: { name: tool.name, description: tool.description || '', parameters } };
}

let discovered = { tools: [], at: 0, error: null };

// Discovery through the gateway, cached. Retries at most every 30 s while it is failing (e.g. not registered yet).
export async function sentryTools() {
  if (!config.mcp.enabled) return [];
  const fresh = discovered.tools.length ? 10 * 60_000 : 30_000;
  if (Date.now() - discovered.at < fresh) return discovered.tools;
  try {
    const { tools } = await withClient({}, (c) => c.listTools());
    discovered = { tools: tools.map(toOpenAiTool), at: Date.now(), error: null };
  } catch (err) {
    discovered = { tools: [], at: Date.now(), error: err.message };
  }
  return discovered.tools;
}

export const mcpStatus = () => ({
  enabled: config.mcp.enabled,
  viaGateway: viaGateway(),
  tools: discovered.tools.map((t) => t.function.name),
  error: discovered.error,
});

// Returns the tool's text, or throws.
// The level's saved config rides along too, in case the MCP port applies its guardrails (as the chat endpoint does).
// `user` labels the call in SCM logs (red-team turns log as "redteam").
export async function callTool(name, args, { traceId, level, user } = {}) {
  const configId = viaGateway() && level ? config.gateway.configs[level] : '';
  const headers = {
    ...(traceId ? { 'x-portkey-trace-id': traceId } : {}),
    ...(configId ? { 'x-portkey-config': configId } : {}),
  };
  const res = await withClient(headers, (c) => c.callTool({ name, arguments: args }), { user });
  const text = (res.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n').trim();
  if (res.isError) throw new Error(text || 'tool error');
  return text;
}
