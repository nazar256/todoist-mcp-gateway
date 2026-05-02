import { base64UrlDecode, base64UrlEncode, toBufferSource } from './crypto';
import { HttpError } from './validators';

interface CsrfPayload {
  exp: number;
  client_id: string;
  redirect_uri: string;
  state?: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

async function importHmacKey(secret: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toBufferSource(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function createCsrfToken(secret: Uint8Array, payload: CsrfPayload): Promise<string> {
  const key = await importHmacKey(secret);
  const encodedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', key, textEncoder.encode(encodedPayload));
  return `${encodedPayload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyCsrfToken(secret: Uint8Array, token: string): Promise<CsrfPayload> {
  try {
    const [encodedPayload, encodedSignature] = token.split('.');
    if (!encodedPayload || !encodedSignature) {
      throw new HttpError(400, 'invalid_request', 'Invalid CSRF token');
    }

    const key = await importHmacKey(secret);
    const verified = await crypto.subtle.verify(
      'HMAC',
      key,
      toBufferSource(base64UrlDecode(encodedSignature)),
      textEncoder.encode(encodedPayload),
    );

    if (!verified) {
      throw new HttpError(400, 'invalid_request', 'Invalid CSRF token');
    }

    const payload = JSON.parse(textDecoder.decode(base64UrlDecode(encodedPayload))) as CsrfPayload;
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw new HttpError(400, 'invalid_request', 'Expired CSRF token');
    }

    return payload;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, 'invalid_request', 'Invalid CSRF token');
  }
}
