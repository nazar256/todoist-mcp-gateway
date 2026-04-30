import { describe, expect, it, vi } from 'vitest';
import { dispatch, createEnv, createJsonResponse } from './helpers';
import { parseConfig } from '../src/config';
import { deriveClientId } from '../src/oauth/validation';
import { verifyJwt } from '../src/security/jwt';

async function authorizeUrl() {
  const config = parseConfig(createEnv());
  const redirectUri = 'https://chatgpt.com/aip/mcp/callback';
  const clientId = await deriveClientId(config, redirectUri);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state: 'state-123',
    code_challenge: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890-._~',
    code_challenge_method: 'S256',
    scope: 'todoist.read todoist.write',
    resource: config.mcpResource,
  });
  return `https://gateway.test/authorize?${params.toString()}`;
}

function extractFormValue(html: string, name: string): string {
  return new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1] ?? '';
}

describe('oauth authorize', () => {
  it('rejects missing state', async () => {
    const url = new URL(await authorizeUrl());
    url.searchParams.delete('state');
    const response = await dispatch(new Request(url), createEnv());
    expect(response.status).toBe(400);
  });

  it('rejects plain PKCE', async () => {
    const url = new URL(await authorizeUrl());
    url.searchParams.set('code_challenge_method', 'plain');
    const response = await dispatch(new Request(url), createEnv());
    expect(response.status).toBe(400);
  });

  it('rejects missing challenge', async () => {
    const url = new URL(await authorizeUrl());
    url.searchParams.delete('code_challenge');
    const response = await dispatch(new Request(url), createEnv());
    expect(response.status).toBe(400);
  });

  it('rejects bad redirect URI', async () => {
    const config = parseConfig(createEnv());
    const clientId = await deriveClientId(config, 'https://evil.example/callback');
    const response = await dispatch(new Request(`https://gateway.test/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent('https://evil.example/callback')}&state=x&code_challenge=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890-._~&code_challenge_method=S256`), createEnv());
    expect(response.status).toBe(400);
  });

  it('rejects client id mismatch', async () => {
    const url = new URL(await authorizeUrl());
    url.searchParams.set('client_id', 'wrong');
    const response = await dispatch(new Request(url), createEnv());
    expect(response.status).toBe(400);
  });

  it('renders consent form with no secret in hidden fields', async () => {
    const response = await dispatch(new Request(await authorizeUrl()), createEnv());
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('Todoist API token');
    expect(html).not.toContain('todoistApiToken');
    expect(html).not.toContain('Bearer ');
  });

  it('sets security headers', async () => {
    const response = await dispatch(new Request(await authorizeUrl()), createEnv());
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it('rejects invalid CSRF', async () => {
    const getResponse = await dispatch(new Request(await authorizeUrl()), createEnv());
    const html = await getResponse.text();
    const csrf = extractFormValue(html, 'csrf_token');
    const form = new URLSearchParams();
    for (const name of ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'resource', 'scope'] as const) {
      form.set(name, extractFormValue(html, name));
    }
    form.set('csrf_token', `${csrf}broken`);
    form.set('todoist_api_token', 'token');
    const response = await dispatch(new Request('https://gateway.test/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    }), createEnv({ fetch: vi.fn() as unknown as typeof fetch }));
    expect(response.status).toBe(400);
  });

  it('rejects invalid OAuth params', async () => {
    const form = new URLSearchParams({ csrf_token: 'bad', response_type: 'token' });
    const response = await dispatch(new Request('https://gateway.test/authorize', { method: 'POST', body: form }), createEnv());
    expect(response.status).toBe(400);
  });

  it('rejects empty Todoist token', async () => {
    const getResponse = await dispatch(new Request(await authorizeUrl()), createEnv());
    const html = await getResponse.text();
    const form = new URLSearchParams();
    for (const name of ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'resource', 'scope', 'csrf_token'] as const) {
      form.set(name, extractFormValue(html, name));
    }
    form.set('todoist_api_token', '   ');
    const response = await dispatch(new Request('https://gateway.test/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form }), createEnv({ fetch: vi.fn() as unknown as typeof fetch }));
    expect(response.status).toBe(400);
  });

  it('re-renders the form when Todoist explicitly rejects the token', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }));
    const env = createEnv({}, upstreamFetch as unknown as typeof fetch);
    const getResponse = await dispatch(new Request(await authorizeUrl()), env);
    const html = await getResponse.text();
    const form = new URLSearchParams();
    for (const name of ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'resource', 'scope', 'csrf_token'] as const) {
      form.set(name, extractFormValue(html, name));
    }
    form.set('todoist_api_token', 'secret-todoist-token');

    const response = await dispatch(new Request('https://gateway.test/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    }), env);

    expect(upstreamFetch).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('The Todoist API token could not be validated. Please check it and try again.');
  });

  it('allows authorization to continue when Todoist validation fails for a non-auth reason', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response('Temporary upstream failure', { status: 500 }));
    const env = createEnv({}, upstreamFetch as unknown as typeof fetch);
    const getResponse = await dispatch(new Request(await authorizeUrl()), env);
    const html = await getResponse.text();
    const form = new URLSearchParams();
    for (const name of ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'resource', 'scope', 'csrf_token'] as const) {
      form.set(name, extractFormValue(html, name));
    }
    form.set('todoist_api_token', 'secret-todoist-token');

    const response = await dispatch(new Request('https://gateway.test/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    }), env);

    expect(upstreamFetch).toHaveBeenCalledOnce();
    expect(response.status).toBe(302);
  });

  it('validates Todoist token via mocked Todoist API, encrypts config, returns redirect, and does not expose token plaintext', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(createJsonResponse([{ id: 'p1', name: 'Inbox' }]));
    const env = createEnv({}, upstreamFetch as unknown as typeof fetch);
    const getResponse = await dispatch(new Request(await authorizeUrl()), env);
    const html = await getResponse.text();
    const form = new URLSearchParams();
    for (const name of ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'resource', 'scope', 'csrf_token'] as const) {
      form.set(name, extractFormValue(html, name));
    }
    form.set('todoist_api_token', 'secret-todoist-token');

    const response = await dispatch(new Request('https://gateway.test/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form }), env);
    expect(upstreamFetch).toHaveBeenCalledOnce();
    expect(response.status).toBe(302);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('code=');
    expect(location).toContain('state=state-123');
    expect(location).not.toContain('secret-todoist-token');

    const code = new URL(location).searchParams.get('code');
    expect(code).toBeTruthy();
    expect(code).not.toContain('secret-todoist-token');
    const config = parseConfig(env);
    const claims = await verifyJwt<any>(code!, config.oauthJwtSigningKey, config.issuer, config.issuer, 'todoist_mcp_auth_code');
    expect(JSON.stringify(claims)).not.toContain('secret-todoist-token');
    expect(claims.enc_config.ct).toBeTruthy();
  });
});
