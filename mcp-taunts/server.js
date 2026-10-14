import express from 'express';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TOPICS, generateInsult, contentLoader } from './insults.js';

// taunts: one MCP tool, generate_insult. It runs in the local cluster (infra/taunts) behind the SCM AI Gateway's MCP
// port (8788), which forwards to http://taunts.storm-castle.svc.cluster.local/mcp, so every call the guard makes is authorised and logged by the gateway.
const PORT = Number(process.env.PORT || 8790);
const loadContent = contentLoader(process.env.CONTENT_PATH || '/content/cards.json');

function buildServer() {
  const server = new McpServer({ name: 'castle-taunts', version: '0.1.0' });
  server.registerTool(
    'generate_insult',
    {
      title: 'Generate a French guard insult',
      description:
        "Returns one fresh, family-friendly insult in the French castle guard's style, themed on a topic. " +
        'Use it when taunting a visitor.',
      inputSchema: {
        // catch: an unknown topic becomes "general" instead of a validation error.
        topic: z.enum(TOPICS).catch('general').describe('Theme of the insult; use "general" if nothing fits'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ topic }) => {
      const { topic: used, insult } = generateInsult(loadContent(), topic);
      console.log(`generate_insult topic=${used}`);
      return { content: [{ type: 'text', text: insult }] };
    },
  );
  return server;
}

const app = express();
app.use(express.json({ limit: '64kb' }));

// Stateless: a fresh server and transport per request, plain JSON responses (no SSE stream needed for one tool).
app.post('/mcp', async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('mcp request failed:', err.message);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});
// Stateless servers have no stream to open or session to end.
app.all('/mcp', (req, res) =>
  res.status(405).set('allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }),
);

app.get('/healthz', (req, res) => {
  try {
    loadContent();
    res.json({ ok: true, tools: ['generate_insult'] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`castle-taunts MCP server on :${PORT}/mcp`));
