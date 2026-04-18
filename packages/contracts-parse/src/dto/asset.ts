/**
 * AssetMeta + EmbeddingRecord DTOs — Phase G1-2.4.
 *
 * Mirrors the shapes returned by `queryAssets` / `searchAssets` /
 * `queryEmbeddingByHash` in the legacy `sqlite-assets.ts`. Reads in
 * `AssetRepository` go through `parseOrDegrade` with these schemas so
 * a corrupt row surfaces as degraded-read telemetry + skip, not a
 * crash in the asset browser or embedding search flow.
 */

import { z } from 'zod';

const AssetTypeEnum = z.enum(['image', 'video', 'audio']);

export const AssetMetaSchema = z.object({
  hash: z.string().min(1),
  type: AssetTypeEnum,
  format: z.string(),
  originalName: z.string(),
  fileSize: z.number().nonnegative(),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
  prompt: z.string().optional(),
  provider: z.string().optional(),
  tags: z.array(z.string()),
  folderId: z.string().nullable().optional(),
  createdAt: z.number().int().nonnegative(),
});

export type AssetMetaDto = z.infer<typeof AssetMetaSchema>;

export const EmbeddingRecordSchema = z.object({
  hash: z.string().min(1),
  description: z.string(),
  tokens: z.array(z.string()),
  model: z.string(),
  createdAt: z.number().int().nonnegative(),
});

export type EmbeddingRecordDto = z.infer<typeof EmbeddingRecordSchema>;
