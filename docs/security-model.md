# Security Model

## Trust Boundaries

1. **User browser / OAuth user agent**
   - User sees consent form and manually pastes Todoist token.
2. **MCP client (ChatGPT custom connector or similar)**
   - Drives OAuth and later calls `/mcp` with bearer token.
3. **Cloudflare Worker**
   - Verifies OAuth requests, validates Todoist token, signs JWTs, encrypts/decrypts Todoist config, and proxies validated Todoist operations.
4. **Todoist API**
   - Source of truth for projects/tasks/etc and validator for the user-provided developer token.

## Actors

- **User**: owns the Todoist account and pastes the developer token during consent.
- **ChatGPT / custom MCP client**: public OAuth client using PKCE.
- **Cloudflare Worker**: stateless authorization server + protected resource + MCP server.
- **Todoist API**: upstream API the Worker calls on behalf of the user.

## Secrets and Where They Live

### Worker secrets

- `OAUTH_JWT_SIGNING_KEY_B64`
- `UPSTREAM_CONFIG_ENC_KEY_B64`
- `CSRF_SIGNING_KEY_B64`

These live in Wrangler/Cloudflare secret storage.

### User secret

- Todoist developer token provided during consent.

This token is:

- validated against Todoist;
- encrypted before embedding in signed artifacts;
- never persisted server-side;
- never intended to appear in logs or plaintext JWT claims.

## What Is Stored Nowhere

- OAuth client registrations (derived deterministically instead)
- server sessions
- auth codes in persistent storage
- access tokens in persistent storage
- refresh tokens in persistent storage
- Todoist API tokens in DB/KV/DO/cache/log files

## Encrypted Todoist Config Model

Config shape:

```ts
type TodoistConfig = {
  v: 1;
  todoistApiToken: string;
};
```

Encrypted envelope shape:

```ts
type EncryptedEnvelope = {
  v: 1;
  alg: "A256GCM" | "A128GCM";
  iv: string;
  ct: string;
  kid?: string;
};
```

The envelope is bound with AES-GCM AAD using:

- issuer
- resource
- client ID
- token type
- scope
- config version

## JWT Claim Model

Plaintext claims include only routing and verification context such as:

- `typ`
- `iss`
- `aud`
- `exp`
- `iat`
- `jti`
- `client_id`
- `redirect_uri` for auth code only
- `resource`
- `scope`
- `enc_config`

The Todoist API token itself is encrypted inside `enc_config`, not exposed as a plaintext claim.

## MCP Scope Enforcement

- `tools/list` remains compatible with connector expectations and does not hide write tools from read-only tokens.
- `/mcp` enforces OAuth scope at tool and prompt invocation time.
- Read-only access tokens can execute read tools only.
- Todoist-reading prompts require `todoist.read`.
- Mutation and destructive tools require `todoist.write` and fail with `insufficient_scope` when missing.

## CORS Policy

- All JSON API responses include `Access-Control-Allow-Origin: *`.
- `OPTIONS` preflight returns 204 with allowed methods, headers, and a 24-hour max-age.
- This is intentional: the gateway is a public OAuth/MCP endpoint. Bearer token auth provides the actual access control, not origin restrictions.
- Exposed headers include `mcp-session-id` and `www-authenticate` for MCP client compatibility.

## Redirect Validation

- Redirect URI allowlist is configured through `OAUTH_REDIRECT_HTTPS_HOSTS`.
- Validation occurs during both registration and authorization.
- HTTPS is required in production.
- Loopback HTTP is only intended for local development scenarios.

## PKCE Requirement

- PKCE is mandatory.
- Only `S256` is accepted.
- `plain` is rejected.
- `/token` recomputes the S256 code challenge from the supplied verifier.

## CSRF Protection

- `/authorize` GET emits a signed CSRF token.
- `/authorize` POST verifies signature, expiry, and request linkage.
- Invalid or malformed CSRF tokens are rejected.

## Logging and Redaction Rules

- Do not log Todoist tokens, bearer tokens, cookies, or decrypted config.
- Use redaction helpers for sensitive-looking strings.
- Do not print plaintext JWTs in logs.
- Error responses must be safe and generic enough to avoid leaking credentials.

## Known Stateless Tradeoffs

- Auth codes cannot be enforced as one-time-use without state.
- Refresh tokens cannot be revoked globally without state.
- Key rotation requires coordinated acceptance of old/new keys or forced reconnect.
- Any future rate limiting that relies only on in-memory Worker state is best-effort rather than authoritative.

## Revocation Model

- The practical user-side revocation path in v1 is revoking the Todoist developer token in Todoist settings.
- Operator-side rotation is changing Worker secrets, which invalidates future verification/decryption depending on which key changed.
- Full per-user/session revocation is intentionally out of scope for the stateless design.
