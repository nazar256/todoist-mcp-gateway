import { describe, expect, it } from 'vitest';
import { encryptJson, decryptJson } from '../src/security/crypto';
import { parseConfig } from '../src/config';
import { verifyJwt, signJwt } from '../src/security/jwt';
import { redactText } from '../src/security/redact';
import { createEnv } from './helpers';

describe('security crypto', () => {
  it('AES-GCM round trip works', async () => {
    const config = parseConfig(createEnv());
    const aad = { issuer: config.issuer, resource: config.mcpResource, client_id: 'c', token_type: 'access_token' as const, scope: 'todoist.read', config_version: 1 as const };
    const envelope = await encryptJson({ hello: 'world' }, config.upstreamConfigEncryptionKey, aad);
    await expect(decryptJson<{ hello: string }>(envelope, config.upstreamConfigEncryptionKey, aad)).resolves.toEqual({ hello: 'world' });
  });

  it('wrong key fails', async () => {
    const config = parseConfig(createEnv());
    const aad = { issuer: config.issuer, resource: config.mcpResource, client_id: 'c', token_type: 'access_token' as const, scope: 'todoist.read', config_version: 1 as const };
    const envelope = await encryptJson({ hello: 'world' }, config.upstreamConfigEncryptionKey, aad);
    await expect(decryptJson(envelope, new Uint8Array(32).fill(7), aad)).rejects.toThrow(/decrypted/);
  });

  it('wrong AAD fails', async () => {
    const config = parseConfig(createEnv());
    const aad = { issuer: config.issuer, resource: config.mcpResource, client_id: 'c', token_type: 'access_token' as const, scope: 'todoist.read', config_version: 1 as const };
    const envelope = await encryptJson({ hello: 'world' }, config.upstreamConfigEncryptionKey, aad);
    await expect(decryptJson(envelope, config.upstreamConfigEncryptionKey, { ...aad, scope: 'todoist.write' })).rejects.toThrow(/decrypted/);
  });

  it('JWT wrong issuer audience fails', async () => {
    const config = parseConfig(createEnv());
    const token = await signJwt({ typ: 'todoist_mcp_access_token', iss: config.issuer, aud: config.mcpAudience, exp: Math.floor(Date.now() / 1000) + 60, iat: Math.floor(Date.now() / 1000), jti: '1' }, config.oauthJwtSigningKey, 'JWT');
    await expect(verifyJwt(token, config.oauthJwtSigningKey, 'https://other.example', config.mcpAudience, 'todoist_mcp_access_token')).rejects.toThrow(/verification failed/);
  });

  it('redaction removes authorization token api key password secret cookie like data', () => {
    const redacted = redactText('Authorization: Bearer abc token=123 api_key=xyz password=foo secret=bar cookie=session=1');
    expect(redacted).not.toContain('abc');
    expect(redacted).not.toContain('xyz');
    expect(redacted).not.toContain('foo');
    expect(redacted).not.toContain('bar');
    expect(redacted).not.toContain('session=1');
  });
});
