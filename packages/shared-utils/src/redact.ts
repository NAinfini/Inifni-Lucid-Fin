/**
 * Redaction utilities for preventing API key / secret leakage in logs,
 * error payloads, and crash reports.
 *
 * ---- Redaction Field Matrix ----
 *
 * | Field Pattern (case-insensitive)             | Contexts                        |
 * |----------------------------------------------|---------------------------------|
 * | apikey, api_key, api-key                     | All sinks (log, IPC, crash)     |
 * | authorization                                | All sinks                       |
 * | x-api-key                                    | All sinks                       |
 * | ocp-apim-subscription-key                    | All sinks                       |
 * | secret                                       | All sinks                       |
 * | token, accesstoken, refreshtoken             | All sinks                       |
 * | password, credential                         | All sinks                       |
 * | bearer                                       | All sinks                       |
 *
 * | String Pattern                               | Contexts                        |
 * |----------------------------------------------|---------------------------------|
 * | sk-<alphanum 20+>                            | All sinks (string redaction)    |
 * | key-<alphanum 20+>                           | All sinks (string redaction)    |
 * | Bearer <token>                               | All sinks (string redaction)    |
 * | ghp_, gho_, ghs_, ghr_ (GitHub tokens)      | All sinks (string redaction)    |
 * | xox[bpras]-<token> (Slack tokens)            | All sinks (string redaction)    |
 * | AKIA<alphanum> (AWS access keys)             | All sinks (string redaction)    |
 * | AIza<alphanum> (Google API keys)             | All sinks (string redaction)    |
 */

const REDACTED = '[REDACTED]';

/**
 * Key names (lowercased) whose values are always redacted when found as
 * object keys. Kept in sync with logger.ts SENSITIVE_KEYS.
 */
const SENSITIVE_KEYS = new Set([
  'apikey',
  'api_key',
  'api-key',
  'authorization',
  'password',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'x-api-key',
  'ocp-apim-subscription-key',
  'credential',
  'bearer',
]);

/**
 * Patterns that match common API key / token formats in free-text strings.
 * Each match is replaced with a redacted version that preserves the prefix
 * for debugging (e.g. `sk-***`).
 */
const STRING_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // OpenAI-style: sk-<alphanum 20+>  or  sk-proj-<alphanum 20+>
  { pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: 'sk-***' },
  // Generic key-prefixed: key-<alphanum 20+>
  { pattern: /\bkey-[A-Za-z0-9_-]{20,}\b/g, replacement: 'key-***' },
  // Bearer tokens in string values
  { pattern: /\bBearer\s+[A-Za-z0-9_.+/=-]{10,}\b/gi, replacement: `Bearer ${REDACTED}` },
  // GitHub tokens
  { pattern: /\b(ghp_|gho_|ghs_|ghr_)[A-Za-z0-9_]{20,}\b/g, replacement: '$1***' },
  // Slack tokens
  { pattern: /\bxox[bpras]-[A-Za-z0-9-]{10,}\b/g, replacement: 'xox?-***' },
  // AWS access keys
  { pattern: /\bAKIA[A-Z0-9]{16}\b/g, replacement: 'AKIA***' },
  // Google API keys
  { pattern: /\bAIza[A-Za-z0-9_-]{30,}\b/g, replacement: 'AIza***' },
];

/**
 * Recursively walk an object and redact any values whose keys match
 * sensitive patterns, and any string values that contain API key patterns.
 *
 * Returns a deep clone with redacted values — the original is never mutated.
 */
export function redactSensitive(value: unknown, seen?: WeakSet<object>): unknown {
  if (value == null) return value;

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitive(entry, seen));
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  const seenSet = seen ?? new WeakSet<object>();
  if (seenSet.has(value)) {
    return '[Circular]';
  }
  seenSet.add(value);

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = REDACTED;
      continue;
    }
    sanitized[key] = redactSensitive(entry, seenSet);
  }
  return sanitized;
}

/**
 * Redact any API key patterns found in a free-text string.
 * Returns the string with matches replaced by safe placeholders.
 */
export function redactString(str: string): string {
  let result = str;
  for (const { pattern, replacement } of STRING_PATTERNS) {
    // Reset lastIndex since we reuse RegExp objects with /g flag
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Check whether a given key name is considered sensitive.
 * Useful for external code that needs to align with the redaction policy.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}
