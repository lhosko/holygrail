const env = process.env;

const list = (v, fallback) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback);

export const config = {
  port: Number(env.PORT || 3000),
  staffPin: env.STAFF_PIN || '1234',

  gateway: {
    url: env.GATEWAY_URL || 'http://host.docker.internal:8787',
    apiKey: env.GATEWAY_API_KEY || '',
    configs: { 1: env.CONFIG_L1 || '', 2: env.CONFIG_L2 || '', 3: env.CONFIG_L3 || '' },
    guardrails: {
      toxic: env.GUARDRAIL_TOXIC_ID || '',
      regex: env.GUARDRAIL_REGEX_ID || '',
      airs: env.GUARDRAIL_AIRS_ID || '',
    },
    timeoutMs: Number(env.GATEWAY_TIMEOUT_MS || 30000),
  },

  // The guard's tools (taunts MCP server), reached through the gateway's MCP port.
  mcp: {
    enabled: env.MCP_TAUNTS !== '0',
    gatewayUrl: env.MCP_GATEWAY_URL || 'http://host.docker.internal:8788',
    serverSlug: env.MCP_SERVER_SLUG ?? 'storm-castle-taunts',
    timeoutMs: Number(env.MCP_TIMEOUT_MS || 5000),
  },

  // Headless red-team target, POST /api/redteam (docs/RED-TEAM.md). Empty token = route off.
  redteam: {
    token: env.REDTEAM_TOKEN || '',
    maxInFlight: Number(env.REDTEAM_MAX_IN_FLIGHT || 2),
  },

  model: {
    current: env.MODEL || 'ai/llama3.1:8B-Q4_K_M',
    choices: list(env.MODEL_CHOICES, ['ai/llama3.1:8B-Q4_K_M', 'ai/mistral:7B-Q4_K_M', 'ai/gemma3:4b-q4_K_M', 'ai/gemma4:e4b-q4_K_M', 'ai/gemma4:12b-q4_K_M']),
    runnerUrl: env.MODEL_RUNNER_URL || '',
    temperature: Number(env.MODEL_TEMPERATURE || 0.7),
  },

  whisper: {
    url: env.WHISPER_URL || 'http://host.docker.internal:8178',
    prompt:
      env.WHISPER_PROMPT ||
      'King Arthur, drawbridge, unladen European swallow, African swallow, coconut, dorsal creeper, shrubbery, Antioch, elderberries, ' +
        'Ouvrez le pont-levis, par ordre du Roi, elderberries, hamster, French guard, Sir Robin.',
  },

  mc: {
    host: env.MC_HOST || 'localhost',
    port: Number(env.MC_PORT || 25565),
    version: env.MC_VERSION || '1.21.4',
    rconHost: env.RCON_HOST || env.MC_HOST || 'localhost',
    rconPort: Number(env.RCON_PORT || 25575),
    rconPassword: env.RCON_PASSWORD || 'change-me-rcon',
    cameraPlayer: env.CAMERA_PLAYER || '',
  },

  booth: {
    bridgeOpenSeconds: Number(env.BRIDGE_OPEN_SECONDS || 10),
    maxInputChars: Number(env.MAX_INPUT_CHARS || 400),
    minSecondsBetweenAttacks: Number(env.MIN_SECONDS_BETWEEN_ATTACKS || 3),
    idleSeconds: Number(env.IDLE_SECONDS || 60),
    attractTauntSeconds: Number(env.ATTRACT_TAUNT_SECONDS || 120),
    viewer: env.VIEWER === '1',
  },
};
