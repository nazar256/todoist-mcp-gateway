# Checklists

## Repository setup checklist

- [ ] Git repository exists and primary branch is `main`.
- [ ] `package.json`, `tsconfig.json`, `wrangler.toml`, `README.md`, and `AGENTS.md` exist.
- [ ] `docs/` contains product, engineering, tasks, checklists, security, operations, implementation log, and ADRs.
- [ ] README and docs reflect the current repository state rather than aspirational-only state.

## OAuth checklist

- [ ] `/.well-known/oauth-authorization-server` returns the expected metadata.
- [ ] `/.well-known/oauth-protected-resource` and `/mcp` metadata routes return the expected resource data.
- [ ] `/register` accepts exactly one redirect URI for v1.
- [ ] Redirect URI host allowlist is enforced.
- [ ] `response_type=code` is required.
- [ ] PKCE `S256` is required and `plain` is rejected.
- [ ] `/authorize` GET validates client and redirect identity.
- [ ] `/authorize` POST validates CSRF and user-supplied Todoist token.
- [ ] `/token` validates auth code, redirect URI, client ID, PKCE, and resource.
- [ ] Refresh token behavior is documented and tested if enabled.

## Security checklist

- [ ] Todoist token never appears in plaintext JWT claims.
- [ ] Todoist token is not logged or returned in error messages.
- [ ] JWT signing key is validated to at least 32 bytes.
- [ ] AES key is validated to 16/24/32 bytes.
- [ ] AES-GCM envelope uses AAD binding.
- [ ] CSRF token is signed and expiry-checked.
- [ ] Redirect URI validation happens in both registration and authorize flows.
- [ ] Bearer token failures produce `WWW-Authenticate` metadata.
- [ ] `/mcp` tool calls and Todoist-reading prompts enforce required scope correctly.
- [ ] Read-only tokens cannot execute mutation or destructive Todoist tools.
- [ ] README and `docs/security-model.md` document stateless tradeoffs honestly.

## MCP compatibility checklist

- [ ] `/mcp` supports GET, POST, and DELETE routing.
- [ ] Missing or invalid bearer token returns 401.
- [ ] Worker creates a fresh MCP server per request.
- [ ] Tools are registered for authenticated requests.
- [ ] Prompt registration works for authenticated requests.
- [ ] MCP transport is Worker-compatible.
- [ ] At least one live connector smoke test is planned or recorded.

## Todoist tool checklist

- [ ] Task tools cover list/filter/completed/create/get/update/close/reopen/delete/move.
- [ ] Project tools cover list/create/get/update/delete/collaborators/move.
- [ ] Section tools cover list/create/get/update/delete.
- [ ] Comment tools cover list/create/get/update/delete.
- [ ] Label tools cover list/create/get/update/delete/shared label operations.
- [ ] Batch tools return per-item results.
- [ ] Destructive tools are described as destructive.
- [ ] Name-based lookup behavior is documented and case-insensitive.
- [ ] Mutation/destructive name-based targeting fails safely on ambiguity.

## Testing checklist

- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run check` passes.
- [ ] Tests cover config validation.
- [ ] Tests cover OAuth metadata, registration, authorize, and token flows.
- [ ] Tests cover crypto and redaction.
- [ ] Tests cover MCP auth and representative tool behavior.
- [ ] Tests cover Todoist client behavior and error mapping.

## Deployment checklist

- [ ] Wrangler secrets are generated and set (or auto-initialized by CI).
- [ ] Production issuer/resource/audience values are HTTPS.
- [ ] Deployment command is documented.
- [ ] ChatGPT connector values are documented.
- [ ] Smoke test steps are documented.
- [ ] Key rotation and user revocation guidance are documented.
- [ ] GitHub Actions CI/CD pipeline runs `npm run typecheck` and `npm test` before deploy.
- [ ] CI auto-initializes missing Worker secrets on first deploy, including the brand-new Worker bootstrap case.
- [ ] GitHub repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are configured.

## Final review checklist

- [ ] Code matches PRD goals and non-goals.
- [ ] Code still matches accepted ADRs.
- [ ] `docs/tasks.md` reflects the actual state.
- [ ] `docs/implementation-log.md` records meaningful progress and open questions.
- [ ] README is not drifting from implementation.
- [ ] No Node-only APIs were added.
- [ ] No stateful storage was introduced without a new ADR.
- [ ] No secrets are exposed in docs, tests, or code paths.
