import { base64UrlEncode } from '../security/crypto';

const textEncoder = new TextEncoder();

export async function createS256CodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}
