/**
 * Entity-domain DTO schemas — Phase G1-2.6.
 *
 * Kept loose for fault-soft reads: nested shapes are `unknown[]` / `unknown`
 * so that corrupt nested JSON in one row's `costumes` / `referenceImages`
 * does not fail the parse for an otherwise-valid row. Shape enforcement
 * still lives in feature code; the repo's job here is branded ID + basic
 * field-shape sanity.
 */

import { z } from 'zod';

export const ReferenceImageSchema = z.object({
  slot: z.string(),
  assetHash: z.string().optional(),
  isStandard: z.boolean().optional().default(false),
  variants: z.array(z.string()).optional(),
});

export const CharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  role: z.enum(['protagonist', 'antagonist', 'supporting', 'extra']).default('supporting'),
  description: z.string().default(''),
  appearance: z.string().default(''),
  personality: z.string().default(''),
  costumes: z.array(z.unknown()).default([]),
  tags: z.array(z.string()).default([]),
  age: z.number().optional(),
  gender: z.enum(['male', 'female', 'non-binary', 'other']).optional(),
  voice: z.string().optional(),
  face: z.unknown().optional(),
  hair: z.unknown().optional(),
  skinTone: z.string().optional(),
  body: z.unknown().optional(),
  distinctTraits: z.array(z.string()).optional(),
  vocalTraits: z.unknown().optional(),
  referenceImages: z.array(z.unknown()).default([]),
  loadouts: z.array(z.unknown()).default([]),
  defaultLoadoutId: z.string().default(''),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type CharacterDto = z.infer<typeof CharacterSchema>;

export const EquipmentSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z
    .enum(['weapon', 'armor', 'clothing', 'accessory', 'vehicle', 'tool', 'furniture', 'other'])
    .default('other'),
  subtype: z.string().optional(),
  description: z.string().default(''),
  function: z.string().optional(),
  material: z.string().optional(),
  color: z.string().optional(),
  condition: z.string().optional(),
  visualDetails: z.string().optional(),
  tags: z.array(z.string()).default([]),
  referenceImages: z.array(z.unknown()).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type EquipmentDto = z.infer<typeof EquipmentSchema>;

export const LocationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(['interior', 'exterior', 'int-ext']).optional(),
  subLocation: z.string().optional(),
  timeOfDay: z.string().optional(),
  description: z.string().default(''),
  mood: z.string().optional(),
  weather: z.string().optional(),
  lighting: z.string().optional(),
  architectureStyle: z.string().optional(),
  dominantColors: z.array(z.string()).optional(),
  keyFeatures: z.array(z.string()).optional(),
  atmosphereKeywords: z.array(z.string()).optional(),
  tags: z.array(z.string()).default([]),
  referenceImages: z.array(z.unknown()).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type LocationDto = z.infer<typeof LocationSchema>;
