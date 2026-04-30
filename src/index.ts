import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { parseConfig, type Env } from './config';
import { handleAuthorizeGet, handleAuthorizePost } from './oauth/authorize';
import { getAuthorizationServerMetadata, getProtectedResourceMetadata } from './oauth/metadata';
import { handleRegister, handleRegisterGet } from './oauth/register';
import { getTodoistConfigFromAccessToken, handleToken } from './oauth/token';
import { resolveIssuerPath } from './oauth/urls';
import { asError, HttpError } from './security/validators';
import { createTodoistMcpServer } from './mcp/server';
import { TodoistClient } from './todoist/client';

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, accept, mcp-session-id',
  'access-control-expose-headers': 'mcp-session-id, www-authenticate',
  'access-control-max-age': '86400',
};

function corsHeaders(extra?: HeadersInit): Record<string, string> {
  return { ...CORS_HEADERS, ...(extra ? Object.fromEntries(new Headers(extra).entries()) : {}) };
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(headers),
    },
  });
}

function oauthJsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return jsonResponse(body, status, { 'cache-control': 'no-store', ...(headers ?? {}) });
}

function serviceInfoResponse(config: ReturnType<typeof parseConfig> | undefined, configError?: HttpError): Response {
  return jsonResponse({
    service: 'todoist-mcp-gateway',
    runtime: 'cloudflare-workers',
    transport: 'streamable-http',
    mcp_path: '/mcp',
    oauth_issuer: config?.issuer,
    healthy: !configError,
    config_error: configError ? { code: configError.code, message: configError.message } : undefined,
  });
}

function healthResponse(configError?: HttpError): Response {
  return jsonResponse(
    configError
      ? { ok: false, error: { code: configError.code, message: configError.message } }
      : { ok: true },
    configError ? 500 : 200,
  );
}

function buildWwwAuthenticate(issuer: string): string {
  return `Bearer realm="${issuer}", error="invalid_token", resource_metadata="${resolveIssuerPath(issuer, '.well-known/oauth-protected-resource')}", scope="todoist.read todoist.write"`;
}

function unauthorizedResponse(issuer: string): Response {
  return oauthJsonResponse(
    {
      ok: false,
      error: {
        code: 'invalid_token',
        message: 'A valid bearer token is required',
      },
    },
    401,
    {
      'www-authenticate': buildWwwAuthenticate(issuer),
    },
  );
}

async function handleMcp(request: Request, env: Env, config: ReturnType<typeof parseConfig>): Promise<Response> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return unauthorizedResponse(config.issuer);
  }

  const token = authorization.slice('Bearer '.length).trim();
  if (!token) {
    return unauthorizedResponse(config.issuer);
  }

  try {
    const { claims, todoistConfig } = await getTodoistConfigFromAccessToken(token, config);
    const todoistClient = new TodoistClient(todoistConfig.todoistApiToken, env.fetch ?? fetch);
    const server = createTodoistMcpServer(todoistClient, { scope: claims.scope });
    const parsedBody = request.method === 'POST' ? await request.clone().json().catch(() => undefined) : undefined;
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });

    try {
      await server.connect(transport);
      const mcpResponse = await transport.handleRequest(request, parsedBody ? { parsedBody } : undefined);
      for (const [key, value] of Object.entries(CORS_HEADERS)) {
        if (!mcpResponse.headers.has(key)) {
          mcpResponse.headers.set(key, value);
        }
      }
      return mcpResponse;
    } finally {
      await transport.close();
      await server.close();
    }
  } catch (error) {
    const httpError = asError(error);
    if (httpError.status === 401) {
      return unauthorizedResponse(config.issuer);
    }

    return oauthJsonResponse(
      {
        ok: false,
        error: { code: httpError.code, message: httpError.message, status: httpError.status },
      },
      httpError.status,
    );
  }
}

async function routeRequest(request: Request, env: Env): Promise<Response> {
  let config: ReturnType<typeof parseConfig> | undefined;
  let configError: HttpError | undefined;

  try {
    config = parseConfig(env);
  } catch (error) {
    configError = asError(error);
  }

  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (url.pathname === '/') {
    return serviceInfoResponse(config, configError);
  }

  if (url.pathname === '/health') {
    return healthResponse(configError);
  }

  if (configError || !config) {
    throw configError ?? new HttpError(500, 'invalid_config', 'Configuration is invalid');
  }

  if (request.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
    return oauthJsonResponse(getAuthorizationServerMetadata(config));
  }

  if (
    request.method === 'GET' &&
    (url.pathname === '/.well-known/oauth-protected-resource' || url.pathname === '/.well-known/oauth-protected-resource/mcp')
  ) {
    return oauthJsonResponse(getProtectedResourceMetadata(config));
  }

  if (request.method === 'POST' && url.pathname === '/register') {
    return handleRegister(request, config);
  }

  if (request.method === 'GET' && url.pathname.startsWith('/register/')) {
    const clientId = decodeURIComponent(url.pathname.slice('/register/'.length));
    return handleRegisterGet(request, config, clientId);
  }

  if (request.method === 'GET' && url.pathname === '/authorize') {
    return handleAuthorizeGet(request, config);
  }

  if (request.method === 'POST' && url.pathname === '/authorize') {
    return handleAuthorizePost(request, config, env.fetch ?? fetch);
  }

  if (request.method === 'POST' && url.pathname === '/token') {
    return handleToken(request, config);
  }

  if (['GET', 'POST', 'DELETE'].includes(request.method) && url.pathname === '/mcp') {
    return handleMcp(request, env, config);
  }

  return jsonResponse({ ok: false, error: { code: 'not_found', message: 'Not found' } }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await routeRequest(request, env);
    } catch (error) {
      const httpError = asError(error);
      return oauthJsonResponse(
        {
          error: httpError.code,
          error_description: httpError.message,
        },
        httpError.status,
        httpError.headers,
      );
    }
  },
};
