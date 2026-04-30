# ADR 0002: Use user-provided Todoist API token via OAuth consent

## Status

Accepted

## Context

The gateway needs credentials that let it call Todoist on behalf of the user. For v1, the primary goal is ChatGPT connector compatibility with minimal moving parts and no server-side persistence.

Todoist developer tokens already exist and are easy for users to obtain manually. Upstream Todoist OAuth would add more protocol complexity and product scope before the remote MCP connector behavior is proven.

## Decision

Use a user-provided Todoist developer token collected during the Worker's OAuth consent flow.

The consent form explains where to find the token:

- Todoist → Settings → Integrations → Developer token

The Worker validates the token with a Todoist API request before issuing auth artifacts.

## Why not upstream Todoist OAuth in v1

- It is not necessary to satisfy the initial remote MCP gateway objective.
- It would expand scope significantly.
- It would complicate a stateless design and introduce a second OAuth system before the first one is validated in production.

## How the token is collected

- User is redirected to `/authorize`.
- Worker renders a consent form with a single visible `todoist_api_token` field.
- User manually pastes the token.

## How the token is validated

- Worker calls `GET https://api.todoist.com/rest/v2/projects` with `Authorization: Bearer <token>`.
- Invalid tokens are rejected and the consent form is re-rendered with a safe error.

## Revocation model

- Users revoke access by revoking/regenerating the Todoist developer token in Todoist settings.
- Because the gateway is stateless, there is no server-side revoke list in v1.

## Security Implications

- The token is sensitive and must never appear in plaintext logs, URLs, hidden fields, or plaintext JWT claims.
- The token is encrypted before being embedded in auth artifacts.
- The gateway is responsible for validating and then minimizing exposure of the token.

## Limitations

- This is a v1 credential model, not a full delegated upstream OAuth integration.
- The UX relies on manual token copy/paste.
- Revocation granularity is limited to upstream Todoist token revocation.
