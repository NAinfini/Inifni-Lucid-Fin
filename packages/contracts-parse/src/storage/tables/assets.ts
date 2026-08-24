/**
 * Asset-domain table constants.
 *
 * Runtime values — pair each column with its SQL name and phantom TS
 * type so repositories can compose typed queries without literal column
 * strings leaking into SQL builders.
 */
import type { AssetHash } from '@lucid-fin/contracts';
import { defineTable, col } from '../../tables.js';

export const AssetContentsTable = defineTable('asset_contents', {
  hash: col<AssetHash>('hash'),
  type: col<string>('type'),
  format: col<string>('format'),
  prompt: col<string | null>('prompt'),
  provider: col<string | null>('provider'),
  createdAt: col<number>('created_at'),
  fileSize: col<number | null>('file_size'),
  width: col<number | null>('width'),
  height: col<number | null>('height'),
  duration: col<number | null>('duration'),
  hasAudio: col<number | null>('has_audio'),
  generationMetadata: col<string | null>('generation_metadata'),
});

export const AssetEntriesTable = defineTable('asset_entries', {
  id: col<string>('id'),
  assetHash: col<AssetHash>('asset_hash'),
  displayName: col<string>('display_name'),
  tags: col<string>('tags'),
  folderId: col<string | null>('folder_id'),
  createdAt: col<number>('created_at'),
});
