/**
 * Project-level settings — single-row key-value table for global config.
 */
import { defineTable, col } from '../../tables.js';

export const ProjectSettingsTable = defineTable('project_settings', {
  key: col<string>('key'),
  value: col<string>('value'),
  updatedAt: col<number>('updated_at'),
});
