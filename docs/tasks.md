# Tasks

Status legend:

- `[ ]` not started
- `[x]` done
- `[~]` in progress / partially done
- `[!]` blocked or needs decision

## Phase 0: Repository setup and documentation

- [x] Create package manifest, TypeScript config, Wrangler config, and repository scaffolding.
- [x] Add baseline `AGENTS.md` repository rules.
- [x] Initialize Git repository on `main`.
- [x] Create docs baseline (`prd`, engineering plan, ADRs, tasks, checklists, security, operations, implementation log).
- [~] Keep README and docs synchronized as behavior evolves.
- [x] Pin dependency versions for reproducible builds.
- [x] Add LICENSE file.
- [x] Add `vitest.config.ts`.
- [x] Add `package.json` metadata (license, description, repository, keywords).

## Phase 1: OAuth and discovery

- [x] Implement authorization server metadata endpoint.
- [x] Implement protected resource metadata endpoints.
- [x] Implement dynamic client registration with redirect allowlist validation.
- [x] Add stateless registered-client resolution for dynamic client registration compatibility.
- [x] Implement `/authorize` GET request validation and consent form rendering.
- [x] Implement `/authorize` POST validation, CSRF handling, and Todoist token validation.
- [x] Make the `/authorize` consent form submit to an absolute same-origin URL and allow that origin in CSP so browsers do not block the Authorize button.
- [ ] Verify end-to-end with a real deployed ChatGPT connector.

## Phase 2: Token encryption and JWT artifacts

- [x] Parse and validate signing/encryption/CSRF secrets from environment.
- [x] Implement AES-GCM config envelope with AAD binding.
- [x] Issue signed auth code artifact.
- [x] Implement `/token` authorization_code exchange with PKCE verification.
- [x] Implement optional refresh token issuance and rotation.
- [x] Document stateless limitations in README and docs.
- [!] Add multi-key transition support for signing/encryption key rotation if required by operations.

## Phase 3: MCP Streamable HTTP endpoint

- [x] Protect `/mcp` with bearer token validation.
- [x] Return `WWW-Authenticate` header for invalid or missing bearer token.
- [x] Build request-local MCP server instances.
- [x] Register tools and prompts per request.
- [x] Enforce OAuth scope at tool invocation time without hiding tools from `tools/list`.
- [x] Serve requests through `WebStandardStreamableHTTPServerTransport`.
- [x] Add CORS support with OPTIONS preflight handling.
- [x] Fix issuer trailing slash to comply with RFC 8414.
- [~] Confirm behavior with a live remote MCP client after deployment.

## Phase 4: Todoist API client

- [x] Implement Worker-compatible REST client.
- [x] Implement Sync API command support.
- [x] Implement completed-task retrieval helper.
- [x] Add safe path parameter validation.
- [x] Add safe upstream error mapping.
- [ ] Run live smoke tests against a real Todoist account after deployment.

## Phase 5: Todoist tools and prompts

- [x] Implement task tools.
- [x] Implement project tools.
- [x] Implement section tools.
- [x] Implement comment tools.
- [x] Implement label tools.
- [x] Implement `utils_get_colors`.
- [x] Implement `projects_list` prompt.
- [x] Make mutation/destructive name-based targeting fail safely on ambiguity while preserving read lookup convenience.
- [x] Make `update_projects` rename semantics explicit by separating the name selector from payload `name`.
- [x] Make `update_sections` and `update_labels` rename semantics explicit by separating name selectors from payload `name`.
- [x] Return invalid tool input validation failures as `invalid_request` client errors instead of `internal_error`.
- [~] Verify tool behavior against real Todoist API responses and connector UX.

## Phase 6: Tests

- [x] Add config tests.
- [x] Add OAuth metadata/registration/authorize/token tests.
- [x] Soften `/authorize` Todoist token validation so only explicit upstream auth failures block consent.
- [x] Add crypto/redaction tests.
- [x] Add MCP auth tests.
- [x] Add Todoist client tests.
- [x] Add tool and prompt tests.
- [x] Make `npm run check` pass.
- [ ] Add optional higher-level smoke/integration tests if a stable remote test harness is introduced.

## Phase 7: Deployment and operations

- [x] Document required secrets and config.
- [x] Document local development and deploy steps.
- [x] Document ChatGPT connector setup.
- [x] Document stateless operational caveats.
- [x] Add GitHub Actions CI/CD pipeline (test + typecheck + deploy).
- [x] Auto-initialize Worker secrets on first deploy.
- [x] Bootstrap a brand-new Worker before secret initialization so first CI deploy succeeds from scratch.
- [x] Align production issuer/resource/audience URLs to the shared `xyofn8h7t.workers.dev` subdomain used in the Cloudflare account.
- [ ] Deploy to a real Worker environment.
- [ ] Capture deployed endpoint values and smoke-test evidence.

## Phase 8: Smoke testing and refinement

- [ ] Run real ChatGPT custom MCP connector authorization.
- [ ] Verify `tools/list` and representative tool calls against deployed Worker.
- [ ] Compare deployed behavior against PRD, ADRs, and checklists.
- [ ] Record refinement findings in `docs/implementation-log.md`.
- [ ] Resolve any protocol/runtime gaps found during live testing.
