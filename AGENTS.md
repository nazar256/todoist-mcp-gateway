# todoist-mcp-gateway

- Runtime: Cloudflare Workers only.
- Transport: MCP Streamable HTTP at `/mcp`.
- Auth: stateless OAuth Authorization Code + PKCE with Dynamic Client Registration.
- Git: repository primary branch must be `main`, never `master`.
- Secrets: never log or persist Todoist tokens, OAuth bearer tokens, cookies, or decrypted envelopes.
- State model: no KV, Durable Objects, R2, DB, or cache-backed correctness.
- Architecture changes that introduce DB/KV/DO/state must go through a new ADR first.
- Validation: use `zod` for request boundaries and safe tool input parsing.
- Crypto: use WebCrypto-compatible primitives and `jose` only.
- Testing: prefer mocked fetch unit tests; keep code Worker-compatible and avoid Node-only APIs.
- Preserve ChatGPT custom MCP connector compatibility as the top client priority.
- Keep `docs/` updated when architecture, behavior, requirements, or operations change.
- After meaningful changes, update `docs/tasks.md` and `docs/implementation-log.md` to reflect actual state.
- Run `npm run typecheck` and relevant tests before declaring work complete; run `npm run check` before final completion of a substantial phase.
- CI/CD: GitHub Actions runs `npm run typecheck` and `npm test` on every push to `main` before deploying. Do not merge code that breaks CI.
