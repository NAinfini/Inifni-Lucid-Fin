/**
 * Shared type for the chunked PRESET_TEMPLATE_LIBRARY split.
 * Each templates-*.ts file exports a Record<string, PresetTemplateEntry>
 * fragment; library.ts merges them into the final frozen table.
 */
import type { PresetPromptParamDef } from './core.js';

export interface PresetTemplateEntry {
  template: string;
  paramDefs: PresetPromptParamDef[];
  conflictGroup?: string;
}
