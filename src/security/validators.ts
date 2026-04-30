export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers?: HeadersInit;

  constructor(status: number, code: string, message: string, headers?: HeadersInit) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const SCOPE_ORDER = ['todoist.read', 'todoist.write'] as const;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

export function parsePositiveSafeInteger(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new HttpError(500, 'invalid_config', `${name} must be a positive safe integer`);
  }
  return parsed;
}

export function parseBooleanString(name: string, value: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new HttpError(500, 'invalid_config', `${name} must be either "true" or "false"`);
}

export function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase()) || hostname.toLowerCase().endsWith('.localhost');
}

export function validateConfiguredUrl(raw: string, name: string, allowHttpLocalhost = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(500, 'invalid_config', `${name} must be a valid URL`);
  }

  const isHttpLoopback = url.protocol === 'http:' && isLoopbackHostname(url.hostname);
  if (url.protocol !== 'https:' && !(allowHttpLocalhost && isHttpLoopback)) {
    throw new HttpError(500, 'invalid_config', `${name} must use HTTPS${allowHttpLocalhost ? ' (or HTTP localhost in local development)' : ''}`);
  }

  return url;
}

export function parseRedirectHostPatterns(raw: string): string[] {
  const patterns = raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (patterns.length === 0) {
    throw new HttpError(500, 'invalid_config', 'OAUTH_REDIRECT_HTTPS_HOSTS must contain at least one host pattern');
  }

  return patterns;
}

export function matchesHostPattern(hostname: string, pattern: string): boolean {
  const normalizedHost = hostname.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();

  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(2);
    return normalizedHost !== suffix && normalizedHost.endsWith(`.${suffix}`);
  }

  return normalizedHost === normalizedPattern;
}

export function validateRedirectUri(
  raw: string,
  allowedHostPatterns: string[],
  isLocalDevelopment: boolean,
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'invalid_redirect_uri', 'redirect_uri must be a valid URL');
  }

  const hostAllowed = allowedHostPatterns.some((pattern) => matchesHostPattern(url.hostname, pattern));
  if (!hostAllowed) {
    throw new HttpError(400, 'invalid_redirect_uri', 'redirect_uri host is not allowlisted');
  }

  const isLocalHttp = url.protocol === 'http:' && isLoopbackHostname(url.hostname);
  if (url.protocol !== 'https:' && !(isLocalDevelopment && isLocalHttp)) {
    throw new HttpError(400, 'invalid_redirect_uri', 'redirect_uri must use HTTPS');
  }

  return url;
}

export function normalizeScope(scope?: string): string {
  if (!scope || scope.trim().length === 0) {
    return [...SCOPE_ORDER].join(' ');
  }

  const seen = new Set<string>();
  for (const value of scope.split(/\s+/).filter(Boolean)) {
    if (!SCOPE_ORDER.includes(value as (typeof SCOPE_ORDER)[number])) {
      throw new HttpError(400, 'invalid_scope', `Unsupported scope: ${value}`);
    }
    seen.add(value);
  }

  const ordered = SCOPE_ORDER.filter((value) => seen.has(value));
  if (ordered.length === 0) {
    throw new HttpError(400, 'invalid_scope', 'At least one supported scope is required');
  }

  return ordered.join(' ');
}

export function hasScope(scope: string | undefined, requiredScope: string): boolean {
  return normalizeScope(scope).split(' ').includes(requiredScope);
}

export function validateOptionalResource(resource: string | undefined, expected: string): string {
  if (!resource || resource.length === 0) {
    return expected;
  }

  if (resource !== expected) {
    throw new HttpError(400, 'invalid_target', 'Requested resource is not supported');
  }

  return resource;
}

export function validateState(state: string | null | undefined): string {
  if (!state || state.trim().length === 0) {
    throw new HttpError(400, 'invalid_request', 'state is required');
  }
  return state;
}

export function validatePkceChallenge(challenge: string | null | undefined): string {
  if (!challenge) {
    throw new HttpError(400, 'invalid_request', 'code_challenge is required');
  }
  if (!PKCE_CHALLENGE_PATTERN.test(challenge)) {
    throw new HttpError(400, 'invalid_request', 'code_challenge must be 43-128 characters and use PKCE-safe characters');
  }
  return challenge;
}

export function validatePkceMethod(method: string | null | undefined): 'S256' {
  if (method !== 'S256') {
    throw new HttpError(400, 'invalid_request', 'code_challenge_method must be S256');
  }
  return 'S256';
}

export function validateResponseType(responseType: string | null | undefined): 'code' {
  if (responseType !== 'code') {
    throw new HttpError(400, 'unsupported_response_type', 'response_type must be code');
  }
  return 'code';
}

export function validateCodeVerifier(verifier: string | null | undefined): string {
  if (!verifier || !PKCE_CHALLENGE_PATTERN.test(verifier)) {
    throw new HttpError(400, 'invalid_grant', 'code_verifier is invalid');
  }
  return verifier;
}

export function validateNonEmptyInput(value: string | null | undefined, field: string, maxLength = 2048): string {
  if (!value || value.trim().length === 0) {
    throw new HttpError(400, 'invalid_request', `${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, 'invalid_request', `${field} is too long`);
  }
  return trimmed;
}

export function validateTodoistApiToken(value: string | null | undefined): string {
  return validateNonEmptyInput(value, 'todoist_api_token', 1024);
}

export function validateSafePathSegment(value: string, fieldName: string): string {
  if (value.trim().length === 0) {
    throw new HttpError(400, 'invalid_request', `${fieldName} cannot be empty`);
  }
  if (/[/\\]|\.\.|[\x00-\x1F\x7F]/.test(value)) {
    throw new HttpError(400, 'invalid_request', `${fieldName} contains unsafe path characters`);
  }
  return encodeURIComponent(value);
}

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`).join(',')}}`;
}

export function asError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }

  return new HttpError(500, 'internal_error', 'Internal server error');
}
