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

const GenerationEntityRefSchema = z.object({
  entityId: z.string(),
  imageHashes: z.array(z.string()),
});

const AssetGenerationMetadataSchema = z.object({
  prompt: z.string(),
  negativePrompt: z.string().optional(),
  provider: z.string(),
  seed: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  sourceImageHash: z.string().optional(),
  characterRefs: z.array(GenerationEntityRefSchema).optional(),
  equipmentRefs: z.array(GenerationEntityRefSchema).optional(),
  locationRefs: z.array(GenerationEntityRefSchema).optional(),
  frameReferenceHashes: z.object({ first: z.string().optional(), last: z.string().optional() }).optional(),
  steps: z.number().optional(),
  cfgScale: z.number().optional(),
  scheduler: z.string().optional(),
  img2imgStrength: z.number().optional(),
  model: z.string().optional(),
  generationTimeMs: z.number().optional(),
  cost: z.number().optional(),
}).optional();

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
  generationMetadata: AssetGenerationMetadataSchema,
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
