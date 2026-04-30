import { base64Decode } from './security/crypto';
import {
  HttpError,
  isLoopbackHostname,
  parseBooleanString,
  parsePositiveSafeInteger,
  parseRedirectHostPatterns,
  validateConfiguredUrl,
} from './security/validators';

export interface Env {
  OAUTH_ISSUER?: string;
  MCP_RESOURCE?: string;
  MCP_AUDIENCE?: string;
  OAUTH_REDIRECT_HTTPS_HOSTS?: string;
  ACCESS_TOKEN_TTL_SECONDS?: string;
  AUTH_CODE_TTL_SECONDS?: string;
  REFRESH_TOKEN_TTL_SECONDS?: string;
  ENABLE_REFRESH_TOKENS?: string;
  OAUTH_JWT_SIGNING_KEY_B64?: string;
  UPSTREAM_CONFIG_ENC_KEY_B64?: string;
  CSRF_SIGNING_KEY_B64?: string;
  fetch?: typeof fetch;
}

export interface AppConfig {
  issuer: string;
  issuerUrl: URL;
  mcpResource: string;
  mcpResourceUrl: URL;
  mcpAudience: string;
  mcpAudienceUrl: URL;
  redirectHostPatterns: string[];
  accessTokenTtlSeconds: number;
  authCodeTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  enableRefreshTokens: boolean;
  oauthJwtSigningKey: Uint8Array;
  upstreamConfigEncryptionKey: Uint8Array;
  csrfSigningKey: Uint8Array;
  isLocalDevelopment: boolean;
  supportedScopes: readonly ['todoist.read', 'todoist.write'];
}

export const SUPPORTED_SCOPES = ['todoist.read', 'todoist.write'] as const;

function requireEnv(name: Exclude<keyof Env, 'fetch'>, env: Env): string {
  const value = env[name];
  if (!value) {
    throw new HttpError(500, 'invalid_config', `Missing required environment variable ${name}`);
  }
  return value;
}

function decodeRequiredKey(name: Exclude<keyof Env, 'fetch'>, env: Env): Uint8Array {
  const value = requireEnv(name, env);
  try {
    return base64Decode(value);
  } catch {
    throw new HttpError(500, 'invalid_config', `${name} must be valid base64`);
  }
}

function stripOriginTrailingSlash(url: URL): string {
  const str = url.toString();
  return url.pathname === '/' && str.endsWith('/') ? str.slice(0, -1) : str;
}

export function parseConfig(env: Env): AppConfig {
  const issuerUrl = validateConfiguredUrl(requireEnv('OAUTH_ISSUER', env), 'OAUTH_ISSUER', true);
  const isLocalDevelopment = isLoopbackHostname(issuerUrl.hostname) && issuerUrl.protocol === 'http:';

  const mcpResourceUrl = validateConfiguredUrl(
    requireEnv('MCP_RESOURCE', env),
    'MCP_RESOURCE',
    isLocalDevelopment,
  );
  const mcpAudienceUrl = validateConfiguredUrl(
    requireEnv('MCP_AUDIENCE', env),
    'MCP_AUDIENCE',
    isLocalDevelopment,
  );

  const oauthJwtSigningKey = decodeRequiredKey('OAUTH_JWT_SIGNING_KEY_B64', env);
  if (oauthJwtSigningKey.byteLength < 32) {
    throw new HttpError(500, 'invalid_config', 'OAUTH_JWT_SIGNING_KEY_B64 must decode to at least 32 bytes');
  }

  const upstreamConfigEncryptionKey = decodeRequiredKey('UPSTREAM_CONFIG_ENC_KEY_B64', env);
  if (![16, 24, 32].includes(upstreamConfigEncryptionKey.byteLength)) {
    throw new HttpError(500, 'invalid_config', 'UPSTREAM_CONFIG_ENC_KEY_B64 must decode to 16, 24, or 32 bytes');
  }

  const csrfSigningKey = decodeRequiredKey('CSRF_SIGNING_KEY_B64', env);
  if (csrfSigningKey.byteLength < 32) {
    throw new HttpError(500, 'invalid_config', 'CSRF_SIGNING_KEY_B64 must decode to at least 32 bytes');
  }

  return {
    issuer: stripOriginTrailingSlash(issuerUrl),
    issuerUrl,
    mcpResource: stripOriginTrailingSlash(mcpResourceUrl),
    mcpResourceUrl,
    mcpAudience: stripOriginTrailingSlash(mcpAudienceUrl),
    mcpAudienceUrl,
    redirectHostPatterns: parseRedirectHostPatterns(requireEnv('OAUTH_REDIRECT_HTTPS_HOSTS', env)),
    accessTokenTtlSeconds: parsePositiveSafeInteger('ACCESS_TOKEN_TTL_SECONDS', requireEnv('ACCESS_TOKEN_TTL_SECONDS', env)),
    authCodeTtlSeconds: parsePositiveSafeInteger('AUTH_CODE_TTL_SECONDS', requireEnv('AUTH_CODE_TTL_SECONDS', env)),
    refreshTokenTtlSeconds: parsePositiveSafeInteger(
      'REFRESH_TOKEN_TTL_SECONDS',
      requireEnv('REFRESH_TOKEN_TTL_SECONDS', env),
    ),
    enableRefreshTokens: parseBooleanString('ENABLE_REFRESH_TOKENS', requireEnv('ENABLE_REFRESH_TOKENS', env)),
    oauthJwtSigningKey,
    upstreamConfigEncryptionKey,
    csrfSigningKey,
    isLocalDevelopment,
    supportedScopes: SUPPORTED_SCOPES,
  };
}
