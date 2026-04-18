/**
 * PresetOverride DTO schema — Phase G1-2.8.
 *
 * `params` / `defaults` are kept loose (z.unknown arrays/records) so that
 * corrupt free-form preset payloads degrade only at the feature boundary —
 * the repository's job is scalar + ID sanity.
 */

import { z } from 'zod';

export const PresetOverrideSchema = z.object({
  id: z.string().min(1),
  presetId: z.string().min(1),
  category: z.string(),
  name: z.string(),
  description: z.string().default(''),
  prompt: z.string().default(''),
  params: z.array(z.unknown()).default([]),
  defaults: z.record(z.string(), z.unknown()).default({}),
  isUser: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type PresetOverrideDto = z.infer<typeof PresetOverrideSchema>;
