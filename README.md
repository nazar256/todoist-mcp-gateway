# todoist-mcp-gateway

Stateless Cloudflare Worker MCP gateway for Todoist.

Connects ChatGPT, Claude, and other MCP clients to your Todoist account through a remote [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) endpoint with OAuth Authorization Code + PKCE.

## Why this gateway exists

The reference Todoist MCP server is a local stdio process that expects a static API token in environment config. That works for local editors but not for hosted MCP clients like ChatGPT custom connectors.

This gateway solves that by:

- Running as a Cloudflare Worker accessible from any MCP client
- Collecting the user's Todoist API token during an OAuth consent flow
- Encrypting the token with AES-GCM and carrying it inside signed JWT artifacts
- Storing nothing server-side: no KV, Durable Objects, R2, DB, or session cache

## Quick start

```bash
npm install
npm run dev
```

## Features

- MCP Streamable HTTP at `/mcp`
- OAuth Authorization Code + PKCE S256
- Dynamic client registration for public clients
- Stateless auth: encrypted Todoist token travels inside JWT artifacts
- Full CORS support for browser-based MCP clients
- 30+ Todoist tools covering tasks, projects, sections, comments, labels
- Scope enforcement at tool invocation time (`todoist.read` / `todoist.write`)

## OAuth flow

1. Client discovers OAuth metadata at `GET /.well-known/oauth-authorization-server`
2. Client registers its redirect URI at `POST /register`
3. User is redirected to `GET /authorize` and sees a consent form
4. User pastes their Todoist API token (from **Todoist → Settings → Integrations → Developer**)
5. Gateway validates the token against Todoist, encrypts it with AES-GCM, and issues a signed JWT auth code
6. Client exchanges the auth code at `POST /token`
7. Client calls `/mcp` with the bearer token; the Worker verifies the JWT, decrypts the Todoist config, and serves MCP requests

`tools/list` is always returned for connector compatibility, but tool calls are enforced at invocation time based on the token's granted scope.

## Todoist token security

- The raw Todoist token is never stored server-side
- Never placed in plaintext JWT claims, URLs, hidden form fields, logs, or error messages
- Encrypted with AES-GCM; AAD binds the ciphertext to issuer, resource, client ID, token type, scope, and config version
- Users can revoke the token in Todoist settings at any time

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info |
| GET | `/health` | Health check |
| GET | `/.well-known/oauth-authorization-server` | OAuth metadata |
| GET | `/.well-known/oauth-protected-resource` | Protected resource metadata |
| GET | `/.well-known/oauth-protected-resource/mcp` | Protected resource metadata for `/mcp` |
| POST | `/register` | Dynamic client registration |
| GET | `/authorize` | Render consent form |
| POST | `/authorize` | Submit consent form |
| POST | `/token` | Token exchange |
| GET/POST/DELETE | `/mcp` | MCP Streamable HTTP |
| OPTIONS | `*` | CORS preflight |

## Configuration

### Non-secret config (`wrangler.toml`)

```toml
name = "todoist-mcp-gateway"
main = "src/index.ts"
compatibility_date = "2026-04-30"

[vars]
OAUTH_ISSUER = "https://todoist-mcp-gateway.<your-subdomain>.workers.dev"
MCP_RESOURCE = "https://todoist-mcp-gateway.<your-subdomain>.workers.dev/mcp"
MCP_AUDIENCE = "https://todoist-mcp-gateway.<your-subdomain>.workers.dev/mcp"
OAUTH_REDIRECT_HTTPS_HOSTS = "chatgpt.com,*.chatgpt.com,github.com,*.github.com,claude.ai,*.claude.ai,anthropic.com,*.anthropic.com,localhost"
ACCESS_TOKEN_TTL_SECONDS = "43200"
AUTH_CODE_TTL_SECONDS = "120"
REFRESH_TOKEN_TTL_SECONDS = "2592000"
ENABLE_REFRESH_TOKENS = "true"
```

### Required secrets

Generate and set three base64-encoded 32-byte keys:

