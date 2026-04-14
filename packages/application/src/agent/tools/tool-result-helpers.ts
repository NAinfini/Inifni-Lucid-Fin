import type { ToolResult } from '../tool-registry.js';

export function ok(data?: unknown): ToolResult {
  return data === undefined ? { success: true } : { success: true, data };
}

export function fail(error: unknown): ToolResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

export function requireNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}

export function requireStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${key} must be a non-empty array`);
  }
  return Array.from(
    new Set(
      value.map((entry, index) => {
        if (typeof entry !== 'string' || entry.trim().length === 0) {
          throw new Error(`${key}[${index}] must be a non-empty string`);
        }
        return entry.trim();
      }),
    ),
  );
}

export function requireText(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') {
    throw new Error(`${key} is required`);
  }
  return value;
}

export function requireBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Tool Safety Framework: `set` pattern helpers
// ---------------------------------------------------------------------------

/** Keys that are structural identifiers and always stay top-level (never belong in `set`). */
const STRUCTURAL_KEYS = new Set([
  'set', 'canvasId', 'nodeId', 'nodeIds', 'id', 'ids',
  'episodeId', 'seriesId', 'snapshotId',
  'code', 'presetId', 'templateId', 'workflowId',
  'edgeId', 'edgeIds', 'entryId', 'category',
  'group', 'action', 'slot', 'providerId',
]);

/**
 * Extract the `set` object from tool args.
 *
 * All UPDATE mutation tools require callers to wrap their intended changes
 * inside `set: { ... }`. Only fields present inside `set` are applied —
 * this prevents LLMs from accidentally overwriting data by sending all
 * schema fields with default/zero values.
 *
 * Throws if `set` is missing, not a plain object, or empty.
 */
export function extractSet(args: Record<string, unknown>): Record<string, unknown> {
  const raw = args.set;
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('"set" object is required — wrap the fields you want to change inside set: { ... }');
  }
  const set = raw as Record<string, unknown>;
  if (Object.keys(set).length === 0) {
    throw new Error('"set" must contain at least one field to update');
  }
  return set;
}

/**
 * Detect data fields that were placed outside `set` (likely an LLM mistake).
 * Returns a warnings array to include in the tool result so the LLM can
 * self-correct in subsequent calls.
 */
export function warnExtraKeys(args: Record<string, unknown>): string[] {
  const extra = Object.keys(args).filter((k) => !STRUCTURAL_KEYS.has(k));
  if (extra.length === 0) return [];
  return [`Fields outside "set" were ignored: ${extra.join(', ')}`];
}
