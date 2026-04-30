import type { AppConfig } from '../config';
import { createCsrfToken, verifyCsrfToken } from '../security/csrf';
import type { EncryptedEnvelope } from '../security/crypto';
import { encryptJson } from '../security/crypto';
import { signJwt } from '../security/jwt';
import {
  HttpError,
  validateNonEmptyInput,
  validateTodoistApiToken,
} from '../security/validators';
import { TodoistClient } from '../todoist/client';
import type { TodoistConfig } from '../todoist/types';
import { parseAuthorizationRequest, parseAuthorizeForm } from './validation';

export interface AuthCodeClaims {
  typ: 'todoist_mcp_auth_code';
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  jti: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  resource: string;
  scope: string;
  enc_config: EncryptedEnvelope;
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
  });
}

function renderConsentForm(params: {
  request: Awaited<ReturnType<typeof parseAuthorizationRequest>>;
  csrfToken: string;
  error?: string;
}): Response {
  const { request, csrfToken, error } = params;
  return htmlResponse(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorize Todoist MCP Gateway</title>
  </head>
  <body style="font-family: sans-serif; max-width: 44rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5;">
    <h1>Connect Todoist MCP Gateway</h1>
    <p>This gateway needs your Todoist API token to call Todoist on your behalf. The token is encrypted and carried inside signed gateway tokens. It is not stored server-side.</p>
    <p>Find your token in <strong>Todoist → Settings → Integrations → Developer token</strong>.</p>
    ${error ? `<p style="color: #b00020;"><strong>${htmlEscape(error)}</strong></p>` : ''}
    <form method="post" action="/authorize">
      <label for="todoist_api_token"><strong>Todoist API token</strong></label><br />
      <input id="todoist_api_token" name="todoist_api_token" type="password" autocomplete="off" spellcheck="false" required style="width: 100%; padding: 0.5rem; margin: 0.5rem 0 1rem;" />
      <input type="hidden" name="response_type" value="${htmlEscape(request.responseType)}" />
      <input type="hidden" name="client_id" value="${htmlEscape(request.clientId)}" />
      <input type="hidden" name="redirect_uri" value="${htmlEscape(request.redirectUri)}" />
      <input type="hidden" name="state" value="${htmlEscape(request.state)}" />
      <input type="hidden" name="code_challenge" value="${htmlEscape(request.codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="${htmlEscape(request.codeChallengeMethod)}" />
      <input type="hidden" name="resource" value="${htmlEscape(request.resource)}" />
      <input type="hidden" name="scope" value="${htmlEscape(request.scope)}" />
      <input type="hidden" name="csrf_token" value="${htmlEscape(csrfToken)}" />
      <button type="submit">Authorize</button>
    </form>
  </body>
</html>`);
}

async function validateTodoistTokenWithUpstream(token: string, fetchImpl: typeof fetch): Promise<void> {
  const client = new TodoistClient(token, fetchImpl);
  try {
    await client.get('/projects');
  } catch {
    throw new HttpError(400, 'access_denied', 'Todoist API token is invalid');
  }
}

export async function handleAuthorizeGet(request: Request, config: AppConfig): Promise<Response> {
  const authorizationRequest = await parseAuthorizationRequest(request, config);
  const csrfToken = await createCsrfToken(config.csrfSigningKey, {
    exp: Math.floor(Date.now() / 1000) + 600,
    client_id: authorizationRequest.clientId,
    redirect_uri: authorizationRequest.redirectUri,
    state: authorizationRequest.state,
  });

  return renderConsentForm({ request: authorizationRequest, csrfToken });
}

export async function handleAuthorizePost(
  request: Request,
  config: AppConfig,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const fields = new URLSearchParams();
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const parsed = new URLSearchParams(await request.text());
    for (const [key, value] of parsed.entries()) {
      fields.set(key, value);
    }
  } else {
    const formData = await request.formData();
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') {
        fields.set(key, value);
      }
    }
  }

  const authorizationRequest = await parseAuthorizeForm(fields, config);
  const csrfToken = validateNonEmptyInput(fields.get('csrf_token'), 'csrf_token');
  const csrfPayload = await verifyCsrfToken(config.csrfSigningKey, csrfToken);
  if (
    csrfPayload.client_id !== authorizationRequest.clientId ||
    csrfPayload.redirect_uri !== authorizationRequest.redirectUri ||
    csrfPayload.state !== authorizationRequest.state
  ) {
    throw new HttpError(400, 'invalid_request', 'CSRF token does not match authorization request');
  }

  const todoistApiToken = validateTodoistApiToken(fields.get('todoist_api_token'));

  try {
    await validateTodoistTokenWithUpstream(todoistApiToken, fetchImpl);
  } catch (error) {
    if (error instanceof HttpError && error.code === 'access_denied') {
      const freshCsrfToken = await createCsrfToken(config.csrfSigningKey, {
        exp: Math.floor(Date.now() / 1000) + 600,
        client_id: authorizationRequest.clientId,
        redirect_uri: authorizationRequest.redirectUri,
        state: authorizationRequest.state,
      });
      return renderConsentForm({
        request: authorizationRequest,
        csrfToken: freshCsrfToken,
        error: 'The Todoist API token could not be validated. Please check it and try again.',
      });
    }
    throw error;
  }

  const todoistConfig: TodoistConfig = {
    v: 1,
    todoistApiToken,
  };

  const encConfig = await encryptJson(todoistConfig, config.upstreamConfigEncryptionKey, {
    issuer: config.issuer,
    resource: authorizationRequest.resource,
    client_id: authorizationRequest.clientId,
    token_type: 'auth_code',
    scope: authorizationRequest.scope,
    config_version: 1,
  });

  const now = Math.floor(Date.now() / 1000);
  const claims: AuthCodeClaims = {
    typ: 'todoist_mcp_auth_code',
    iss: config.issuer,
    aud: config.issuer,
    exp: now + config.authCodeTtlSeconds,
    iat: now,
    jti: crypto.randomUUID(),
    client_id: authorizationRequest.clientId,
    redirect_uri: authorizationRequest.redirectUri,
    code_challenge: authorizationRequest.codeChallenge,
    code_challenge_method: authorizationRequest.codeChallengeMethod,
    resource: authorizationRequest.resource,
    scope: authorizationRequest.scope,
    enc_config: encConfig,
  };

  const code = await signJwt(claims as unknown as Record<string, unknown>, config.oauthJwtSigningKey, 'JWT');
  const redirectUrl = new URL(authorizationRequest.redirectUri);
  redirectUrl.searchParams.set('code', code);
  redirectUrl.searchParams.set('state', authorizationRequest.state);

  return new Response(null, {
    status: 302,
    headers: {
      location: redirectUrl.toString(),
      'cache-control': 'no-store',
    },
  });
}