```bash
# Generate
openssl rand -base64 32  # → OAUTH_JWT_SIGNING_KEY_B64
openssl rand -base64 32  # → UPSTREAM_CONFIG_ENC_KEY_B64
openssl rand -base64 32  # → CSRF_SIGNING_KEY_B64

# Set
wrangler secret put OAUTH_JWT_SIGNING_KEY_B64
wrangler secret put UPSTREAM_CONFIG_ENC_KEY_B64
wrangler secret put CSRF_SIGNING_KEY_B64
```

## Deploy

### CI/CD (GitHub Actions)

Every push to `main` triggers the deploy workflow (`.github/workflows/deploy.yml`):

1. **check** — `npm run typecheck` + `npm test`
2. **deploy** — auto-initializes missing Worker secrets, then `wrangler deploy`

Required GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN` — Cloudflare API token with Workers permissions
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID

Worker secrets are auto-generated on first deploy, so a fresh Worker can be created from scratch without manual secret setup.

### Manual deploy

```bash
npm run deploy
```

## ChatGPT connector setup

In ChatGPT, add a custom MCP connector with:

```text
MCP Server URL:       https://<your-worker>/mcp
Auth server base URL: https://<your-worker>
Resource:             https://<your-worker>/mcp
```

## Tool coverage

| Category | Tools |
|----------|-------|
| Tasks | list, filter, completed, create, get, update, close, reopen, delete, move |
| Projects | list, create, get, update, delete, collaborators, move |
| Sections | list, create, get, update, delete |
| Comments | list, create, get, update, delete |
| Labels | list, create, get, update, delete, shared label ops |
| Utils | color lookup |
| Prompts | `projects_list` |

Read lookups support case-insensitive substring matching. Mutation and destructive operations require an id, an exact case-insensitive name match, or a unique substring match; ambiguous matches fail safely.

For `update_projects`, `update_sections`, and `update_labels`, name-targeted mutations use explicit selector fields (`project_name`, `section_name`, `label_name`) so the payload `name` field can safely rename the resource.

## Local development

```bash
npm install
npm run dev
```

For local development, set loopback HTTP values for `OAUTH_ISSUER`, `MCP_RESOURCE`, and `MCP_AUDIENCE` (e.g. `http://localhost:8787` and `http://localhost:8787/mcp`). Production values must be HTTPS.

Create a `.dev.vars` file for local secrets:

```text
OAUTH_JWT_SIGNING_KEY_B64=<base64>
UPSTREAM_CONFIG_ENC_KEY_B64=<base64>
CSRF_SIGNING_KEY_B64=<base64>
```

## Testing

```bash
npm run typecheck   # Type check
npm test            # Run tests
npm run check       # Both
```

## Smoke test checklist

1. `GET /health` returns `{"ok": true}`
2. `GET /.well-known/oauth-authorization-server` returns valid metadata
3. `POST /register` with a ChatGPT redirect URI returns a client ID
4. `GET /authorize` renders the consent form
5. Complete the flow with a valid Todoist developer token
6. Exchange the code at `POST /token`
7. Call `POST /mcp` with the bearer token and confirm `tools/list` returns tools

## Stateless limitations

- Auth codes cannot be strictly one-time-use without server-side state
- Refresh tokens cannot be revoked or globally rotated without state
- In-memory rate limiting on Workers is best-effort only
- JWT size grows with the encrypted config payload
- Key rotation requires accepting old keys during transition or forcing users to reconnect
- Users should revoke their Todoist token in Todoist settings if they want to disconnect

## Repository layout

```text
src/
  index.ts          Route dispatch and CORS
  config.ts         Environment parsing and validation
  oauth/            OAuth discovery, registration, authorize, token, PKCE
  security/         AES-GCM crypto, CSRF, JWT, redaction, validators
  todoist/          Typed Todoist API client, schemas, lookup
  mcp/              MCP server factory, tool registration, prompts
tests/              Vitest unit tests with mocked fetch
docs/               ADRs, engineering plan, security model, operations
```

## License

MIT
