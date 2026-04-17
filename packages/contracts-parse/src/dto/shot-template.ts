/**
 * ShotTemplate DTO schema — Phase G1-2.9.
 *
 * `tracks` kept loose (z.record(z.unknown)) so corrupt nested preset-track
 * payloads degrade only at feature code — the repository's job is scalar
 * + branded-ID sanity.
 */

import { z } from 'zod';

export const ShotTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().default(''),
  builtIn: z.boolean().default(false),
  tracks: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.number().optional(),
});
export type ShotTemplateDto = z.infer<typeof ShotTemplateSchema>;
