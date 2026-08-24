/**
 * AssetMeta DTOs — Phase G1-2.4.
 *
 * Mirrors the shapes returned by `queryAssets` / `searchAssets` /
 * Reads in `AssetRepository` go through `parseOrDegrade` with these schemas
 * so a corrupt row surfaces as degraded-read telemetry + skip, not a crash
 * in the asset browser.
 */

import { z } from 'zod';
import { ResolutionAuditSchema } from './resolution.js';
import { VisualStyleProvenanceSchema } from './visual-style.js';

const AssetTypeEnum = z.enum(['image', 'video', 'audio']);

const GenerationEntityRefSchema = z.object({
  entityId: z.string(),
  imageHashes: z.array(z.string()),
});

const AssetGenerationMetadataSchema = z
  .object({
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
    frameReferenceHashes: z
      .object({ first: z.string().optional(), last: z.string().optional() })
      .optional(),
    steps: z.number().optional(),
    cfgScale: z.number().optional(),
    scheduler: z.string().optional(),
    img2imgStrength: z.number().optional(),
    model: z.string().optional(),
    generationTimeMs: z.number().optional(),
    cost: z.number().optional(),
    taskListId: z.string().optional(),
    taskId: z.string().optional(),
    attemptId: z.string().optional(),
    promptAssemblyId: z.string().optional(),
    specHash: z.string().optional(),
    promptHash: z.string().optional(),
    referenceAssetHashes: z.array(z.string()).optional(),
    estimatedCostUsd: z.number().nonnegative().optional(),
    reportedActualCostUsd: z.number().nonnegative().optional(),
    resolution: ResolutionAuditSchema.optional(),
    visualStyle: VisualStyleProvenanceSchema.optional(),
    sourceVideoHash: z.string().optional(),
    timestampSeconds: z.number().nonnegative().optional(),
    rubricVersion: z.string().optional(),
  })
  .optional();

export const AssetMetaSchema = z.object({
  hash: z.string().min(1),
  type: AssetTypeEnum,
  format: z.string(),
  originalName: z.string(),
  fileSize: z.number().nonnegative(),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.number().optional(),
  hasAudio: z.boolean().optional(),
  prompt: z.string().optional(),
  provider: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  generationMetadata: AssetGenerationMetadataSchema,
});

export type AssetMetaDto = z.infer<typeof AssetMetaSchema>;

export const AssetEntrySchema = AssetMetaSchema.omit({ createdAt: true }).extend({
  id: z.string().min(1),
  displayName: z.string().min(1),
  tags: z.array(z.string()),
  folderId: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  contentCreatedAt: z.number().int().nonnegative(),
});

export type AssetEntryDto = z.infer<typeof AssetEntrySchema>;
