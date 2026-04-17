/**
 * Color-style table.
 */
import { defineTable, col } from '../../tables.js';

export const ColorStylesTable = defineTable('color_styles', {
  id: col<string>('id'),
  name: col<string>('name'),
  sourceType: col<string>('source_type'),
  sourceAsset: col<string | null>('source_asset'),
  palette: col<string>('palette'),
  gradients: col<string>('gradients'),
  exposure: col<string>('exposure'),
  tags: col<string>('tags'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
});
