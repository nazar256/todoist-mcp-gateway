import { z } from 'zod';
import type { AppConfig } from '../config';
import { signJwt, verifyJwt } from '../security/jwt';
import { HttpError, validateRedirectUri } from '../security/validators';
import { resolveIssuerPath } from './urls';
import { buildPublicClientRegistration, deriveClientId } from './validation';

const registerRequestSchema = z.object({
  redirect_uris: z.tuple([z.string()]),
  client_name: z.string().trim().min(1).max(200).optional(),
}).passthrough();

interface RegisteredClientMetadata {
  client_id: string;
  client_name?: string;
  client_id_issued_at: number;
  client_secret_expires_at: 0;
  redirect_uris: [string];
  token_endpoint_auth_method: 'none';
  grant_types: ['authorization_code'] | ['authorization_code', 'refresh_token'];
  response_types: ['code'];
  registration_client_uri: string;
  registration_access_token?: string;
}

interface RegistrationAccessTokenClaims extends Record<string, unknown> {
  typ: 'todoist_mcp_client_registration';
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  jti: string;
  client_id: string;
  client_name?: string;
  redirect_uri: string;
  grant_types: ['authorization_code'] | ['authorization_code', 'refresh_token'];
  response_types: ['code'];
  token_endpoint_auth_method: 'none';
}

function parseRegisterBody(body: unknown): z.infer<typeof registerRequestSchema> {
  const parsed = registerRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_redirect_uri', 'Exactly one redirect URI is required');
  }
  return parsed.data;
}

function buildRegistrationClientUri(config: AppConfig, clientId: string): string {
  return resolveIssuerPath(config.issuer, `register/${encodeURIComponent(clientId)}`);
}

function buildRegistrationResponse(
  config: AppConfig,
  params: {
    clientId: string;
    clientName?: string;
    clientIdIssuedAt: number;
    redirectUri: string;
    registrationAccessToken?: string;
  },
): RegisteredClientMetadata {
  const publicMetadata = buildPublicClientRegistration(config, params.redirectUri);

  return {
    client_id: params.clientId,
    ...(params.clientName ? { client_name: params.clientName } : {}),
    client_id_issued_at: params.clientIdIssuedAt,
    client_secret_expires_at: 0,
    redirect_uris: publicMetadata.redirect_uris,
    token_endpoint_auth_method: publicMetadata.token_endpoint_auth_method,
    grant_types: publicMetadata.grant_types,
    response_types: publicMetadata.response_types,
    registration_client_uri: buildRegistrationClientUri(config, params.clientId),
    ...(params.registrationAccessToken ? { registration_access_token: params.registrationAccessToken } : {}),
  };
}

async function createRegistrationAccessToken(
  config: AppConfig,
  params: {
    clientId: string;
    clientName?: string;
    redirectUri: string;
    clientIdIssuedAt: number;
  },
): Promise<string> {
  const publicMetadata = buildPublicClientRegistration(config, params.redirectUri);
  const claims: RegistrationAccessTokenClaims = {
    typ: 'todoist_mcp_client_registration',
    iss: config.issuer,
    aud: config.issuer,
    exp: params.clientIdIssuedAt + config.refreshTokenTtlSeconds,
    iat: params.clientIdIssuedAt,
    jti: crypto.randomUUID(),
    client_id: params.clientId,
    ...(params.clientName ? { client_name: params.clientName } : {}),
    redirect_uri: params.redirectUri,
    grant_types: publicMetadata.grant_types,
    response_types: publicMetadata.response_types,
    token_endpoint_auth_method: publicMetadata.token_endpoint_auth_method,
  };
  return signJwt(claims as unknown as Record<string, unknown>, config.oauthJwtSigningKey, 'JWT');
}

export async function handleRegister(request: Request, config: AppConfig): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, 'invalid_client_metadata', 'Registration body must be valid JSON');
  }

  const parsedBody = parseRegisterBody(body);
  const redirectUri = validateRedirectUri(
    parsedBody.redirect_uris[0],
    config.redirectHostPatterns,
    config.isLocalDevelopment,
  ).toString();
  const clientId = await deriveClientId(config, redirectUri);
  const clientIdIssuedAt = Math.floor(Date.now() / 1000);
  const registrationAccessToken = await createRegistrationAccessToken(config, {
    clientId,
    clientName: parsedBody.client_name,
    redirectUri,
    clientIdIssuedAt,
  });

  return new Response(
    JSON.stringify(
      buildRegistrationResponse(config, {
        clientId,
        clientName: parsedBody.client_name,
        clientIdIssuedAt,
        redirectUri,
        registrationAccessToken,
      }),
    ),
    {
      status: 201,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );
}

export async function handleRegisterGet(
  request: Request,
  config: AppConfig,
  clientId: string,
): Promise<Response> {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new HttpError(401, 'invalid_token', 'registration_access_token is required');
  }

  const registrationAccessToken = authorization.slice('Bearer '.length).trim();
  const claims = await verifyJwt<RegistrationAccessTokenClaims>(
    registrationAccessToken,
    config.oauthJwtSigningKey,
    config.issuer,
    config.issuer,
    'todoist_mcp_client_registration',
  );

  if (claims.client_id !== clientId) {
    throw new HttpError(401, 'invalid_token', 'registration_access_token does not match client_id');
  }

  const redirectUri = validateRedirectUri(
    claims.redirect_uri,
    config.redirectHostPatterns,
    config.isLocalDevelopment,
  ).toString();
  const expectedClientId = await deriveClientId(config, redirectUri);
  if (expectedClientId !== claims.client_id) {
    throw new HttpError(401, 'invalid_token', 'registration_access_token is invalid for the current configuration');
  }

  return new Response(
    JSON.stringify(
      buildRegistrationResponse(config, {
        clientId: claims.client_id,
        clientName: claims.client_name,
        clientIdIssuedAt: claims.iat,
        redirectUri,
        registrationAccessToken,
      }),
    ),
    {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );
}
