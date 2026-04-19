/**
 * Asset-domain table constants.
 *
 * Runtime values — pair each column with its SQL name and phantom TS
 * type so repositories can compose typed queries without literal column
 * strings leaking into SQL builders.
 */
import type { AssetHash } from '@lucid-fin/contracts';
import { defineTable, col } from '../../tables.js';

export const AssetsTable = defineTable('assets', {
  hash: col<AssetHash>('hash'),
  type: col<string>('type'),
  format: col<string>('format'),
  tags: col<string | null>('tags'),
  prompt: col<string | null>('prompt'),
  provider: col<string | null>('provider'),
  folderId: col<string | null>('folder_id'),
  createdAt: col<number>('created_at'),
  fileSize: col<number | null>('file_size'),
  width: col<number | null>('width'),
  height: col<number | null>('height'),
  duration: col<number | null>('duration'),
});

export const AssetEmbeddingsTable = defineTable('asset_embeddings', {
  hash: col<AssetHash>('hash'),
  description: col<string>('description'),
  tokens: col<string>('tokens'),
  model: col<string>('model'),
  createdAt: col<number>('created_at'),
});
