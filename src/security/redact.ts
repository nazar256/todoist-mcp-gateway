const SENSITIVE_PATTERNS: Array<[RegExp, string]> = [
  [/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]'],
  [/(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]'],
  [/(token\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]'],
  [/(password\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]'],
  [/(secret\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]'],
  [/(cookie\s*[:=]\s*)[^\n]+/gi, '$1[REDACTED]'],
  [/(set-cookie\s*[:=]\s*)[^\n]+/gi, '$1[REDACTED]'],
];

export function redactText(input: string): string {
  let value = input;
  for (const [pattern, replacement] of SENSITIVE_PATTERNS) {
    value = value.replace(pattern, replacement);
  }

  value = value.replace(/[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}/g, '[REDACTED_JWT]');
  return value;
}
