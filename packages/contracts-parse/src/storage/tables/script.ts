/**
 * Script + dependency tables.
 */
import { defineTable, col } from '../../tables.js';

export const ScriptsTable = defineTable('scripts', {
  id: col<string>('id'),
  content: col<string>('content'),
  format: col<string>('format'),
  parsedScenes: col<string>('parsed_scenes'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
});

export const DependenciesTable = defineTable('dependencies', {
  sourceType: col<string>('source_type'),
  sourceId: col<string>('source_id'),
  targetType: col<string>('target_type'),
  targetId: col<string>('target_id'),
});
