import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '../src/config';
import { handleAuthorizePost } from '../src/oauth/authorize';
import { handleToken } from '../src/oauth/token';
import { createS256CodeChallenge } from '../src/oauth/pkce';
import { signJwt } from '../src/security/jwt';
import { createEnv, createJsonResponse } from './helpers';

async function issueAuthorizationCode(envOverrides = {}) {
  const env = createEnv(envOverrides as any, vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'p1' }]))) as unknown as typeof fetch);
  const config = parseConfig(env);
  const codeVerifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890-._~';
  const codeChallenge = await createS256CodeChallenge(codeVerifier);
  const form = new URLSearchParams({
    response_type: 'code',
    client_id: await (await import('../src/oauth/validation')).deriveClientId(config, 'https://chatgpt.com/aip/mcp/callback'),
    redirect_uri: 'https://chatgpt.com/aip/mcp/callback',
    state: 'state-123',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    resource: config.mcpResource,
    scope: 'todoist.read todoist.write',
    csrf_token: await (await import('../src/security/csrf')).createCsrfToken(config.csrfSigningKey, {
      exp: Math.floor(Date.now() / 1000) + 600,
      client_id: await (await import('../src/oauth/validation')).deriveClientId(config, 'https://chatgpt.com/aip/mcp/callback'),
      redirect_uri: 'https://chatgpt.com/aip/mcp/callback',
      state: 'state-123',
    }),
    todoist_api_token: 'secret-token',
  });
  const response = await handleAuthorizePost(new Request('https://gateway.test/authorize', { method: 'POST', body: form }), config, env.fetch!);
  const code = new URL(response.headers.get('location')!).searchParams.get('code')!;
  return { env, config, code, codeVerifier };
}

