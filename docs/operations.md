# Operations

## Local development

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

For local-only experimentation, loopback HTTP issuer/resource values may be used. Production values must be HTTPS.

## Required Wrangler secrets

```text
OAUTH_JWT_SIGNING_KEY_B64
UPSTREAM_CONFIG_ENC_KEY_B64
CSRF_SIGNING_KEY_B64
```

## Secret generation

Generate 32-byte base64 secrets:

```bash
openssl rand -base64 32
openssl rand -base64 32
openssl rand -base64 32
```

## Set secrets

```bash
wrangler secret put OAUTH_JWT_SIGNING_KEY_B64
wrangler secret put UPSTREAM_CONFIG_ENC_KEY_B64
wrangler secret put CSRF_SIGNING_KEY_B64
```

## Deploy

```bash
npm run deploy
```

## ChatGPT connector setup

```text
MCP Server URL:
https://<your-worker>/mcp

Authorization server base URL:
https://<your-worker>

Resource:
https://<your-worker>/mcp
```

## Smoke test checklist

1. `GET /health`
2. `GET /.well-known/oauth-authorization-server`
3. `GET /.well-known/oauth-protected-resource`
4. `POST /register` with a valid ChatGPT redirect URI
5. Visit `/authorize` and confirm consent form renders correctly
6. Submit a valid Todoist developer token
7. Exchange auth code at `/token`
8. Call `/mcp` with bearer token and confirm `tools/list` works
9. Call at least one read tool and one mutation tool against a real Todoist account

## Key rotation notes

- Rotating the JWT signing key invalidates previously signed artifacts unless old verification keys are still accepted.
- Rotating the AES encryption key invalidates previously issued encrypted config unless old decryption keys are still accepted.
- Current implementation documents this limitation but does not implement multi-key transition support.

## User revocation

Users can revoke access by revoking or regenerating their Todoist developer token in Todoist Settings → Integrations.

## Troubleshooting

### Registration fails

- Check that the redirect URI host matches `OAUTH_REDIRECT_HTTPS_HOSTS`.
- Check that production redirect URIs use HTTPS.

### Authorization form rejects submission

- Check CSRF token freshness.
- Check that all OAuth fields were preserved correctly.
- Check that the Todoist token is a real developer token and not whitespace.

### Token exchange fails

- Check `client_id`, `redirect_uri`, `resource`, and `code_verifier`.
- Check that the auth code is not expired.
- Check that `S256` PKCE is used.

### MCP returns 401

- Check bearer token presence.
- Check issuer/audience alignment between Worker config and token artifact.
- Re-authorize if secrets or config changed.

### Todoist tool fails upstream

- Confirm the Todoist token still works against Todoist.
- Confirm the requested resource exists and the caller has access.
- Check whether the request is using a destructive or mutation tool incorrectly.
