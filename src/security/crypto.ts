import { canonicalize, HttpError } from './validators';

export interface EncryptedEnvelope {
  v: 1;
  alg: 'A256GCM' | 'A128GCM';
  iv: string;
  ct: string;
  kid?: string;
}

export interface EnvelopeAadContext {
  issuer: string;
  resource: string;
  client_id: string;
  token_type: 'auth_code' | 'access_token' | 'refresh_token';
  scope: string;
  config_version: 1;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function toBufferSource(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const decoded = atob(`${normalized}${padding}`);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

export function base64Decode(value: string): Uint8Array {
  const normalized = value.trim();
  const decoded = atob(normalized);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

async function importAesKey(keyBytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toBufferSource(keyBytes), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function buildAad(context: EnvelopeAadContext): Uint8Array {
  return textEncoder.encode(canonicalize(context));
}

function envelopeAlgForKey(keyBytes: Uint8Array): 'A256GCM' | 'A128GCM' {
  return keyBytes.byteLength === 16 ? 'A128GCM' : 'A256GCM';
}

export async function encryptJson(
  value: unknown,
  keyBytes: Uint8Array,
  context: EnvelopeAadContext,
): Promise<EncryptedEnvelope> {
  const key = await importAesKey(keyBytes);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toBufferSource(iv),
      additionalData: toBufferSource(buildAad(context)),
    },
    key,
    toBufferSource(textEncoder.encode(JSON.stringify(value))),
  );

  return {
    v: 1,
    alg: envelopeAlgForKey(keyBytes),
    iv: base64UrlEncode(iv),
    ct: base64UrlEncode(new Uint8Array(ciphertext)),
  };
}

export async function decryptJson<T>(
  envelope: EncryptedEnvelope,
  keyBytes: Uint8Array,
  context: EnvelopeAadContext,
): Promise<T> {
  try {
    const key = await importAesKey(keyBytes);
    const plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toBufferSource(base64UrlDecode(envelope.iv)),
        additionalData: toBufferSource(buildAad(context)),
      },
      key,
      toBufferSource(base64UrlDecode(envelope.ct)),
    );

    return JSON.parse(textDecoder.decode(plaintext)) as T;
  } catch {
    throw new HttpError(401, 'invalid_token', 'Encrypted token state could not be decrypted');
  }
}
