import { z } from 'zod';

const PositionSchema = z
  .object({
    x: z.number(),
    y: z.number(),
  })
  .strict();

export const StrictCanvasNodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(['text', 'image', 'video', 'audio', 'backdrop']),
    position: PositionSchema,
    data: z.record(z.string(), z.unknown()),
    title: z.string(),
    status: z.enum(['idle', 'queued', 'generating', 'done', 'failed', 'locked', 'bypassed']),
    bypassed: z.boolean(),
    locked: z.boolean(),
    colorTag: z.string().optional(),
    tags: z.array(z.string()).optional(),
    groupId: z.string().optional(),
    parentId: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const StrictCanvasEdgeSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    sourceHandle: z.string().optional(),
    targetHandle: z.string().optional(),
    data: z
      .object({
        label: z.string().optional(),
        status: z.enum(['idle', 'generating', 'done', 'failed']),
        autoLabel: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

const CanvasViewportSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    zoom: z.number(),
  })
  .strict();

const CanvasNoteSchema = z
  .object({
    id: z.string().min(1),
    content: z.string(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

const CanvasResolutionSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

const CanvasSettingsSchema = z
  .object({
    stylePlate: z.string().min(1).optional(),
    negativePrompt: z.string().min(1).optional(),
    refResolution: CanvasResolutionSchema.optional(),
    publishImageResolution: CanvasResolutionSchema.optional(),
    publishVideoResolution: CanvasResolutionSchema.optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '2.39:1']).optional(),
    llmProviderId: z.string().min(1).optional(),
    imageProviderId: z.string().min(1).optional(),
    videoProviderId: z.string().min(1).optional(),
    audioProviderId: z.string().min(1).optional(),
  })
  .strict();

export const StrictCanvasSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    schemaVersion: z.number().int().positive().optional(),
    nodes: z.array(StrictCanvasNodeSchema),
    edges: z.array(StrictCanvasEdgeSchema),
    viewport: CanvasViewportSchema,
    notes: z.array(CanvasNoteSchema),
    settings: CanvasSettingsSchema.optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

const CANVAS_NODE_CHANGE_KEYS = new Set([
  'type',
  'position',
  'data',
  'title',
  'status',
  'bypassed',
  'locked',
  'colorTag',
  'tags',
  'groupId',
  'parentId',
  'width',
  'height',
  'updatedAt',
]);

const CanvasNodeChangesSchema = z.record(z.string(), z.unknown()).superRefine((changes, ctx) => {
  for (const key of Object.keys(changes)) {
    if (!CANVAS_NODE_CHANGE_KEYS.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Unsupported canvas node change field: ${key}`,
        path: [key],
      });
    }
  }
});

export const CanvasPatchSchema = z
  .object({
    canvasId: z.string().min(1),
    timestamp: z.number().int().nonnegative(),
    schemaVersion: z.number().int().positive().optional(),
    operations: z
      .array(
        z.enum(['addNode', 'updateNode', 'removeNode', 'addEdge', 'removeEdge', 'renameCanvas']),
      )
      .optional(),
    nameChange: z.string().optional(),
    addedNodes: z.array(StrictCanvasNodeSchema).optional(),
    removedNodeIds: z.array(z.string().min(1)).optional(),
    updatedNodes: z
      .array(
        z
          .object({
            id: z.string().min(1),
            changes: CanvasNodeChangesSchema,
          })
          .strict(),
      )
      .optional(),
    addedEdges: z.array(StrictCanvasEdgeSchema).optional(),
    removedEdgeIds: z.array(z.string().min(1)).optional(),
  })
  .strict();

export type StrictCanvasDto = z.infer<typeof StrictCanvasSchema>;
export type CanvasPatchDto = z.infer<typeof CanvasPatchSchema>;
