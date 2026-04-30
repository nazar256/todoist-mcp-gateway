import type { AppConfig } from '../config';
import { resolveIssuerPath } from './urls';

export function getAuthorizationServerMetadata(config: AppConfig): Record<string, unknown> {
  return {
    issuer: config.issuer,
    authorization_endpoint: resolveIssuerPath(config.issuer, 'authorize'),
    token_endpoint: resolveIssuerPath(config.issuer, 'token'),
    registration_endpoint: resolveIssuerPath(config.issuer, 'register'),
    response_types_supported: ['code'],
    grant_types_supported: config.enableRefreshTokens
      ? ['authorization_code', 'refresh_token']
      : ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: [...config.supportedScopes],
    resource_parameter_supported: true,
  };
}

export function getProtectedResourceMetadata(config: AppConfig): Record<string, unknown> {
  return {
    resource: config.mcpResource,
    authorization_servers: [config.issuer],
    scopes_supported: [...config.supportedScopes],
    bearer_methods_supported: ['header'],
    resource_name: 'Todoist MCP Gateway',
  };
}
