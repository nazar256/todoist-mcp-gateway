import { describe, expect, it, vi } from 'vitest';
import { dispatch, createEnv, createJsonResponse, initializeRequestBody, toolCallBody, toolsListRequestBody } from './helpers';
import { parseConfig } from '../src/config';
import { handleAuthorizePost } from '../src/oauth/authorize';
import { handleToken } from '../src/oauth/token';
import { createCsrfToken } from '../src/security/csrf';
import { deriveClientId } from '../src/oauth/validation';
import { createS256CodeChallenge } from '../src/oauth/pkce';

async function accessToken(scope = 'todoist.read todoist.write') {
  const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('/tasks/t1')) {
      return createJsonResponse({ id: 't1', content: 'allowed' });
    }
    return createJsonResponse([{ id: 'p1' }]);
  });
  const env = createEnv({}, fetchMock as unknown as typeof fetch);
  const config = parseConfig(env);
  const redirectUri = 'https://chatgpt.com/aip/mcp/callback';
  const clientId = await deriveClientId(config, redirectUri);
  const codeVerifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890-._~';
  const form = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state: 'state-123',
    code_challenge: await createS256CodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    resource: config.mcpResource,
    scope,
    csrf_token: await createCsrfToken(config.csrfSigningKey, { exp: Math.floor(Date.now() / 1000) + 60, client_id: clientId, redirect_uri: redirectUri, state: 'state-123' }),
    todoist_api_token: 'secret-token',
  });
  const authorize = await handleAuthorizePost(new Request('https://gateway.test/authorize', { method: 'POST', body: form }), config, env.fetch!);
  const code = new URL(authorize.headers.get('location')!).searchParams.get('code')!;
  const tokenResponse = await handleToken(new Request('https://gateway.test/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirectUri, code_verifier: codeVerifier, resource: config.mcpResource }) }), config);
  const tokenJson = await tokenResponse.json() as any;
  return { accessToken: tokenJson.access_token as string, env };
}

describe('mcp auth', () => {
  it('OPTIONS preflight returns 204 with CORS headers', async () => {
    const response = await dispatch(new Request('https://gateway.test/mcp', { method: 'OPTIONS' }), createEnv());
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
  });

  it('missing bearer gets 401', async () => {
    const response = await dispatch(new Request('https://gateway.test/mcp', { method: 'POST' }), createEnv());
    expect(response.status).toBe(401);
  });

  it('401 contains WWW-Authenticate with resource_metadata', async () => {
    const response = await dispatch(new Request('https://gateway.test/mcp', { method: 'POST' }), createEnv());
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://todoist-mcp-gateway.example.workers.dev/.well-known/oauth-protected-resource"',
    );
  });

  it('invalid bearer gets 401', async () => {
    const response = await dispatch(new Request('https://gateway.test/mcp', { method: 'POST', headers: { authorization: 'Bearer nope' } }), createEnv());
    expect(response.status).toBe(401);
  });

  it('valid bearer decrypts Todoist config and initializes server and lists tools', async () => {
    const tokenBundle = await accessToken();
    const bearer = tokenBundle.accessToken;
    const env = tokenBundle.env;
    const initResponse = await dispatch(new Request('https://gateway.test/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(initializeRequestBody()),
    }), env);
    expect(initResponse.status).toBe(200);
    const listResponse = await dispatch(new Request('https://gateway.test/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(toolsListRequestBody()),
    }), env);
    const json = await listResponse.json() as any;
    expect(JSON.stringify(json)).toContain('get_tasks_list');
  });

  it('read-only bearer still lists write tools but blocks write tool invocation', async () => {
    const tokenBundle = await accessToken('todoist.read');
    const bearer = tokenBundle.accessToken;
    const env = tokenBundle.env;

    await dispatch(new Request('https://gateway.test/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(initializeRequestBody()),
    }), env);

    const listResponse = await dispatch(new Request('https://gateway.test/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(toolsListRequestBody()),
    }), env);
    expect(JSON.stringify(await listResponse.json())).toContain('create_tasks');

    const writeResponse = await dispatch(new Request('https://gateway.test/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(toolCallBody('create_tasks', { items: [{ content: 'blocked' }] })),
    }), env);
    expect(JSON.stringify(await writeResponse.json())).toContain('insufficient_scope');

    const readResponse = await dispatch(new Request('https://gateway.test/mcp', {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(toolCallBody('get_tasks', { items: [{ task_id: 't1' }] })),
    }), env);
    expect(JSON.stringify(await readResponse.json())).toContain('allowed');
  });
});
