/**
 * Preset-override table — user modifications to built-in presets plus
 * any user-created ones.
 */
import type { PresetId } from '@lucid-fin/contracts';
import { defineTable, col } from '../../tables.js';

export const PresetOverridesTable = defineTable('preset_overrides', {
  id: col<string>('id'),
  presetId: col<PresetId>('preset_id'),
  category: col<string>('category'),
  name: col<string>('name'),
  description: col<string | null>('description'),
  prompt: col<string | null>('prompt'),
  params: col<string | null>('params'),
  defaults: col<string | null>('defaults'),
  isUser: col<number>('is_user'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
});
