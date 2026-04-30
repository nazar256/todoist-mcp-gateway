import { describe, expect, it } from 'vitest';
import { parseConfig } from '../src/config';
import { getAuthorizationServerMetadata, getProtectedResourceMetadata } from '../src/oauth/metadata';
import { resolveIssuerPath } from '../src/oauth/urls';
import { createEnv } from './helpers';

describe('oauth metadata', () => {
  it('authorization server metadata exact fields', () => {
    const config = parseConfig(createEnv());
    expect(getAuthorizationServerMetadata(config)).toEqual({
      issuer: config.issuer,
      authorization_endpoint: resolveIssuerPath(config.issuer, 'authorize'),
      token_endpoint: resolveIssuerPath(config.issuer, 'token'),
      registration_endpoint: resolveIssuerPath(config.issuer, 'register'),
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['todoist.read', 'todoist.write'],
      resource_parameter_supported: true,
    });
  });

  it('protected resource metadata exact fields', () => {
    const config = parseConfig(createEnv());
    expect(getProtectedResourceMetadata(config)).toEqual({
      resource: config.mcpResource,
      authorization_servers: [config.issuer],
      scopes_supported: ['todoist.read', 'todoist.write'],
      bearer_methods_supported: ['header'],
      resource_name: 'Todoist MCP Gateway',
    });
  });

  it('refresh grant appears only when enabled', () => {
    const enabled = parseConfig(createEnv());
    const disabled = parseConfig(createEnv({ ENABLE_REFRESH_TOKENS: 'false' }));
    expect(getAuthorizationServerMetadata(enabled).grant_types_supported).toContain('refresh_token');
    expect(getAuthorizationServerMetadata(disabled).grant_types_supported).toEqual(['authorization_code']);
  });

  it('builds issuer-relative endpoints without doubled slashes', () => {
    const config = parseConfig(createEnv());
    const metadata = getAuthorizationServerMetadata(config);

    expect(metadata.authorization_endpoint).toBe('https://todoist-mcp-gateway.xyofn8h7t.workers.dev/authorize');
    expect(metadata.token_endpoint).toBe('https://todoist-mcp-gateway.xyofn8h7t.workers.dev/token');
    expect(metadata.registration_endpoint).toBe('https://todoist-mcp-gateway.xyofn8h7t.workers.dev/register');
  });
});
