import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { HttpError } from './validators';

export async function signJwt<T extends Record<string, unknown>>(
  claims: T,
  secret: Uint8Array,
  headerType: string,
): Promise<string> {
  return new SignJWT(claims as JWTPayload)
    .setProtectedHeader({ alg: 'HS256', typ: headerType })
    .sign(secret);
}

export async function verifyJwt<T extends JWTPayload & { typ?: string }>(
  token: string,
  secret: Uint8Array,
  issuer: string,
  audience: string,
  payloadType: string,
): Promise<T> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer,
      audience,
    });

    if (payload.typ !== payloadType) {
      throw new HttpError(401, 'invalid_token', 'Token type is invalid');
    }

    return payload as T;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(401, 'invalid_token', 'Token verification failed');
  }
}
