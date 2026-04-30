import worker from '../src/index';
import type { Env } from '../src/config';

const baseSecrets = {
  OAUTH_JWT_SIGNING_KEY_B64: btoa('12345678901234567890123456789012'),
  UPSTREAM_CONFIG_ENC_KEY_B64: btoa('12345678901234567890123456789012'),
  CSRF_SIGNING_KEY_B64: btoa('abcdefghijklmnopqrstuvwxyz123456'),
};

export function createEnv(overrides: Partial<Env> = {}, fetchImpl?: typeof fetch): Env {
  return {
    OAUTH_ISSUER: 'https://todoist-mcp-gateway.example.workers.dev',
    MCP_RESOURCE: 'https://todoist-mcp-gateway.example.workers.dev/mcp',
    MCP_AUDIENCE: 'https://todoist-mcp-gateway.example.workers.dev/mcp',
    OAUTH_REDIRECT_HTTPS_HOSTS: 'chatgpt.com,*.chatgpt.com,github.com,*.github.com,claude.ai,*.claude.ai,anthropic.com,*.anthropic.com,localhost',
    ACCESS_TOKEN_TTL_SECONDS: '43200',
    AUTH_CODE_TTL_SECONDS: '120',
    REFRESH_TOKEN_TTL_SECONDS: '2592000',
    ENABLE_REFRESH_TOKENS: 'true',
    ...baseSecrets,
    ...overrides,
    fetch: fetchImpl,
  };
}

export async function dispatch(request: Request, env: Env): Promise<Response> {
  return worker.fetch(request, env);
}

export function createJsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
    ...init,
  });
}

export function initializeRequestBody() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: {
        name: 'vitest-client',
        version: '1.0.0',
      },
    },
  };
}

export function toolsListRequestBody() {
  return {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  };
}

export function toolCallBody(name: string, args: Record<string, unknown>) {
  return {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name,
      arguments: args,
    },
  };
}
