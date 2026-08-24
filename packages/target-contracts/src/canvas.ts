import { z } from 'zod';
import { strictObject } from './canonical.js';
import {
  EntityIdSchema,
  IsoTimestampSchema,
  CountSchema,
  PositiveNumberSchema,
  RevisionSchema,
  Sha256Schema,
} from './primitives.js';

export const CanvasTargetSchema = z.union([
  strictObject({ targetType: z.literal('production'), targetId: EntityIdSchema }),
  strictObject({ targetType: z.literal('project_media_ref'), targetId: EntityIdSchema }),
  strictObject({ targetType: z.literal('generated_result'), targetId: EntityIdSchema }),
  strictObject({ targetType: z.literal('delivery'), targetId: EntityIdSchema }),
]);
export const CanvasTargetBindingSchema = z.union([
  strictObject({
    targetType: z.literal('production'),
    targetId: EntityIdSchema,
    targetRevision: RevisionSchema,
    targetContentHash: Sha256Schema,
  }),
  strictObject({
    targetType: z.literal('project_media_ref'),
    targetId: EntityIdSchema,
    targetRevision: RevisionSchema,
    targetContentHash: Sha256Schema,
  }),
  strictObject({
    targetType: z.literal('generated_result'),
    targetId: EntityIdSchema,
    targetRevision: RevisionSchema,
    targetContentHash: Sha256Schema,
  }),
  strictObject({
    targetType: z.literal('delivery'),
    targetId: EntityIdSchema,
    targetRevision: RevisionSchema,
    targetContentHash: Sha256Schema,
  }),
]);

export const CanvasPointSchema = strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
});
export const CanvasSizeSchema = strictObject({
  width: PositiveNumberSchema,
  height: PositiveNumberSchema,
});
export const CanvasGeometrySchema = strictObject({
  position: CanvasPointSchema,
  size: CanvasSizeSchema,
});
export const CanvasPlacementSchema = strictObject({
  id: EntityIdSchema,
  target: CanvasTargetBindingSchema,
  position: CanvasPointSchema,
  size: CanvasSizeSchema,
  zIndex: z.number().int().finite(),
  revision: RevisionSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export const CanvasGroupSchema = strictObject({
  id: EntityIdSchema,
  title: z.string().trim().min(1).max(240),
  placementIds: z.array(EntityIdSchema).max(20_000),
  revision: RevisionSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export const CanvasEdgeSchema = strictObject({
  id: EntityIdSchema,
  sourcePlacementId: EntityIdSchema,
  targetPlacementId: EntityIdSchema,
  label: z.string().max(240),
  revision: RevisionSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export const CanvasAnnotationSchema = strictObject({
  id: EntityIdSchema,
  placementId: EntityIdSchema.nullable(),
  text: z.string().trim().min(1).max(20_000),
  geometry: CanvasGeometrySchema.nullable(),
  revision: RevisionSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});
export const CanvasViewportSchema = strictObject({
  center: CanvasPointSchema,
  zoom: PositiveNumberSchema,
});
export const CanvasSavedViewSchema = strictObject({
  id: EntityIdSchema,
  name: z.string().trim().min(1).max(120),
  viewport: CanvasViewportSchema,
  revision: RevisionSchema,
  createdAt: IsoTimestampSchema,
});
export const CanvasDocumentSchema = strictObject({
  authority: z.literal('canvas'),
  id: EntityIdSchema,
  projectId: EntityIdSchema,
  revision: RevisionSchema,
  contentHash: Sha256Schema,
  placements: z.array(CanvasPlacementSchema).max(20_000),
  groups: z.array(CanvasGroupSchema).max(10_000),
  edges: z.array(CanvasEdgeSchema).max(50_000),
  annotations: z.array(CanvasAnnotationSchema).max(50_000),
  viewport: CanvasViewportSchema,
  savedViews: z.array(CanvasSavedViewSchema).max(100),
  nextZIndex: CountSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
}).superRefine((document, context) => {
  const placements = new Map(document.placements.map((placement) => [placement.id, placement]));
  const groups = new Map(document.groups.map((group) => [group.id, group]));
  const membership = new Map<string, string>();

  if (placements.size !== document.placements.length) {
    context.addIssue({ code: 'custom', path: ['placements'], message: 'Duplicate placement ID' });
  }
  if (groups.size !== document.groups.length) {
    context.addIssue({ code: 'custom', path: ['groups'], message: 'Duplicate group ID' });
  }

  for (const [groupIndex, group] of document.groups.entries()) {
    const uniqueMembers = new Set(group.placementIds);
    if (uniqueMembers.size !== group.placementIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['groups', groupIndex, 'placementIds'],
        message: 'Duplicate group member',
      });
    }
    for (const placementId of uniqueMembers) {
      if (!placements.has(placementId)) {
        context.addIssue({
          code: 'custom',
          path: ['groups', groupIndex, 'placementIds'],
          message: 'Group references an unknown placement',
        });
      }
      if (membership.has(placementId)) {
        context.addIssue({
          code: 'custom',
          path: ['groups', groupIndex, 'placementIds'],
          message: 'Placement belongs to more than one group',
        });
      }
      membership.set(placementId, group.id);
    }
  }

  for (const [edgeIndex, edge] of document.edges.entries()) {
    if (
      edge.sourcePlacementId === edge.targetPlacementId ||
      !placements.has(edge.sourcePlacementId) ||
      !placements.has(edge.targetPlacementId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['edges', edgeIndex],
        message: 'Canvas edge has invalid placement endpoints',
      });
    }
  }

  for (const [annotationIndex, annotation] of document.annotations.entries()) {
    if (annotation.placementId !== null && !placements.has(annotation.placementId)) {
      context.addIssue({
        code: 'custom',
        path: ['annotations', annotationIndex, 'placementId'],
        message: 'Annotation references an unknown placement',
      });
    }
  }
});
export const CanvasSchema = CanvasDocumentSchema;

export type CanvasTarget = z.infer<typeof CanvasTargetSchema>;
export type CanvasTargetBinding = z.infer<typeof CanvasTargetBindingSchema>;
export type CanvasPlacement = z.infer<typeof CanvasPlacementSchema>;
export type CanvasGroup = z.infer<typeof CanvasGroupSchema>;
export type CanvasEdge = z.infer<typeof CanvasEdgeSchema>;
export type CanvasAnnotation = z.infer<typeof CanvasAnnotationSchema>;
export type CanvasDocument = z.infer<typeof CanvasDocumentSchema>;
export type Canvas = z.infer<typeof CanvasSchema>;
