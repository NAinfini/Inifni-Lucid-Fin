import type { ToolResult, ToolErrorClass } from '../tool-registry.js';

/**
 * Error subclass that lets validator helpers throw with a typed error class.
 * Tools catching these (via the outer try/catch) can propagate the class
 * to the executor without keyword-sniffing the message.
 */
export class TypedToolError extends Error {
  readonly errorClass: ToolErrorClass;
  constructor(message: string, errorClass: ToolErrorClass) {
    super(message);
    this.name = 'TypedToolError';
    this.errorClass = errorClass;
  }
}

export function ok(data?: unknown): ToolResult {
  return data === undefined ? { success: true } : { success: true, data };
}

export function fail(error: unknown, errorClass?: ToolErrorClass): ToolResult {
  // Prefer a TypedToolError's own class over the caller-supplied one so the
  // throw site wins — it has the most local information about why.
  const classFromError = error instanceof TypedToolError ? error.errorClass : undefined;
  const finalClass = classFromError ?? errorClass;
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
    ...(finalClass !== undefined && { errorClass: finalClass }),
  };
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypedToolError(`${key} is required`, 'validation');
  }
  return value.trim();
}

/**
 * Canonical validation-error message shape for tool calls.
 *
 * Format:
 *   `<toolName>: "<param>" <constraint>. You called it with: <args json>.[ <alternative>]`
 *
 * The args JSON is truncated at 400 chars so the message stays short even
 * when the LLM sent a big payload. The alternative is an optional pointer
 * to a sibling tool ("canvas.addNode may be simpler.") — include when it
 * genuinely helps the model recover on the next call; omit otherwise.
 *
 * The echo-back of the model's own args is the most important part of the
 * message: study data shows the LLM recovers on the first retry once it
 * sees what it actually sent.
 */
export function formatValidationError(
  toolName: string,
  param: string,
  constraint: string,
  args: unknown,
  alternative?: string,
): string {
  let argsJson: string;
  try {
    argsJson = JSON.stringify(args ?? {});
  } catch {
    argsJson = '<unserializable>';
  }
  if (argsJson.length > 400) {
    argsJson = argsJson.slice(0, 397) + '...';
  }
  const base = `${toolName}: "${param}" ${constraint}. You called it with: ${argsJson}.`;
  return alternative ? `${base} ${alternative}` : base;
}

/**
 * Validate a field from a `set` payload. Unlike requireString (which reads
 * the top-level args object), this validates `set.<key>` by label so error
 * messages say `set.name must be a non-empty string` rather than
 * `name is required`. Returns the trimmed string or throws a typed
 * validation error.
 */
export function requireSetString(
  set: Record<string, unknown>,
  key: string,
): string {
  const value = set[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypedToolError(`set.${key} must be a non-empty string`, 'validation');
  }
  return value.trim();
}

export function requireNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypedToolError(`${key} must be a finite number`, 'validation');
  }
  return value;
}

export function requireStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypedToolError(`${key} must be a non-empty array`, 'validation');
  }
  return Array.from(
    new Set(
      value.map((entry, index) => {
        if (typeof entry !== 'string' || entry.trim().length === 0) {
          throw new TypedToolError(`${key}[${index}] must be a non-empty string`, 'validation');
        }
        return entry.trim();
      }),
    ),
  );
}

export function requireText(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') {
    throw new TypedToolError(`${key} is required`, 'validation');
  }
  return value;
}

export function requireBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (typeof value !== 'boolean') {
    throw new TypedToolError(`${key} must be a boolean`, 'validation');
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
