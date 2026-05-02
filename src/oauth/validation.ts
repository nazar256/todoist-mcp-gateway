import type { AppConfig } from '../config';
import {
  canonicalize,
  HttpError,
  normalizeScope,
  validateOptionalResource,
  validateOptionalState,
  validatePkceChallenge,
  validatePkceMethod,
  validateRedirectUri,
  validateResponseType,
} from '../security/validators';

export interface PublicClientMetadata {
  redirect_uris: [string];
  token_endpoint_auth_method: 'none';
  grant_types: ['authorization_code'] | ['authorization_code', 'refresh_token'];
  response_types: ['code'];
}

export interface OAuthAuthorizationRequest {
  responseType: 'code';
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  resource: string;
  scope: string;
}

function publicClientMetadataForRedirectUri(config: AppConfig, redirectUri: string): PublicClientMetadata {
  return {
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: 'none',
    grant_types: config.enableRefreshTokens ? ['authorization_code', 'refresh_token'] : ['authorization_code'],
    response_types: ['code'],
  };
}

export async function deriveClientId(config: AppConfig, redirectUri: string): Promise<string> {
  const metadata = publicClientMetadataForRedirectUri(config, redirectUri);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalize(metadata)));
  const bytes = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `todoist-public-${bytes}`;
}

export async function validateClientIdentity(
  config: AppConfig,
  clientId: string | null | undefined,
  redirectUri: string,
): Promise<string> {
  if (!clientId) {
    throw new HttpError(400, 'invalid_client', 'client_id is required');
  }

  const expectedClientId = await deriveClientId(config, redirectUri);
  if (clientId !== expectedClientId) {
    throw new HttpError(400, 'invalid_client', 'client_id does not match redirect_uri');
  }

  return clientId;
}

export async function parseAuthorizationRequest(request: Request, config: AppConfig): Promise<OAuthAuthorizationRequest> {
  const url = new URL(request.url);
  const redirectUri = validateRedirectUri(
    url.searchParams.get('redirect_uri') ?? '',
    config.redirectHostPatterns,
    config.isLocalDevelopment,
  ).toString();

  return {
    responseType: validateResponseType(url.searchParams.get('response_type')),
    clientId: await validateClientIdentity(config, url.searchParams.get('client_id'), redirectUri),
    redirectUri,
    state: validateOptionalState(url.searchParams.get('state')),
    codeChallenge: validatePkceChallenge(url.searchParams.get('code_challenge')),
    codeChallengeMethod: validatePkceMethod(url.searchParams.get('code_challenge_method')),
    resource: validateOptionalResource(url.searchParams.get('resource') ?? undefined, config.mcpResource),
    scope: normalizeScope(url.searchParams.get('scope') ?? undefined),
  };
}

export async function parseAuthorizeForm(fields: URLSearchParams, config: AppConfig): Promise<OAuthAuthorizationRequest> {
  const redirectUri = validateRedirectUri(
    fields.get('redirect_uri') ?? '',
    config.redirectHostPatterns,
    config.isLocalDevelopment,
  ).toString();

  return {
    responseType: validateResponseType(fields.get('response_type')),
    clientId: await validateClientIdentity(config, fields.get('client_id'), redirectUri),
    redirectUri,
    state: validateOptionalState(fields.get('state')),
    codeChallenge: validatePkceChallenge(fields.get('code_challenge')),
    codeChallengeMethod: validatePkceMethod(fields.get('code_challenge_method')),
    resource: validateOptionalResource(fields.get('resource') ?? undefined, config.mcpResource),
    scope: normalizeScope(fields.get('scope') ?? undefined),
  };
}

export function buildPublicClientRegistration(config: AppConfig, redirectUri: string) {
  return publicClientMetadataForRedirectUri(config, redirectUri);
}
