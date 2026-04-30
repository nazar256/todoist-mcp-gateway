import type { AppConfig } from '../config';
import { decryptJson, encryptJson, type EncryptedEnvelope } from '../security/crypto';
import { signJwt, verifyJwt } from '../security/jwt';
import { asError, HttpError, normalizeScope, validateCodeVerifier, validateOptionalResource } from '../security/validators';
import { createS256CodeChallenge } from './pkce';
import type { AuthCodeClaims } from './authorize';

export interface AccessTokenClaims {
  typ: 'todoist_mcp_access_token';
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  jti: string;
  client_id: string;
  resource: string;
  scope: string;
  enc_config: EncryptedEnvelope;
}

export interface RefreshTokenClaims {
  typ: 'todoist_mcp_refresh_token';
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  jti: string;
  client_id: string;
  resource: string;
  scope: string;
  enc_config: EncryptedEnvelope;
}

type TokenRequestFields = URLSearchParams;

async function parseTokenBody(request: Request): Promise<TokenRequestFields> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return new URLSearchParams(await request.text());
  }

  if (contentType.includes('application/json')) {
    const json = (await request.json()) as Record<string, unknown>;
    const fields = new URLSearchParams();
    for (const [key, value] of Object.entries(json)) {
      if (value !== undefined && value !== null) {
        fields.set(key, String(value));
      }
    }
    return fields;
  }

  throw new HttpError(400, 'invalid_request', 'Unsupported token request content type');
}

function tokenResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function issueAccessToken(config: AppConfig, claims: {
  clientId: string;
  resource: string;
  scope: string;
  encConfig: EncryptedEnvelope;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const accessClaims: AccessTokenClaims = {
    typ: 'todoist_mcp_access_token',
    iss: config.issuer,
    aud: config.mcpAudience,
    exp: now + config.accessTokenTtlSeconds,
    iat: now,
    jti: crypto.randomUUID(),
    client_id: claims.clientId,
    resource: claims.resource,
    scope: normalizeScope(claims.scope),
    enc_config: claims.encConfig,
  };

  return signJwt(accessClaims as unknown as Record<string, unknown>, config.oauthJwtSigningKey, 'JWT');
}

async function issueRefreshToken(config: AppConfig, claims: {
  clientId: string;
  resource: string;
  scope: string;
  encConfig: EncryptedEnvelope;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const refreshClaims: RefreshTokenClaims = {
    typ: 'todoist_mcp_refresh_token',
    iss: config.issuer,
    aud: config.issuer,
    exp: now + config.refreshTokenTtlSeconds,
    iat: now,
    jti: crypto.randomUUID(),
    client_id: claims.clientId,
    resource: claims.resource,
    scope: normalizeScope(claims.scope),
    enc_config: claims.encConfig,
  };

  return signJwt(refreshClaims as unknown as Record<string, unknown>, config.oauthJwtSigningKey, 'JWT');
}

function tokenErrorResponse(error: unknown): Response {
  const httpError = asError(error);
  return new Response(
    JSON.stringify({
      error: httpError.code,
      error_description: httpError.message,
    }),
    {
      status: httpError.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );
}

export async function handleToken(request: Request, config: AppConfig): Promise<Response> {
  try {
    const fields = await parseTokenBody(request);
    const grantType = fields.get('grant_type');

    if (grantType === 'authorization_code') {
      const code = fields.get('code');
      const clientId = fields.get('client_id');
      const redirectUri = fields.get('redirect_uri');
      const codeVerifier = validateCodeVerifier(fields.get('code_verifier'));
      const resource = validateOptionalResource(fields.get('resource') ?? undefined, config.mcpResource);

      if (!code || !clientId || !redirectUri) {
        throw new HttpError(400, 'invalid_request', 'code, client_id, and redirect_uri are required');
      }

      const claims = await verifyJwt<AuthCodeClaims & Record<string, unknown>>(
        code,
        config.oauthJwtSigningKey,
        config.issuer,
        config.issuer,
        'todoist_mcp_auth_code',
      );

      if (claims.client_id !== clientId) {
        throw new HttpError(400, 'invalid_grant', 'client_id does not match authorization code');
      }
      if (claims.redirect_uri !== redirectUri) {
        throw new HttpError(400, 'invalid_grant', 'redirect_uri does not match authorization code');
      }
      if (claims.resource !== resource) {
        throw new HttpError(400, 'invalid_grant', 'resource does not match authorization code');
      }

      const expectedChallenge = await createS256CodeChallenge(codeVerifier);
      if (claims.code_challenge !== expectedChallenge || claims.code_challenge_method !== 'S256') {
        throw new HttpError(400, 'invalid_grant', 'PKCE verification failed');
      }

      const todoistConfig = await decryptJson<{ v: 1; todoistApiToken: string }>(
        claims.enc_config,
        config.upstreamConfigEncryptionKey,
        {
          issuer: config.issuer,
          resource,
          client_id: clientId,
          token_type: 'auth_code',
          scope: claims.scope,
          config_version: 1,
        },
      );

      const accessEncConfig = await encryptJson(todoistConfig, config.upstreamConfigEncryptionKey, {
        issuer: config.issuer,
        resource,
        client_id: clientId,
        token_type: 'access_token',
        scope: claims.scope,
        config_version: 1,
      });

      const accessToken = await issueAccessToken(config, {
        clientId,
        resource,
        scope: claims.scope,
        encConfig: accessEncConfig,
      });

      const response: Record<string, unknown> = {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: config.accessTokenTtlSeconds,
        scope: claims.scope,
      };

      if (config.enableRefreshTokens) {
        const refreshEncConfig = await encryptJson(todoistConfig, config.upstreamConfigEncryptionKey, {
          issuer: config.issuer,
          resource,
          client_id: clientId,
          token_type: 'refresh_token',
          scope: claims.scope,
          config_version: 1,
        });
        response.refresh_token = await issueRefreshToken(config, {
          clientId,
          resource,
          scope: claims.scope,
          encConfig: refreshEncConfig,
        });
      }

      return tokenResponse(response);
    }

    if (grantType === 'refresh_token') {
      if (!config.enableRefreshTokens) {
        throw new HttpError(400, 'unsupported_grant_type', 'refresh_token grant is disabled');
      }

      const refreshToken = fields.get('refresh_token');
      const clientId = fields.get('client_id');
      const resource = validateOptionalResource(fields.get('resource') ?? undefined, config.mcpResource);
      if (!refreshToken || !clientId) {
        throw new HttpError(400, 'invalid_request', 'refresh_token and client_id are required');
      }

      const claims = await verifyJwt<RefreshTokenClaims & Record<string, unknown>>(
        refreshToken,
        config.oauthJwtSigningKey,
        config.issuer,
        config.issuer,
        'todoist_mcp_refresh_token',
      );

      if (claims.client_id !== clientId) {
        throw new HttpError(400, 'invalid_grant', 'client_id does not match refresh token');
      }
      if (claims.resource !== resource) {
        throw new HttpError(400, 'invalid_grant', 'resource does not match refresh token');
      }

      const todoistConfig = await decryptJson<{ v: 1; todoistApiToken: string }>(
        claims.enc_config,
        config.upstreamConfigEncryptionKey,
        {
          issuer: config.issuer,
          resource,
          client_id: clientId,
          token_type: 'refresh_token',
          scope: claims.scope,
          config_version: 1,
        },
      );

      const accessEncConfig = await encryptJson(todoistConfig, config.upstreamConfigEncryptionKey, {
        issuer: config.issuer,
        resource,
        client_id: clientId,
        token_type: 'access_token',
        scope: claims.scope,
        config_version: 1,
      });
      const refreshEncConfig = await encryptJson(todoistConfig, config.upstreamConfigEncryptionKey, {
        issuer: config.issuer,
        resource,
        client_id: clientId,
        token_type: 'refresh_token',
        scope: claims.scope,
        config_version: 1,
      });

      const accessToken = await issueAccessToken(config, {
        clientId,
        resource,
        scope: claims.scope,
        encConfig: accessEncConfig,
      });
      const nextRefreshToken = await issueRefreshToken(config, {
        clientId,
        resource,
        scope: claims.scope,
        encConfig: refreshEncConfig,
      });

      return tokenResponse({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: config.accessTokenTtlSeconds,
        scope: claims.scope,
        refresh_token: nextRefreshToken,
      });
    }

    throw new HttpError(400, 'unsupported_grant_type', 'Unsupported grant_type');
  } catch (error) {
    return tokenErrorResponse(error);
  }
}

export async function getTodoistConfigFromAccessToken(token: string, config: AppConfig) {
  const claims = await verifyJwt<AccessTokenClaims & Record<string, unknown>>(
    token,
    config.oauthJwtSigningKey,
    config.issuer,
    config.mcpAudience,
    'todoist_mcp_access_token',
  );

  const todoistConfig = await decryptJson<{ v: 1; todoistApiToken: string }>(
    claims.enc_config,
    config.upstreamConfigEncryptionKey,
    {
      issuer: config.issuer,
      resource: claims.resource,
      client_id: claims.client_id,
      token_type: 'access_token',
      scope: claims.scope,
      config_version: 1,
    },
  );

  return {
    claims,
    todoistConfig,
  };
}
