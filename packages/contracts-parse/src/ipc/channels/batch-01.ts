/**
 * settings + script channels — Batch 1.
 *
 * settings:load/save store arbitrary key/value pairs in the settings-cache
 * db table. Request/response schemas stay permissive (Record<string, unknown>)
 * so downstream feature code can own the shape without a central type dep.
 *
 * script channels carry the fountain/fdx/plaintext script editor payload.
 */
import { z } from 'zod';
import { defineInvokeChannel } from '../../channels.js';

// ── Shared primitives ────────────────────────────────────────
const ScriptFormat = z.enum(['fountain', 'fdx', 'plaintext']);
const ParsedScene = z.record(z.string(), z.unknown());
const ScriptDocumentShape = z.object({
  id: z.string(),
  content: z.string(),
  format: z.string(),
  parsedScenes: z.array(ParsedScene),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// ── settings:load ────────────────────────────────────────────
const SettingsLoadRequest = z.object({}).strict();
const SettingsLoadResponse = z.record(z.string(), z.unknown());
export const settingsLoadChannel = defineInvokeChannel({
  channel: 'settings:load',
  request: SettingsLoadRequest,
  response: SettingsLoadResponse,
});
export type SettingsLoadRequest = z.infer<typeof SettingsLoadRequest>;
export type SettingsLoadResponse = z.infer<typeof SettingsLoadResponse>;

// ── settings:save ────────────────────────────────────────────
const SettingsSaveRequest = z.record(z.string(), z.unknown());
const SettingsSaveResponse = z.void();
export const settingsSaveChannel = defineInvokeChannel({
  channel: 'settings:save',
  request: SettingsSaveRequest,
  response: SettingsSaveResponse,
});
export type SettingsSaveRequest = z.infer<typeof SettingsSaveRequest>;
export type SettingsSaveResponse = z.infer<typeof SettingsSaveResponse>;

// ── script:parse ─────────────────────────────────────────────
const ScriptParseRequest = z.object({
  content: z.string(),
  format: ScriptFormat.optional(),
});
const ScriptParseResponse = z.array(ParsedScene);
export const scriptParseChannel = defineInvokeChannel({
  channel: 'script:parse',
  request: ScriptParseRequest,
  response: ScriptParseResponse,
});
export type ScriptParseRequest = z.infer<typeof ScriptParseRequest>;
export type ScriptParseResponse = z.infer<typeof ScriptParseResponse>;

// ── script:save ──────────────────────────────────────────────
const ScriptSaveRequest = z.object({
  content: z.string(),
  format: z.string(),
  parsedScenes: z.array(z.unknown()),
});
const ScriptSaveResponse = z.void();
export const scriptSaveChannel = defineInvokeChannel({
  channel: 'script:save',
  request: ScriptSaveRequest,
  response: ScriptSaveResponse,
});
export type ScriptSaveRequest = z.infer<typeof ScriptSaveRequest>;
export type ScriptSaveResponse = z.infer<typeof ScriptSaveResponse>;

// ── script:load ──────────────────────────────────────────────
const ScriptLoadRequest = z.object({}).strict();
const ScriptLoadResponse = ScriptDocumentShape.nullable();
export const scriptLoadChannel = defineInvokeChannel({
  channel: 'script:load',
  request: ScriptLoadRequest,
  response: ScriptLoadResponse,
});
export type ScriptLoadRequest = z.infer<typeof ScriptLoadRequest>;
export type ScriptLoadResponse = z.infer<typeof ScriptLoadResponse>;

// ── script:import ────────────────────────────────────────────
const ScriptImportRequest = z.object({
  filePath: z.string().min(1),
});
const ScriptImportResponse = ScriptDocumentShape;
export const scriptImportChannel = defineInvokeChannel({
  channel: 'script:import',
  request: ScriptImportRequest,
  response: ScriptImportResponse,
});
export type ScriptImportRequest = z.infer<typeof ScriptImportRequest>;
export type ScriptImportResponse = z.infer<typeof ScriptImportResponse>;

export const settingsChannels = [settingsLoadChannel, settingsSaveChannel] as const;
export const scriptChannels = [
  scriptParseChannel,
  scriptSaveChannel,
  scriptLoadChannel,
  scriptImportChannel,
] as const;
