# ADR 0003: Use signed JWT artifacts and AES-GCM encrypted config

## Status

Accepted

## Context

The gateway must stay stateless while still carrying enough information for later `/token` and `/mcp` requests to succeed. That means the Worker needs a portable artifact format that supports integrity, expiry, issuer/audience checks, and encrypted upstream configuration.

## Decision

Use signed JWT artifacts for:

- auth codes
- access tokens
- refresh tokens

Store Todoist configuration inside an encrypted AES-GCM envelope placed in `enc_config`.

## What is plaintext in JWT claims

- artifact type (`typ`)
- issuer (`iss`)
- audience (`aud`)
- timing fields (`iat`, `exp`)
- unique ID (`jti`)
- `client_id`
- `redirect_uri` for auth codes
- `resource`
- `scope`
- encrypted config envelope metadata/container

## What is encrypted

- Todoist API token inside the config envelope

## AES-GCM AAD binding

The encrypted envelope is bound to contextual fields using AAD:

- issuer
- resource
- client ID
- token type
- scope
- config version

This reduces the chance of reusing the same ciphertext in the wrong token context.

## Consequences

- Stateless verification is possible on fresh Worker isolates.
- `/token` and `/mcp` can reconstruct needed Todoist config without server-side storage.
- Security depends on key management and strict validation.

## Stateless Limitations

- Auth codes cannot be guaranteed one-time-use without state.
- Refresh tokens cannot be revoked without state.
- Key rotation requires explicit handling of old/new keys or user reconnect.

## Risks

- JWT size grows because encrypted config is embedded in artifacts.
- Operational mistakes in key rotation can invalidate active sessions.
- A future need for stronger revocation guarantees would require architectural change.
