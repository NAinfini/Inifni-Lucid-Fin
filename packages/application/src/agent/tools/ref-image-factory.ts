import type {
  AudioNodeData,
  Canvas,
  CanvasSettings,
  ImageNodeData,
  ReferenceImage,
  VideoNodeData,
} from '@lucid-fin/contracts';
import { tryProviderId } from '@lucid-fin/contracts-parse';
import type { AgentTool } from '../tool-registry.js';
import { requireString } from './tool-result-helpers.js';

export interface RefImageEntity {
  id: string;
  referenceImages?: ReferenceImage[];
  updatedAt?: number;
}

/**
 * Phase 2 overhaul — ref-image factory now accepts a view-kind discriminated
 * union instead of a free-form slot string. Callers implement a domain-
 * specific `parseView` that converts the agent's `{ kind, angle? }` object
 * into their typed view, plus a `viewToSlot` stringifier so the storage
 * shape stays a flat `slot: string` column.
 *
 * stylePlate (free-form canvas-scoped style prompt) is pulled from
 * `canvas.settings` and threaded into `buildPrompt` so the style prompt
 * leads every generation.
 */
export interface RefImageFactoryConfig<T extends RefImageEntity, V> {
  toolNamePrefix: string;
  entityLabel: string;
  tags: string[];
  description?: string;
  getEntity: (id: string) => Promise<T | null>;
  saveEntity: (entity: T) => Promise<void>;
  generateImage?: (
    prompt: string,
    options?: { providerId?: string; width?: number; height?: number },
  ) => Promise<{ assetHash: string }>;
  getCanvas?: (canvasId: string) => Promise<Canvas>;
  /** Parse the agent's `view` argument into a domain-specific view kind. */
  parseView: (rawView: unknown) => V;
  /** Compile a prompt from the entity, view, and optional canvas stylePlate. */
  buildPrompt: (entity: T, view: V, stylePlate?: string) => string;
  /** Stringify a view into the storage-layer slot column. */
  viewToSlot: (view: V) => string;
  /** Default canvas settings used when no canvas context is supplied (tests). */
  defaultSettings?: CanvasSettings;
  defaultWidth?: number;
  defaultHeight?: number;
  /**
   * JSON-schema doc for the `view.kind` enum. Extra-angle still permits any
   * angle string, so we advertise the primary kinds plus `extra-angle` here
   * and let `parseView` validate the combination.
   */
  kindEnum: string[];
}

function readStylePlateFromCanvas(canvas: Canvas | undefined): string | undefined {
  return canvas?.settings?.stylePlate;
}

/**
 * Creates 4 focused tools from the ref-image factory:
 * - *.generateRefImage  — AI-generate a new reference image
 * - *.setRefImage       — assign an existing asset hash
 * - *.deleteRefImage    — remove a reference image by view
 * - *.setRefImageFromNode — pull asset from a canvas node
 */
