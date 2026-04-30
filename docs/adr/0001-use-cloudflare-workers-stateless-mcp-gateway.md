# ADR 0001: Use Cloudflare Workers for a stateless MCP gateway

## Status

Accepted

## Context

The project needs a remotely reachable MCP server for ChatGPT custom connectors. The original Todoist MCP reference is a local stdio implementation, which is not suitable for the target deployment and OAuth flow. The design also explicitly requires no server-side storage of Todoist tokens, OAuth sessions, auth codes, or refresh tokens.

## Decision

Use Cloudflare Workers as the runtime and keep the gateway stateless.

The Worker is responsible for:

- OAuth discovery and authorization/token endpoints
- protected resource metadata
- `/mcp` request handling
- request-local Todoist API access

No DB, KV, Durable Objects, R2, or cache-backed correctness is used.

## Alternatives Considered

### Traditional server with database

- Pros: easier session storage, revocation, one-time auth code semantics.
- Rejected because it adds persistence, infrastructure overhead, and diverges from the stated stateless requirement.

### KV / Durable Objects

- Pros: could support revocation, replay prevention, shared rate limiting.
- Rejected for v1 because the architecture explicitly forbids state-backed correctness and aims to stay isolate-safe and stateless.

### Wrapping the stdio MCP server

- Pros: quicker reuse of tool behavior.
- Rejected because the project must be a Worker-native remote gateway, not a stdio proxy, and because stdio/Node assumptions do not fit the target runtime.

## Consequences

- Deployment is simple and edge-friendly.
- The code must stay strictly Worker-compatible.
- All trust/authorization state must be carried in signed/encrypted artifacts.
- Request handling creates fresh MCP server instances rather than long-lived in-memory sessions.

## Risks

- Some OAuth and revocation properties are weaker without state.
- Live client compatibility must be validated carefully because the server is stateless and request-local.
- Future features like global revocation or authoritative rate limiting would require a new ADR and architecture change.
