export function resolveIssuerPath(issuer: string, pathname: string): string {
  const normalizedIssuer = issuer.endsWith('/') ? issuer : `${issuer}/`;
  const normalizedPath = pathname.replace(/^\/+/, '');
  return new URL(normalizedPath, normalizedIssuer).toString();
}
