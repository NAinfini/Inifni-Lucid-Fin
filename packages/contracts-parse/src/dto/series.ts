/**
 * Series-domain DTO schemas — Phase G1-2.7.
 *
 * `styleGuide` kept as `z.unknown()` so corrupt nested style payloads
 * degrade only at the feature boundary — the repository's job is
 * branded-ID sanity + fault-soft scalar validation.
 */

import { z } from 'zod';

export const SeriesSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string().default(''),
  styleGuide: z.unknown(),
  episodeIds: z.array(z.string()).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type SeriesDto = z.infer<typeof SeriesSchema>;

export const EpisodeSchema = z.object({
  id: z.string().min(1),
  seriesId: z.string().min(1),
  title: z.string(),
  order: z.number(),
  status: z.string().default('draft'),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type EpisodeDto = z.infer<typeof EpisodeSchema>;
