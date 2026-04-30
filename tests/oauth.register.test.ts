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
});
