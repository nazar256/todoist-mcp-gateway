# Implementation Log

## 2026-04-30

### Completed
- Created the initial Cloudflare Worker repository scaffold.
- Implemented config parsing, OAuth metadata, registration, authorize, token, and MCP routing.
- Implemented Worker-compatible Todoist client and MCP tools/prompts.
- Added unit test coverage and made `npm run check` pass.
- Relaxed `/authorize` Todoist token validation so temporary or non-auth upstream failures do not reject otherwise valid tokens, while explicit 401/403 rejections still show the consent-form error.
- Initialized Git on `main`.
- Added repository documentation baseline under `docs/`.
- Enforced OAuth scope at MCP tool invocation time while keeping `tools/list` connector-compatible.
- Tightened mutation/destructive name-based targeting to require id, exact match, or unique match and to fail safely on ambiguity.
- Enforced `todoist.read` scope for Todoist-reading prompts and aligned local config parsing with documented loopback HTTP issuer/resource support.
- Returned Zod-based tool input validation failures as `invalid_request` client errors instead of `internal_error`.
- Made `update_projects` use an explicit `project_name` selector so payload `name` can safely rename the matched project.
- Made `update_sections` and `update_labels` use explicit name selectors (`section_name`, `label_name`) so mutation payload `name` can safely rename the matched resource.
- Added stateless registered-client resolution for dynamic client registration by returning a non-zero `client_id_issued_at`, a `registration_access_token`, and a `registration_client_uri`, plus a read-only `GET /register/:client_id` lookup path for connector compatibility.
- Made the `/authorize` consent form post to an absolute same-origin URL and added that origin explicitly to the CSP `form-action` directive so browsers do not block the Authorize button.

### Decisions
- Use Cloudflare Workers and keep the gateway stateless.
- Collect a user-provided Todoist developer token during OAuth consent for v1.
- Use signed JWT artifacts and AES-GCM encrypted Todoist config envelopes rather than persistent token storage.
- Keep MCP server instances request-local.

### Open Questions
- Verify live ChatGPT connector interoperability against a deployed Worker.
- Decide whether key rotation needs multi-key support soon or can remain a reconnect-based operational limitation.
- Decide whether any additional operational telemetry is necessary after real-world smoke tests.

### Next Steps
- Deploy a real Worker environment with secrets set.
- Run the documented smoke tests.
- Record any runtime compatibility issues discovered during live connector testing.
- Use the tasks/checklists/ADRs as the baseline for future review/refine phases.

## 2026-04-30 (production polish pass)

### Completed
- Pinned all dependency versions in `package.json` to exact installed versions instead of `latest`.
- Fixed RFC 8414 compliance: issuer identifier no longer includes a trailing slash from `URL.toString()`.
- Added full CORS support: `OPTIONS` preflight returns 204, all JSON responses include CORS headers, MCP transport responses get CORS headers injected.
- Added `LICENSE` (MIT).
- Added `vitest.config.ts` for explicit test configuration.
- Added `package.json` metadata: `license`, `description`, `repository`, `keywords`.
- Deduplicated `toBufferSource` helper between `crypto.ts` and `csrf.ts`.
- Documented `registerScopedTool` `any` type as a pragmatic MCP SDK workaround.
- Polished `README.md` for publish readiness: route table, configuration sections, local dev guide, `.dev.vars` instructions, structured tool coverage table.
- Added GitHub Actions CI/CD pipeline: test + typecheck gate before deploy, auto-initialize Worker secrets on first deploy.
- Fixed first-run CI deploy bootstrapping: when the Worker does not exist yet, the workflow now performs an initial deploy before listing/creating Worker secrets, then runs the final deploy.
- Aligned `wrangler.toml`, tests, and operator docs to the shared Cloudflare Workers subdomain `xyofn8h7t.workers.dev` already used by sibling gateway deployments.

### Decisions
- Issuer string is now `stripOriginTrailingSlash(url)` — bare origins like `https://x.workers.dev` no longer get a trailing `/`. This matches RFC 8414 and avoids mismatch between wrangler.toml config and JWT `iss` claims.
- CORS uses `Access-Control-Allow-Origin: *` since the gateway is a public OAuth/MCP endpoint. Bearer token auth provides the actual access control.

### Open Questions
- Verify that ChatGPT connector handles the non-trailing-slash issuer correctly in practice.
