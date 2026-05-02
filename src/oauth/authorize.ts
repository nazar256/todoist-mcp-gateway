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
  access_token_ttl_seconds?: number;
}

const DEFAULT_ACCESS_TOKEN_DAYS = 365;
const ALLOWED_ACCESS_TOKEN_PRESET_DAYS = new Set([30, 90, 365]);
const MIN_ACCESS_TOKEN_DAYS = 1;
const MAX_ACCESS_TOKEN_DAYS = 365;

function parseWholeDays(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return null;
  }

  return parsed;
}

function resolveAccessTokenTtlSeconds(fields: URLSearchParams): number | null {
  const preset = fields.get('token_expiration_preset')?.trim() ?? '';
  const customDaysRaw = fields.get('token_expiration_days')?.trim() ?? '';

  let days = DEFAULT_ACCESS_TOKEN_DAYS;

  if (preset === 'custom') {
    if (!customDaysRaw) {
      return null;
    }

    const customDays = parseWholeDays(customDaysRaw);
    if (customDays === null) {
      return null;
    }
    days = customDays;
  } else if (preset.length > 0) {
    const presetDays = parseWholeDays(preset);
    if (presetDays === null || !ALLOWED_ACCESS_TOKEN_PRESET_DAYS.has(presetDays)) {
      return null;
    }
    days = presetDays;
  }

  if (days < MIN_ACCESS_TOKEN_DAYS || days > MAX_ACCESS_TOKEN_DAYS) {
    return null;
  }

  return days * 24 * 60 * 60;
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function htmlResponse(body: string, status = 200, options?: { scriptNonce?: string }): Response {
  const scriptNonce = options?.scriptNonce;
  const csp = scriptNonce
    ? `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${scriptNonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`
    : "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': csp,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
  });
}

function renderConsentForm(params: {
  request: Awaited<ReturnType<typeof parseAuthorizationRequest>>;
  csrfToken: string;
  formActionUrl: string;
  error?: string;
}): Response {
  const { request, csrfToken, formActionUrl, error } = params;
  const scriptNonce = createCspNonce();
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

      <label for="token_expiration_preset"><strong>Gateway access token expiration</strong></label><br />
      <select id="token_expiration_preset" name="token_expiration_preset" style="width: 100%; padding: 0.5rem; margin: 0.5rem 0 1rem;">
        <option value="30">30 days</option>
        <option value="90">90 days</option>
        <option value="365" selected>1 year (default)</option>
        <option value="custom">Custom days</option>
      </select>

      <label for="token_expiration_days">Custom expiration (days)</label><br />
      <input id="token_expiration_days" name="token_expiration_days" type="number" min="1" max="365" disabled style="width: 100%; padding: 0.5rem; margin: 0.5rem 0 1rem;" />

      <input type="hidden" name="response_type" value="${htmlEscape(request.responseType)}" />
      <input type="hidden" name="client_id" value="${htmlEscape(request.clientId)}" />
      <input type="hidden" name="redirect_uri" value="${htmlEscape(request.redirectUri)}" />
      ${request.state ? `<input type="hidden" name="state" value="${htmlEscape(request.state)}" />` : ''}
      <input type="hidden" name="code_challenge" value="${htmlEscape(request.codeChallenge)}" />
      <input type="hidden" name="code_challenge_method" value="${htmlEscape(request.codeChallengeMethod)}" />
      <input type="hidden" name="resource" value="${htmlEscape(request.resource)}" />
      <input type="hidden" name="scope" value="${htmlEscape(request.scope)}" />
      <input type="hidden" name="csrf_token" value="${htmlEscape(csrfToken)}" />
      <button type="submit">Authorize</button>
    </form>
    <script nonce="${scriptNonce}">
      const preset = document.getElementById('token_expiration_preset');
      const customDays = document.getElementById('token_expiration_days');
      if (preset instanceof HTMLSelectElement && customDays instanceof HTMLInputElement) {
        const syncCustomState = () => {
          const isCustom = preset.value === 'custom';
          customDays.disabled = !isCustom;
          customDays.required = isCustom;
          if (!isCustom) {
            customDays.value = '';
          }
        };
        preset.addEventListener('change', syncCustomState);
        syncCustomState();
      }
    </script>
  </body>
</html>`, 200, { scriptNonce });
}

async function validateTodoistTokenWithUpstream(token: string, fetchImpl: typeof fetch): Promise<void> {
  const client = new TodoistClient(token, fetchImpl);
  try {
    await client.get('/projects');
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
      throw new HttpError(400, 'access_denied', 'Todoist API token is invalid');
    }
  }
}

export async function handleAuthorizeGet(request: Request, config: AppConfig): Promise<Response> {
  const authorizationRequest = await parseAuthorizationRequest(request, config);
  const formActionUrl = new URL('/authorize', request.url).toString();
  const csrfToken = await createCsrfToken(config.csrfSigningKey, {
    exp: Math.floor(Date.now() / 1000) + 600,
    client_id: authorizationRequest.clientId,
    redirect_uri: authorizationRequest.redirectUri,
    ...(authorizationRequest.state ? { state: authorizationRequest.state } : {}),
  });

  return renderConsentForm({ request: authorizationRequest, csrfToken, formActionUrl });
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
  const accessTokenTtlSeconds = resolveAccessTokenTtlSeconds(fields);
  if (accessTokenTtlSeconds === null) {
    throw new HttpError(
      400,
      'invalid_request',
      'Access token expiration must be 1-365 days with a valid preset or custom days.',
    );
  }
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
        ...(authorizationRequest.state ? { state: authorizationRequest.state } : {}),
      });
      return renderConsentForm({
        request: authorizationRequest,
        csrfToken: freshCsrfToken,
        formActionUrl: new URL('/authorize', request.url).toString(),
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
    access_token_ttl_seconds: accessTokenTtlSeconds,
  };

  const code = await signJwt(claims as unknown as Record<string, unknown>, config.oauthJwtSigningKey, 'JWT');
  const redirectUrl = new URL(authorizationRequest.redirectUri);
  redirectUrl.searchParams.set('code', code);
  if (authorizationRequest.state) {
    redirectUrl.searchParams.set('state', authorizationRequest.state);
  }

  return new Response(null, {
    status: 302,
    headers: {
      location: redirectUrl.toString(),
      'cache-control': 'no-store',
    },
  });
}
