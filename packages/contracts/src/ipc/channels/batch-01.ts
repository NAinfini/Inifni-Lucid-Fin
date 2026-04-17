/**
 * Pure type shapes for Batch 1 (settings:* + script:*).
 *
 * No zod, no runtime. Consumed by `lucid-api.generated.ts` for typing
 * `window.lucidAPI`. Stays in sync with the zod schemas in
 * `@lucid-fin/contracts-parse` via compile-time assertion in tests.
 */

// ── settings ─────────────────────────────────────────────────
export type SettingsLoadRequest = Record<string, never>;
export type SettingsLoadResponse = Record<string, unknown>;

export type SettingsSaveRequest = Record<string, unknown>;
export type SettingsSaveResponse = void;

// ── script ───────────────────────────────────────────────────
export type ScriptFormat = 'fountain' | 'fdx' | 'plaintext';

export interface ScriptParseRequest {
  content: string;
  format?: ScriptFormat;
}
export type ScriptParseResponse = Array<Record<string, unknown>>;

export interface ScriptSaveRequest {
  content: string;
  format: string;
  parsedScenes: unknown[];
}
export type ScriptSaveResponse = void;

export type ScriptLoadRequest = Record<string, never>;
export interface ScriptDocumentShape {
  id: string;
  content: string;
  format: string;
  parsedScenes: Array<Record<string, unknown>>;
  createdAt: number;
  updatedAt: number;
}
export type ScriptLoadResponse = ScriptDocumentShape | null;

export interface ScriptImportRequest {
  filePath: string;
}
export type ScriptImportResponse = ScriptDocumentShape;
