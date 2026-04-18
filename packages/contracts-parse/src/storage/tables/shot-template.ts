/**
 * Shot template table — per-user custom shot preset definitions.
 */
import type { ShotTemplateId } from '@lucid-fin/contracts';
import { defineTable, col } from '../../tables.js';

export const CustomShotTemplatesTable = defineTable('custom_shot_templates', {
  id: col<ShotTemplateId>('id'),
  name: col<string>('name'),
  description: col<string>('description'),
  tracksJson: col<string>('tracks_json'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
});
