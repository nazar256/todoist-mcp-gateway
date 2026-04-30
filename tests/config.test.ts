import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config';
import { createEnv } from './helpers';

describe('config', () => {
  it('valid env parses', () => {
    const config = parseConfig(createEnv());
    expect(config.issuer).toBe('https://todoist-mcp-gateway.example.workers.dev');
    expect(config.enableRefreshTokens).toBe(true);
  });

  it('missing keys fail', () => {
    expect(() => parseConfig(createEnv({ OAUTH_JWT_SIGNING_KEY_B64: undefined }))).toThrow(/Missing required environment variable/);
  });

  it('invalid base64 keys fail', () => {
    expect(() => parseConfig(createEnv({ OAUTH_JWT_SIGNING_KEY_B64: '!!!' }))).toThrow(/must be valid base64/);
  });

  it('short signing key fails', () => {
    expect(() => parseConfig(createEnv({ OAUTH_JWT_SIGNING_KEY_B64: btoa('short') }))).toThrow(/at least 32 bytes/);
  });

  it('invalid issuer resource audience fail', () => {
    expect(() => parseConfig(createEnv({ OAUTH_ISSUER: 'http://example.com' }))).toThrow(/must use HTTPS/);
    expect(() => parseConfig(createEnv({ MCP_RESOURCE: 'not-a-url' }))).toThrow(/valid URL/);
    expect(() => parseConfig(createEnv({ MCP_AUDIENCE: 'http://example.com/mcp' }))).toThrow(/must use HTTPS/);
  });

  it('allows loopback HTTP issuer and local MCP URLs', () => {
    const config = parseConfig(createEnv({
      OAUTH_ISSUER: 'http://localhost:8787',
      MCP_RESOURCE: 'http://localhost:8787/mcp',
      MCP_AUDIENCE: 'http://localhost:8787/mcp',
    }));

    expect(config.issuer).toBe('http://localhost:8787');
    expect(config.mcpResource).toBe('http://localhost:8787/mcp');
    expect(config.mcpAudience).toBe('http://localhost:8787/mcp');
    expect(config.isLocalDevelopment).toBe(true);
  });
});
