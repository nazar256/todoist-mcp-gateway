# Product Requirements: Todoist MCP Gateway

## Problem

Todoist task management is useful inside LLM workflows, but the reference Todoist MCP implementation is a local stdio server that assumes a static Todoist API token in environment configuration. That model is not enough for a production-ready remote MCP endpoint that can be connected directly from ChatGPT custom MCP connectors.

This repository exists to provide a self-hosted remote MCP gateway that:

- runs on Cloudflare Workers;
- exposes MCP Streamable HTTP at `/mcp`;
- supports OAuth Authorization Code + PKCE for MCP clients;
- collects a user-provided Todoist API token during the OAuth consent step;
- stays stateless and does not store user credentials server-side.

The official or hosted Todoist MCP options are not sufficient for this repository's purpose because this project needs a reviewable self-hosted implementation with explicit Cloudflare Worker compatibility, stateless credential handling, OAuth behavior that can be inspected and adapted for ChatGPT custom connectors, and repository-level control over security/operational decisions.

## Target User

- Primary: a technical user who wants to connect their personal or team Todoist account to ChatGPT via a custom MCP connector.
- Secondary: engineers who want a standards-shaped remote MCP gateway that can also work with other MCP clients beyond ChatGPT.
- Operators: engineers deploying and maintaining the Cloudflare Worker.

## Goals

1. Let ChatGPT connect to `https://<worker>/mcp` using standards-shaped OAuth Authorization Code + PKCE.
2. Allow the user to paste a Todoist API token during consent.
3. Keep the implementation stateless: no DB, KV, Durable Objects, R2, or cache-backed correctness.
4. Expose useful Todoist MCP tools with strong validation and safe error handling.
5. Make the repository understandable, reviewable, and maintainable for future implementation/refinement work.

## Non-goals

- Upstream Todoist OAuth for v1.
- A Node.js server runtime.
- Wrapping or proxying the reference stdio MCP server.
- Server-side credential/session storage.
- Full revocation guarantees that require state.
- Arbitrary user-configurable upstream Todoist base URLs.

## User Flow

1. User adds the Worker as a custom MCP connector in ChatGPT.
2. ChatGPT discovers OAuth metadata from the Worker.
3. ChatGPT dynamically registers its redirect URI.
4. User is redirected to `/authorize`.
5. User pastes their Todoist developer token from Todoist Settings → Integrations.
6. Worker validates the Todoist token against Todoist.
7. Worker encrypts the Todoist config, embeds the encrypted envelope in a signed auth code artifact, and redirects back with `code` and `state`.
8. ChatGPT exchanges the code for a bearer token.
9. ChatGPT calls `/mcp` with the bearer token.
10. Worker verifies the token, decrypts the Todoist config, creates a request-local MCP server, and serves Todoist tools/prompts.

## Functional Requirements

- Worker routes:
  - `GET /`
  - `GET /health`
  - `GET /.well-known/oauth-authorization-server`
  - `GET /.well-known/oauth-protected-resource`
  - `GET /.well-known/oauth-protected-resource/mcp`
  - `POST /register`
  - `GET /authorize`
  - `POST /authorize`
  - `POST /token`
  - `GET|POST|DELETE /mcp`
- Public-client dynamic client registration using redirect URI allowlisting.
- OAuth Authorization Code + PKCE S256 only.
- Auth code, access token, and optional refresh token artifacts.
- Todoist tool coverage for tasks, projects, sections, comments, labels, and prompt support.
- Tests for config, OAuth, crypto, MCP auth, Todoist client, and tool behavior.

## Security Requirements

- No plaintext Todoist token in logs, URLs, hidden fields, error messages, or plaintext JWT claims.
- Strict redirect URI allowlist.
- PKCE `S256` only; reject `plain`.
- CSRF protection on consent submission.
- Signed JWT artifacts and AES-GCM encrypted Todoist config envelope.
- Worker secrets for JWT signing, AES encryption, and CSRF signing.
- Worker-compatible implementation only; no Node-only runtime assumptions.

## Success Criteria

- ChatGPT custom MCP connector can complete OAuth against the deployed Worker.
- User can successfully paste a Todoist API token and authorize.
- `/mcp` serves Todoist tools using the decrypted Todoist config from the bearer token.
- `npm run check` passes.
- Repository docs explain the product, architecture, security model, operations, and remaining gaps.

## Known Limitations

- Auth codes are signed artifacts and cannot be enforced as one-time-use without state.
- Refresh tokens cannot be revoked globally without state.
- Real deployed ChatGPT smoke-testing is still required beyond unit coverage.
- JWT size grows with embedded encrypted config.
- Key rotation requires an explicit transition plan.

## Future Work

- Real deployment smoke-test runbook and evidence capture.
- Multi-key verification during signing/encryption key rotation.
- Optional structured monitoring and rate limiting with careful stateless tradeoff analysis.
- Potential upstream Todoist OAuth if product requirements change.
- Additional MCP prompts/resources if actual user workflows need them.
