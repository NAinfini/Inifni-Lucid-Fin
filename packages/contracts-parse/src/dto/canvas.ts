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

export const CanvasViewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number(),
});

export const CanvasSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  viewport: CanvasViewportSchema,
  notes: z.array(z.unknown()),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type CanvasDto = z.infer<typeof CanvasSchema>;
