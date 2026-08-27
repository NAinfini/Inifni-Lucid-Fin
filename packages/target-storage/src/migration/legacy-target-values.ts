export function legacyTargetSafeInteger(value: unknown): number | null {
  const parsed =
    typeof value === 'bigint'
      ? value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
        ? Number(value)
        : Number.NaN
      : value;
  return typeof parsed === 'number' && Number.isSafeInteger(parsed) ? parsed : null;
}

export function legacyTargetInteger(value: unknown, label: string): number {
  const parsed = legacyTargetSafeInteger(value);
  if (parsed === null) throw new TypeError(`${label} must be a safe integer`);
  return parsed;
}

export function legacyTargetOptionalInteger(value: unknown, label: string): number | null {
  return value === null || value === undefined ? null : legacyTargetInteger(value, label);
}

export function legacyTargetText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be non-empty text`);
  }
  return value.trim();
}

export function legacyTargetMessageText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200_000) {
    throw new TypeError(`${label} must be 1..200000 exact text characters`);
  }
  return value;
}

export function legacyTargetOptionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function legacyTargetTimestampMilliseconds(value: unknown): number | null {
  const milliseconds =
    typeof value === 'string' && Number.isNaN(Number(value))
      ? Date.parse(value)
      : legacyTargetSafeInteger(value);
  if (milliseconds === null || !Number.isFinite(milliseconds) || milliseconds < 0) return null;
  const date = new Date(milliseconds);
  return Number.isNaN(date.valueOf()) ? null : milliseconds;
}

export function legacyTargetIsoTimestamp(value: unknown): string | null {
  const milliseconds = legacyTargetTimestampMilliseconds(value);
  return milliseconds === null ? null : new Date(milliseconds).toISOString();
}

export function legacyTargetIso(value: unknown, label: string): string {
  const parsed = legacyTargetIsoTimestamp(value);
  if (parsed === null) throw new TypeError(`${label} must be a non-negative Target timestamp`);
  return parsed;
}

export function legacyTargetOptionalIso(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : legacyTargetIso(value, label);
}
