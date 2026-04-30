# Engineering Plan

## System Overview

`todoist-mcp-gateway` is a stateless Cloudflare Worker that combines three responsibilities:

1. OAuth authorization server for MCP clients.
2. Protected resource server for `/mcp`.
3. Worker-native Todoist MCP implementation.

The Worker does not spawn a stdio server. Instead, it ports the Todoist API semantics into request-local TypeScript modules and exposes them through an MCP server built with `@modelcontextprotocol/sdk`.

## Repository Structure

- `src/index.ts`: request routing and top-level error handling.
- `src/config.ts`: environment parsing and validation.
- `src/oauth/*`: discovery, registration, authorize, token, PKCE, and request validation.
- `src/security/*`: crypto, CSRF, JWT verification/signing, redaction, shared validators.
- `src/todoist/*`: Worker-compatible Todoist client, static color data, schemas, lookup helpers, shared types.
- `src/mcp/*`: MCP server construction, tools, prompts, and shared result helpers.
- `tests/*`: unit/integration-style tests with mocked `fetch`.
- `docs/*`: product, architecture, task tracking, checklists, security model, operations, ADRs, and implementation log.

## OAuth Flow

1. Client fetches authorization server metadata.
2. Client registers redirect URI at `/register`.
3. `/authorize` GET validates `response_type`, `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method`, optional `resource`, and optional `scope`.
4. Worker renders consent form with visible Todoist token field and signed CSRF token.
5. `/authorize` POST validates CSRF and OAuth parameters, validates the Todoist token against `GET /rest/v2/projects`, encrypts the Todoist config, and issues a signed auth code artifact.
6. `/token` verifies the auth code + PKCE verifier, decrypts the Todoist config, re-encrypts it for access/refresh token purpose binding, and returns bearer tokens.

## MCP Flow

1. Client calls `/mcp` with bearer token.
2. Worker verifies JWT issuer/audience/type.
3. Worker decrypts Todoist config using AES-GCM AAD bound to the access token context.
4. Worker builds a fresh `TodoistClient` and `McpServer` instance for the request.
5. Worker registers Todoist tools and prompts.
6. Tool handlers enforce `todoist.read` vs `todoist.write` at invocation time while leaving `tools/list` unchanged for connector compatibility.
7. Worker handles the request through `WebStandardStreamableHTTPServerTransport`.

The current implementation uses JSON responses for request/response compatibility and keeps the MCP server request-local.

## Todoist Integration

- REST base: `https://api.todoist.com/rest/v2`
- Sync base: `https://api.todoist.com/sync/v9`
- Native `fetch` only.
- `Authorization: Bearer <todoist token>` plus `X-Request-Id` on outbound calls.
- Case-insensitive substring lookup for name-based task/project/section/label matching.
- Read lookups keep substring convenience, while mutation/destructive lookups require id, an exact case-insensitive name match, or a unique substring match.
- Sync API is used for move operations where batch command semantics fit better.

## Token and Encryption Model

- Auth code, access token, and refresh token are signed JWT artifacts.
- Todoist config is encrypted with AES-GCM and stored in `enc_config`.
- AAD binds encrypted config to:
  - issuer
  - resource
  - client ID
  - token type
  - scope
  - config version
- Access/refresh token issuance decrypts the auth code config and re-encrypts it for the new token purpose.

## Testing Strategy

- `vitest` unit tests for config parsing, metadata, registration, authorize, token, crypto, MCP auth, Todoist client, tool registration/behavior, and prompt behavior.
- Mocked `fetch` for Todoist and Worker-boundary tests.
- `npm run typecheck` for strict TS validation.
- `npm run check` as required baseline.

## Deployment Strategy

- GitHub Actions CI/CD pipeline at `.github/workflows/deploy.yml`.
- Every push to `main` runs `npm run typecheck` and `npm test` before deploying.
- Deploy job auto-initializes missing Worker secrets with random 32-byte keys on first deploy.
- Required GitHub repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- Keep non-secret values in `wrangler.toml`.
- Use HTTPS issuer/resource values in production.
- Manual deploy also available via `npm run deploy`.
- Perform manual smoke tests after deployment, especially OAuth + ChatGPT connector flow.

## Implementation Phases

1. Repository setup and documentation baseline.
2. OAuth discovery and registration.
3. Stateless authorize + token exchange.
4. MCP endpoint auth and transport.
5. Todoist client and tools.
6. Test coverage and documentation.
7. Deployment prep and smoke testing.
8. Review/refine loop driven by docs and checklists.

## Review/Refine Workflow

For each future substantial change:

1. Pick one coherent phase from `docs/tasks.md`.
2. Check relevant items in `docs/checklists.md`.
3. Confirm the change still matches ADRs.
4. Inspect current implementation before modifying it.
5. Implement one focused reviewable change set.
6. Self-review against PRD, ADRs, tasks, security model, and checklists.
7. Update docs and implementation log if behavior or decisions changed.
8. Run `npm run typecheck` and relevant tests; run `npm run check` before declaring the phase complete.

## Risks and Open Questions

- Real client interoperability still needs post-deploy validation with ChatGPT.
- Stateless refresh tokens remain non-revocable by design.
- Key rotation is documented but not fully implemented beyond replacing secrets and reconnecting clients.
- The current MCP transport path is unit-tested but not yet proven against a live deployed connector.
