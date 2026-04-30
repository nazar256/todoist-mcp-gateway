import type { AppConfig } from '../config';
import { buildPublicClientRegistration, deriveClientId } from './validation';
import { HttpError, validateRedirectUri } from '../security/validators';

interface RegisterRequestBody {
  redirect_uris?: unknown;
}

export async function handleRegister(request: Request, config: AppConfig): Promise<Response> {
  let body: RegisterRequestBody;
  try {
    body = (await request.json()) as RegisterRequestBody;
  } catch {
    throw new HttpError(400, 'invalid_client_metadata', 'Registration body must be valid JSON');
  }

  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length !== 1) {
    throw new HttpError(400, 'invalid_redirect_uri', 'Exactly one redirect URI is required');
  }

  const redirectUri = validateRedirectUri(
    String(body.redirect_uris[0]),
    config.redirectHostPatterns,
    config.isLocalDevelopment,
  ).toString();

  const clientId = await deriveClientId(config, redirectUri);
  const publicMetadata = buildPublicClientRegistration(config, redirectUri);

  return new Response(
    JSON.stringify({
      client_id: clientId,
      client_id_issued_at: 0,
      redirect_uris: publicMetadata.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: publicMetadata.grant_types,
      response_types: publicMetadata.response_types,
    }),
    {
      status: 201,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      },
    },
  );
}
