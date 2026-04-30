import { describe, expect, it } from 'vitest';
import { dispatch, createEnv } from './helpers';

describe('oauth register', () => {
  it('accepts valid ChatGPT redirect URI', async () => {
    const response = await dispatch(new Request('https://gateway.test/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://chatgpt.com/aip/mcp/callback'] }),
    }), createEnv());

    expect(response.status).toBe(201);
    const body = await response.json() as any;
    expect(body.redirect_uris).toEqual(['https://chatgpt.com/aip/mcp/callback']);
    expect(body.token_endpoint_auth_method).toBe('none');
  });

  it('rejects unallowed host', async () => {
    const response = await dispatch(new Request('https://gateway.test/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://evil.example/callback'] }),
    }), createEnv());

    expect(response.status).toBe(400);
  });

  it('rejects multiple redirect URIs', async () => {
    const response = await dispatch(new Request('https://gateway.test/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://chatgpt.com/a', 'https://chatgpt.com/b'] }),
    }), createEnv());

    expect(response.status).toBe(400);
  });

  it('returns deterministic client id', async () => {
    const request = new Request('https://gateway.test/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://chatgpt.com/aip/mcp/callback'] }),
    });

    const [first, second] = await Promise.all([
      dispatch(new Request('https://gateway.test/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: ['https://chatgpt.com/aip/mcp/callback'] }),
      }), createEnv()),
      dispatch(new Request('https://gateway.test/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: ['https://chatgpt.com/aip/mcp/callback'] }),
      }), createEnv()),
    ]);
    expect(((await first.json()) as any).client_id).toBe(((await second.json()) as any).client_id);
  });

  it('returns public client with token endpoint auth method none', async () => {
    const response = await dispatch(new Request('https://gateway.test/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://chatgpt.com/aip/mcp/callback'] }),
    }), createEnv());

    expect(((await response.json()) as any).token_endpoint_auth_method).toBe('none');
  });

  it('returns registration management fields for client resolution', async () => {
    const response = await dispatch(new Request('https://gateway.test/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['https://chatgpt.com/aip/mcp/callback'],
        client_name: 'ChatGPT Todoist Connector',
      }),
    }), createEnv());

    const body = await response.json() as any;

    expect(body.client_name).toBe('ChatGPT Todoist Connector');
    expect(body.client_id_issued_at).toBeGreaterThan(0);
    expect(body.client_secret_expires_at).toBe(0);
    expect(body.registration_access_token).toBeTruthy();
    expect(body.registration_client_uri).toMatch(/\/register\//);
  });

  it('resolves a registered client from registration_client_uri', async () => {
    const registerResponse = await dispatch(new Request('https://gateway.test/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['https://chatgpt.com/aip/mcp/callback'],
        client_name: 'ChatGPT Todoist Connector',
      }),
    }), createEnv());
    const registration = await registerResponse.json() as any;

    const resolveResponse = await dispatch(new Request(registration.registration_client_uri, {
      headers: { authorization: `Bearer ${registration.registration_access_token}` },
    }), createEnv());
    const resolved = await resolveResponse.json() as any;

    expect(resolveResponse.status).toBe(200);
    expect(resolved.client_id).toBe(registration.client_id);
    expect(resolved.client_name).toBe('ChatGPT Todoist Connector');
    expect(resolved.redirect_uris).toEqual(['https://chatgpt.com/aip/mcp/callback']);
  });

  it('rejects registration client resolution without bearer token', async () => {
    const registerResponse = await dispatch(new Request('https://gateway.test/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['https://chatgpt.com/aip/mcp/callback'] }),
    }), createEnv());
    const registration = await registerResponse.json() as any;

    const resolveResponse = await dispatch(new Request(registration.registration_client_uri), createEnv());

    expect(resolveResponse.status).toBe(401);
  });
});