export function createRefImageTools<T extends RefImageEntity, V>(
  config: RefImageFactoryConfig<T, V>,
): AgentTool[] {
  const {
    toolNamePrefix,
    entityLabel,
    tags,
    getEntity,
    saveEntity,
    parseView,
    buildPrompt,
    viewToSlot,
    defaultSettings,
    defaultWidth = 2048,
    defaultHeight = 1360,
    kindEnum,
  } = config;

  const entityLabelCap = entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);

  const viewProperty: AgentTool['parameters']['properties'][string] = {
    type: 'object',
    description:
      'View kind discriminator. Use kind=<primary> for the default composite view '
      + '(full-sheet / ortho-grid / bible / fake-360 depending on domain). '
      + 'Use kind=extra-angle with angle=<string> for a custom angle.',
    properties: {
      kind: { type: 'string', description: 'View kind discriminator.', enum: kindEnum },
      angle: { type: 'string', description: 'Free-form angle label (required when kind=extra-angle).' },
    },
  };

  const tools: AgentTool[] = [];
  const generateRefImageDescription =
    `Generate a new AI reference image for a ${entityLabel}. `
    + `Pass a canvasId so the canvas-scoped style prompt is woven into the generation prompt. `
    + `View defaults to the primary composite kind. Optionally specify dimensions, provider, and a custom prompt.`;
  const customPromptDescription =
    `Optional custom prompt. When present, it REPLACES the default composite prompt entirely. `
    + `The canvas stylePlate is still prepended if present.`;

  // ---------------------------------------------------------------------------
  // *.generateRefImage
  // ---------------------------------------------------------------------------
  if (config.generateImage) {
    tools.push({
      name: `${toolNamePrefix}.generateRefImage`,
      description: generateRefImageDescription,
      tags,
      tier: 3,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: `The ${entityLabel} ID.` },
          view: viewProperty,
          canvasId: { type: 'string', description: 'Canvas ID whose settings (stylePlate, provider overrides) drive prompt composition.' },
          width: { type: 'number', description: `Image width in pixels. Default ${defaultWidth}. Auto-clamped to provider max.` },
          height: { type: 'number', description: `Image height in pixels. Default ${defaultHeight}. Auto-clamped to provider max.` },
          prompt: { type: 'string', description: customPromptDescription },
          providerId: { type: 'string', description: 'Optional provider ID override (falls back to canvas setting, then global default).' },
        },
        required: ['id'],
      },
      async execute(args) {
        try {
          const id = requireString(args, 'id');
          const entity = await getEntity(id);
          if (!entity) return { success: false, error: `${entityLabelCap} not found: ${id}` };
          if (!config.generateImage) return { success: false, error: 'Image generation not available' };

          let view: V;
          try {
            view = parseView(args.view);
          } catch (viewErr) {
            return { success: false, error: viewErr instanceof Error ? viewErr.message : String(viewErr) };
          }
          const slot = viewToSlot(view);

          // Resolve canvas-scoped settings (stylePlate + providerId) when
          // a canvas context is supplied.
          let canvasSettings: CanvasSettings | undefined = defaultSettings;
          if (typeof args.canvasId === 'string' && args.canvasId.trim().length > 0 && config.getCanvas) {
            try {
              const canvas = await config.getCanvas(args.canvasId);
              canvasSettings = canvas.settings;
            } catch {
              // Canvas lookup failed — fall through with no canvas settings.
              canvasSettings = undefined;
            }
          }
          const stylePlate = readStylePlateFromCanvas(
            canvasSettings ? { settings: canvasSettings } as Canvas : undefined,
          );

          const customPrompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
          const negativePrompt = canvasSettings?.negativePrompt?.trim() ?? '';
          let finalPrompt: string;
          if (customPrompt.length > 0) {
            // Even for custom prompts, prepend the canvas stylePlate so the
            // style prompt stays in position 0.
            finalPrompt = stylePlate
              ? `Style: ${stylePlate}. ${customPrompt}`
              : customPrompt;
          } else {
            finalPrompt = buildPrompt(entity, view, stylePlate);
          }
          if (negativePrompt.length > 0) {
            finalPrompt = `${finalPrompt}\n\nAvoid: ${negativePrompt}`;
          }

          // Canvas-scoped defaultResolution overrides factory defaults when set;
          // explicit width/height args still take top priority.
          const resolvedDefaultWidth  = canvasSettings?.defaultResolution?.width  ?? defaultWidth;
          const resolvedDefaultHeight = canvasSettings?.defaultResolution?.height ?? defaultHeight;
          const reqWidth  = typeof args.width  === 'number' && args.width  > 0 ? args.width  : resolvedDefaultWidth;
          const reqHeight = typeof args.height === 'number' && args.height > 0 ? args.height : resolvedDefaultHeight;

          // Provider resolution order: explicit arg > canvas setting > (fallback handled upstream).
          const explicitProvider = tryProviderId(args.providerId);
          const canvasProvider = tryProviderId(canvasSettings?.imageProviderId);
          const providerId = explicitProvider ?? canvasProvider;

          const result = await config.generateImage(finalPrompt, {
            width: reqWidth,
            height: reqHeight,
            ...(providerId !== undefined && { providerId }),
          });

          const referenceImages = [...(entity.referenceImages ?? [])];
          const existingIndex = referenceImages.findIndex((image) => image.slot === slot);
          if (existingIndex >= 0) {
            const existing = referenceImages[existingIndex];
            const prevVariants = [...(existing.variants ?? [])];
            if (existing.assetHash && !prevVariants.includes(existing.assetHash)) {
              prevVariants.push(existing.assetHash);
            }
            if (!prevVariants.includes(result.assetHash)) {
              prevVariants.push(result.assetHash);
            }
            referenceImages[existingIndex] = {
              ...existing,
              assetHash: result.assetHash,
              variants: prevVariants,
            };
          } else {
            referenceImages.push({
              slot,
              assetHash: result.assetHash,
              isStandard: true,
              variants: [result.assetHash],
            });
          }

          entity.referenceImages = referenceImages;
          entity.updatedAt = Date.now();
          await saveEntity(entity);

          const variantCount = referenceImages.find((image) => image.slot === slot)
            ?.variants?.length ?? 0;
          return {
            success: true,
            data: {
              assetHash: result.assetHash,
              slot,
              view,
              variantCount,
              promptSource: customPrompt.length > 0 ? 'custom' : 'composite',
              stylePlateUsed: Boolean(stylePlate),
            },
          };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }

  // ---------------------------------------------------------------------------
  // *.setRefImage
  // ---------------------------------------------------------------------------
  tools.push({
    name: `${toolNamePrefix}.setRefImage`,
    description: `Assign an existing asset hash as a reference image for a ${entityLabel}.`,
    tags,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: `The ${entityLabel} ID.` },
        view: viewProperty,
        assetHash: { type: 'string', description: 'CAS asset hash to assign.' },
      },
      required: ['id', 'view', 'assetHash'],
    },
    async execute(args) {
      try {
        const entity = await getEntity(args.id as string);
        if (!entity) return { success: false, error: `${entityLabelCap} not found: ${args.id}` };
        if (typeof args.assetHash !== 'string' || !args.assetHash.trim()) {
          throw new Error('assetHash is required');
        }
        let view: V;
        try {
          view = parseView(args.view);
        } catch (viewErr) {
          return { success: false, error: viewErr instanceof Error ? viewErr.message : String(viewErr) };
        }
        const slot = viewToSlot(view);
        const assetHash = args.assetHash;
        const referenceImages = [...(entity.referenceImages ?? [])];
        const referenceImage: ReferenceImage = { slot, assetHash, isStandard: true };
        const existingIndex = referenceImages.findIndex((image) => image.slot === slot);
        if (existingIndex >= 0) {
          referenceImages[existingIndex] = referenceImage;
        } else {
          referenceImages.push(referenceImage);
        }

        entity.referenceImages = referenceImages;
        entity.updatedAt = Date.now();
        await saveEntity(entity);

        return { success: true, data: { assetHash, slot, view } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  // ---------------------------------------------------------------------------
  // *.deleteRefImage
  // ---------------------------------------------------------------------------
  tools.push({
    name: `${toolNamePrefix}.deleteRefImage`,
    description: `Delete a reference image by view from a ${entityLabel}.`,
    tags,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: `The ${entityLabel} ID.` },
        view: viewProperty,
      },
      required: ['id', 'view'],
    },
    async execute(args) {
      try {
        const entity = await getEntity(args.id as string);
        if (!entity) return { success: false, error: `${entityLabelCap} not found: ${args.id}` };
        let view: V;
        try {
          view = parseView(args.view);
        } catch (viewErr) {
          return { success: false, error: viewErr instanceof Error ? viewErr.message : String(viewErr) };
        }
        const slot = viewToSlot(view);
        entity.referenceImages = (entity.referenceImages ?? []).filter((image) => image.slot !== slot);
        entity.updatedAt = Date.now();
        await saveEntity(entity);

        return { success: true, data: { id: entity.id, slot, view } };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  // ---------------------------------------------------------------------------
  // *.setRefImageFromNode
  // ---------------------------------------------------------------------------
  if (config.getCanvas) {
    tools.push({
      name: `${toolNamePrefix}.setRefImageFromNode`,
      description: `Pull a generated asset from a canvas node and assign it as a reference image for a ${entityLabel}.`,
      tags,
      tier: 3,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: `The ${entityLabel} ID.` },
          view: viewProperty,
          canvasId: { type: 'string', description: 'Canvas ID containing the node.' },
          nodeId: { type: 'string', description: 'Image node ID to pull the asset from.' },
        },
        required: ['id', 'view', 'canvasId', 'nodeId'],
      },
      async execute(args) {
        try {
          if (!config.getCanvas) return { success: false, error: 'getCanvas not available' };
          if (typeof args.canvasId !== 'string' || !args.canvasId.trim()) throw new Error('canvasId is required');
          if (typeof args.nodeId !== 'string' || !args.nodeId.trim()) throw new Error('nodeId is required');
          let view: V;
          try {
            view = parseView(args.view);
          } catch (viewErr) {
            return { success: false, error: viewErr instanceof Error ? viewErr.message : String(viewErr) };
          }
          const slot = viewToSlot(view);
          const canvas = await config.getCanvas(args.canvasId);
          const node = canvas.nodes.find((n) => n.id === args.nodeId);
          if (!node) return { success: false, error: `Node not found: ${args.nodeId}` };
          if (node.type !== 'image' && node.type !== 'video' && node.type !== 'audio') {
            return { success: false, error: `Node type does not support reference images: ${node.type}` };
          }
          const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
          const variants = Array.isArray(data.variants) ? data.variants : [];
          const idx = typeof data.selectedVariantIndex === 'number' ? data.selectedVariantIndex : 0;
          const assetHash = variants[idx] ?? data.assetHash;
          if (typeof assetHash !== 'string' || !assetHash) return { success: false, error: 'No generated asset on node' };
          const entity = await getEntity(args.id as string);
          if (!entity) return { success: false, error: `${entityLabelCap} not found: ${args.id}` };
          entity.referenceImages = (entity.referenceImages ?? []).filter((image) => image.slot !== slot);
          entity.referenceImages.push({ slot, assetHash, isStandard: true });
          entity.updatedAt = Date.now();
          await saveEntity(entity);
          return { success: true, data: { id: entity.id, slot, view, assetHash } };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }

  return tools;
}