describe('oauth token', () => {
  it('rejects wrong grant type', async () => {
    const response = await handleToken(new Request('https://gateway.test/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
    }), parseConfig(createEnv()));
    expect(response.status).toBe(400);
  });

  it('rejects expired auth code', async () => {
    const env = createEnv();
    const config = parseConfig(env);
    const code = await signJwt({ typ: 'todoist_mcp_auth_code', iss: config.issuer, aud: config.issuer, exp: 1, iat: 0, jti: '1', client_id: 'c', redirect_uri: 'https://chatgpt.com/cb', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', resource: config.mcpResource, scope: 'todoist.read', enc_config: { v: 1, alg: 'A256GCM', iv: 'a', ct: 'b' } }, config.oauthJwtSigningKey, 'JWT');
    const response = await handleToken(new Request('https://gateway.test/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: 'c', redirect_uri: 'https://chatgpt.com/cb', code_verifier: 'x'.repeat(43) }) }), config);
    expect(response.status).toBe(401);
  });

  it('rejects wrong JWT typ', async () => {
    const env = createEnv();
    const config = parseConfig(env);
    const token = await signJwt({ typ: 'wrong', iss: config.issuer, aud: config.issuer, exp: Math.floor(Date.now() / 1000) + 100, iat: Math.floor(Date.now() / 1000), jti: '1' }, config.oauthJwtSigningKey, 'JWT');
    const response = await handleToken(new Request('https://gateway.test/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: token, client_id: 'c', redirect_uri: 'https://chatgpt.com/cb', code_verifier: 'x'.repeat(43) }) }), config);
    expect(response.status).toBe(401);
  });

  it('rejects wrong PKCE verifier', async () => {
    const { config, code } = await issueAuthorizationCode();
    const response = await handleToken(new Request('https://gateway.test/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: await (await import('../src/oauth/validation')).deriveClientId(config, 'https://chatgpt.com/aip/mcp/callback'), redirect_uri: 'https://chatgpt.com/aip/mcp/callback', code_verifier: 'z'.repeat(43), resource: config.mcpResource }) }), config);
    expect(response.status).toBe(400);
  });

  it('rejects redirect mismatch', async () => {
    const { config, code, codeVerifier } = await issueAuthorizationCode();
    const response = await handleToken(new Request('https://gateway.test/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: await (await import('../src/oauth/validation')).deriveClientId(config, 'https://chatgpt.com/aip/mcp/callback'), redirect_uri: 'https://chatgpt.com/other', code_verifier: codeVerifier, resource: config.mcpResource }) }), config);
    expect(response.status).toBe(400);
  });

  it('rejects resource mismatch', async () => {
    const { config, code, codeVerifier } = await issueAuthorizationCode();
    const response = await handleToken(new Request('https://gateway.test/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: await (await import('../src/oauth/validation')).deriveClientId(config, 'https://chatgpt.com/aip/mcp/callback'), redirect_uri: 'https://chatgpt.com/aip/mcp/callback', code_verifier: codeVerifier, resource: 'https://wrong.example/mcp' }) }), config);
    expect(response.status).toBe(400);
  });

  it('issues access token and optionally refresh token', async () => {
    const { config, code, codeVerifier } = await issueAuthorizationCode();
    const response = await handleToken(new Request('https://gateway.test/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: await (await import('../src/oauth/validation')).deriveClientId(config, 'https://chatgpt.com/aip/mcp/callback'), redirect_uri: 'https://chatgpt.com/aip/mcp/callback', code_verifier: codeVerifier, resource: config.mcpResource }) }), config);
    const body = await response.json() as any;
    expect(response.status).toBe(200);
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
  });

  it('preserves granted read-only scope in token response', async () => {
    const env = createEnv({}, vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'p1' }]))) as unknown as typeof fetch);
    const config = parseConfig(env);
    const codeVerifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890-._~';
    const redirectUri = 'https://chatgpt.com/aip/mcp/callback';
    const clientId = await (await import('../src/oauth/validation')).deriveClientId(config, redirectUri);
    const form = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state: 'state-123',
      code_challenge: await createS256CodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      resource: config.mcpResource,
      scope: 'todoist.read',
      csrf_token: await (await import('../src/security/csrf')).createCsrfToken(config.csrfSigningKey, {
        exp: Math.floor(Date.now() / 1000) + 600,
        client_id: clientId,
        redirect_uri: redirectUri,
        state: 'state-123',
      }),
      todoist_api_token: 'secret-token',
    });
    const authorize = await handleAuthorizePost(new Request('https://gateway.test/authorize', { method: 'POST', body: form }), config, env.fetch!);
    const code = new URL(authorize.headers.get('location')!).searchParams.get('code')!;

    const response = await handleToken(new Request('https://gateway.test/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirectUri, code_verifier: codeVerifier, resource: config.mcpResource }),
    }), config);
    const body = await response.json() as any;

    expect(response.status).toBe(200);
    expect(body.scope).toBe('todoist.read');
  });

  it('refresh token path issues a new access token', async () => {
    const { config, code, codeVerifier } = await issueAuthorizationCode();
    const exchange = await handleToken(new Request('https://gateway.test/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: await (await import('../src/oauth/validation')).deriveClientId(config, 'https://chatgpt.com/aip/mcp/callback'), redirect_uri: 'https://chatgpt.com/aip/mcp/callback', code_verifier: codeVerifier, resource: config.mcpResource }) }), config);
    const { refresh_token } = await exchange.json() as any;
    const refreshed = await handleToken(new Request('https://gateway.test/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token, client_id: await (await import('../src/oauth/validation')).deriveClientId(config, 'https://chatgpt.com/aip/mcp/callback'), resource: config.mcpResource }) }), config);
    expect(refreshed.status).toBe(200);
    expect(((await refreshed.json()) as any).access_token).toBeTruthy();
  });

  it('issues tokens when authorization code was granted without state', async () => {
    const env = createEnv({}, vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'p1' }]))) as unknown as typeof fetch);
    const config = parseConfig(env);
    const codeVerifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890-._~';
    const redirectUri = 'https://chatgpt.com/aip/mcp/callback';
    const clientId = await (await import('../src/oauth/validation')).deriveClientId(config, redirectUri);
    const form = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: await createS256CodeChallenge(codeVerifier),
      code_challenge_method: 'S256',
      resource: config.mcpResource,
      scope: 'todoist.read',
      csrf_token: await (await import('../src/security/csrf')).createCsrfToken(config.csrfSigningKey, {
        exp: Math.floor(Date.now() / 1000) + 600,
        client_id: clientId,
        redirect_uri: redirectUri,
      }),
      todoist_api_token: 'secret-token',
    });

    const authorize = await handleAuthorizePost(new Request('https://gateway.test/authorize', { method: 'POST', body: form }), config, env.fetch!);
    const location = new URL(authorize.headers.get('location')!);
    const code = location.searchParams.get('code')!;

    expect(location.searchParams.has('state')).toBe(false);

    const response = await handleToken(new Request('https://gateway.test/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirectUri, code_verifier: codeVerifier, resource: config.mcpResource }),
    }), config);

    expect(response.status).toBe(200);
    expect(((await response.json()) as any).access_token).toBeTruthy();
  });
});
