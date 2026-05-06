/**
 * Portable preset export/import utilities.
 *
 * Provides round-trip serialization between the internal `PresetDefinition`
 * format and the portable `PresetExportV1` file format. The import path
 * uses Zod for runtime validation so corrupt/malicious files are rejected
 * with actionable error messages.
 */
import { z } from 'zod';
import {
  PRESET_CATEGORIES,
  type PresetDefinition,
  type PresetExportV1,
  type ExportedPreset,
  type ImportResult,
} from '@lucid-fin/contracts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Current schema version for the portable export format. */
const CURRENT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Zod schemas (import validation)
// ---------------------------------------------------------------------------

const ExportedPresetSchema = z.object({
  name: z.string().min(1),
  category: z.enum(PRESET_CATEGORIES),
  values: z.record(z.string(), z.unknown()),
  intensity: z.number().min(0).max(100).optional(),
  tags: z.array(z.string()).optional(),
});

const PresetExportV1Schema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  exportedAt: z.string().min(1),
  appVersion: z.string().min(1),
  presets: z.array(ExportedPresetSchema),
});

/**
 * Lookahead schema that only checks `schemaVersion` to provide a clear
 * error message when the file was created by a newer app version.
 */
const SchemaVersionProbe = z.object({
  schemaVersion: z.number(),
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface ExportPresetsOptions {
  appVersion: string;
}

/**
 * Serialize an array of internal `PresetDefinition`s into the portable
 * `PresetExportV1` envelope.
 */
export function exportPresets(
  presets: PresetDefinition[],
  options: ExportPresetsOptions,
): PresetExportV1 {
  const exported: ExportedPreset[] = presets.map((p) => {
    const entry: ExportedPreset = {
      name: p.name,
      category: p.category,
      values: { ...p.defaults },
    };
    // Carry over intensity from the track entry defaults if present
    const intensity =
      typeof p.defaults.intensity === 'number' ? p.defaults.intensity : undefined;
    if (intensity !== undefined && intensity !== 100) {
      entry.intensity = intensity;
    }
    return entry;
  });

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: options.appVersion,
    presets: exported,
  };
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Validate and parse an unknown blob (typically `JSON.parse(fileContents)`)
 * into a typed `ImportResult`.
 *
 * Error handling:
 * - Non-object / null / array input -> `INVALID_FORMAT`
 * - `schemaVersion` present but > current -> `VERSION_MISMATCH`
 * - Zod structural validation failure -> `VALIDATION_ERROR`
 */
export function importPresets(data: unknown): ImportResult {
  // Gate: must be a non-null object
  if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data)) {
    return {
      ok: false,
      code: 'INVALID_FORMAT',
      message: 'Import data must be a JSON object.',
    };
  }

  // Probe schemaVersion for forward-compat check
  const versionProbe = SchemaVersionProbe.safeParse(data);
  if (versionProbe.success && versionProbe.data.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'VERSION_MISMATCH',
      message:
        `Unsupported schema version ${versionProbe.data.schemaVersion}. ` +
        `This app supports up to version ${CURRENT_SCHEMA_VERSION}. ` +
        'Please update the application to import this file.',
    };
  }

  // Full structural validation
  const result = PresetExportV1Schema.safeParse(data);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    const path = firstIssue?.path?.join('.') || '';
    const detail = firstIssue?.message || 'Unknown validation error';
    return {
      ok: false,
      code: 'VALIDATION_ERROR',
      message: path ? `Validation failed at "${path}": ${detail}` : `Validation failed: ${detail}`,
    };
  }

  return {
    ok: true,
    presets: result.data.presets,
  };
}
