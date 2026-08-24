/**
 * Canvas DTO — Phase G1-2.5.
 *
 * Mirrors the `Canvas` interface from contracts. The nested CanvasNode /
 * CanvasEdge / CanvasViewport / CanvasNote shapes are type-complex and
 * evolve independently of storage; keeping them as `z.unknown()` / loose
 * object shapes keeps this DTO from drifting against renderer state.
 * `parseOrDegrade` still gates the top-level row structure (corrupt
 * id/name/createdAt/updatedAt still surface as degraded reads).
 */

import { z } from 'zod';
import { ResolutionPolicySchema } from './resolution.js';
import { CanvasVisualStylePolicySchema } from './visual-style.js';
import { OrderedDeliverySequenceSchema } from './ordered-delivery.js';

export const CanvasViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
});

export const CanvasAspectRatioSchema = z.enum(['16:9', '9:16', '1:1', '2.39:1']);

export const CanvasResolutionSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const CanvasSettingsSchema = z
  .object({
    visualStylePolicy: CanvasVisualStylePolicySchema.optional(),
    stylePlate: z.string().min(1).optional(),
    negativePrompt: z.string().min(1).optional(),
    refResolution: CanvasResolutionSchema.optional(),
    publishImageResolution: CanvasResolutionSchema.optional(),
    publishVideoResolution: CanvasResolutionSchema.optional(),
    resolutionPolicy: ResolutionPolicySchema.optional(),
    aspectRatio: CanvasAspectRatioSchema.optional(),
    llmProviderId: z.string().min(1).optional(),
    imageProviderId: z.string().min(1).optional(),
    videoProviderId: z.string().min(1).optional(),
    audioProviderId: z.string().min(1).optional(),
  })
  .strict();

export type CanvasSettingsDto = z.infer<typeof CanvasSettingsSchema>;

export const CanvasSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  viewport: CanvasViewportSchema,
  notes: z.array(z.unknown()),
  settings: CanvasSettingsSchema.optional(),
  deliverySequence: OrderedDeliverySequenceSchema.optional(),
  archivedAt: z.number().int().nonnegative().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type CanvasDto = z.infer<typeof CanvasSchema>;
