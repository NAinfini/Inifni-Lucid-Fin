import type {
  AudioNodeData,
  Canvas,
  ImageNodeData,
  ReferenceImage,
  VideoNodeData,
} from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';
import { requireString } from './tool-result-helpers.js';

export interface RefImageEntity {
  id: string;
  referenceImages?: ReferenceImage[];
  updatedAt?: number;
}

export interface RefImageFactoryConfig<T extends RefImageEntity> {
  toolNamePrefix: string;
  entityLabel: string;
  tags: string[];
  description?: string;
  getEntity: (id: string) => Promise<T | null>;
  saveEntity: (entity: T) => Promise<void>;
  generateImage?: (prompt: string, options?: { providerId?: string; width?: number; height?: number }) => Promise<{ assetHash: string }>;
  getCanvas?: (canvasId: string) => Promise<Canvas>;
  buildPrompt: (entity: T, slot: string) => string;
  isStandardSlot: (slot: string) => boolean;
  defaultWidth?: number;
  defaultHeight?: number;
  slotEnum?: string[];
}

/**
 * Creates 4 focused tools from the ref-image factory:
 * - *.generateRefImage  — AI-generate a new reference image
 * - *.setRefImage       — assign an existing asset hash
 * - *.deleteRefImage    — remove a reference image by slot
 * - *.setRefImageFromNode — pull asset from a canvas node
 */
export function createRefImageTools<T extends RefImageEntity>(config: RefImageFactoryConfig<T>): AgentTool[] {
  const {
    toolNamePrefix,
    entityLabel,
    tags,
    getEntity,
    saveEntity,
    buildPrompt,
    isStandardSlot,
    defaultWidth = 2048,
    defaultHeight = 1360,
    slotEnum,
  } = config;

  const entityLabelCap = entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);

  const slotProperty: AgentTool['parameters']['properties'][string] = slotEnum
    ? { type: 'string', description: 'Reference image slot or angle.', enum: slotEnum }
    : { type: 'string', description: 'Reference image slot or angle.' };

  const tools: AgentTool[] = [];

  // ---------------------------------------------------------------------------
  // *.generateRefImage
  // ---------------------------------------------------------------------------
  if (config.generateImage) {
    tools.push({
      name: `${toolNamePrefix}.generateRefImage`,
      description: `Generate a new AI reference image for a ${entityLabel}. You write the prompt — describe what the reference image should look like based on the entity's data. If you omit the prompt, a basic fallback is generated from entity fields. Optionally specify slot, dimensions, and provider.`,
      tags,
      tier: 3,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: `The ${entityLabel} ID.` },
          slot: slotProperty,
          width: { type: 'number', description: `Image width in pixels. Default ${defaultWidth}. Auto-clamped to provider max.` },
          height: { type: 'number', description: `Image height in pixels. Default ${defaultHeight}. Auto-clamped to provider max.` },
          prompt: { type: 'string', description: `The full prompt for the reference image. Describe the ${entityLabel} visually based on its stored data. If omitted, a basic prompt is auto-generated from entity fields.` },
          providerId: { type: 'string', description: 'Optional provider ID override.' },
        },
        required: ['id'],
      },
      async execute(args) {
        try {
          const id = requireString(args, 'id');
          const entity = await getEntity(id);
          if (!entity) return { success: false, error: `${entityLabelCap} not found: ${id}` };
          if (!config.generateImage) return { success: false, error: 'Image generation not available' };

          const slot = typeof args.slot === 'string' ? args.slot : 'main';
          const aiPrompt = typeof args.prompt === 'string' && args.prompt.trim().length > 0
            ? args.prompt.trim()
            : '';
          const finalPrompt = aiPrompt || buildPrompt(entity, slot);

          const reqWidth = typeof args.width === 'number' && args.width > 0 ? args.width : defaultWidth;
          const reqHeight = typeof args.height === 'number' && args.height > 0 ? args.height : defaultHeight;
          const providerId = typeof args.providerId === 'string' && args.providerId ? args.providerId : undefined;
          const result = await config.generateImage(finalPrompt, { width: reqWidth, height: reqHeight, ...(providerId !== undefined && { providerId }) });

          const referenceImages = [...(entity.referenceImages ?? [])];
          const existingIndex = referenceImages.findIndex((image) => image.slot === slot);
          if (existingIndex >= 0) {
            const existing = referenceImages[existingIndex];
            const prevVariants = [...(existing.variants ?? [])];
            // Add old active to variants if not already present
            if (existing.assetHash && !prevVariants.includes(existing.assetHash)) {
              prevVariants.push(existing.assetHash);
            }
            // Add new result to variants so the full history is preserved
            if (!prevVariants.includes(result.assetHash)) {
              prevVariants.push(result.assetHash);
            }
            referenceImages[existingIndex] = { ...existing, assetHash: result.assetHash, variants: prevVariants };
          } else {
            referenceImages.push({ slot, assetHash: result.assetHash, isStandard: isStandardSlot(slot), variants: [result.assetHash] });
          }

          entity.referenceImages = referenceImages;
          entity.updatedAt = Date.now();
          await saveEntity(entity);

          const variantCount = referenceImages.find((r) => r.slot === slot)?.variants?.length ?? 0;
          return { success: true, data: { assetHash: result.assetHash, slot, variantCount } };
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
        slot: slotProperty,
        assetHash: { type: 'string', description: 'CAS asset hash to assign.' },
      },
      required: ['id', 'slot', 'assetHash'],
    },
    async execute(args) {
      try {
        const entity = await getEntity(args.id as string);
        if (!entity) return { success: false, error: `${entityLabelCap} not found: ${args.id}` };

        if (typeof args.slot !== 'string' || !args.slot.trim()) throw new Error('slot is required');
        if (typeof args.assetHash !== 'string' || !args.assetHash.trim()) throw new Error('assetHash is required');
        const slot = args.slot;
        const assetHash = args.assetHash;
        const referenceImages = [...(entity.referenceImages ?? [])];
        const referenceImage = { slot, assetHash, isStandard: isStandardSlot(slot) };
        const existingIndex = referenceImages.findIndex((image) => image.slot === slot);
        if (existingIndex >= 0) {
          referenceImages[existingIndex] = referenceImage;
        } else {
          referenceImages.push(referenceImage);
        }

        entity.referenceImages = referenceImages;
        entity.updatedAt = Date.now();
        await saveEntity(entity);

        return { success: true, data: { assetHash, slot } };
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
    description: `Delete a reference image by slot from a ${entityLabel}.`,
    tags,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: `The ${entityLabel} ID.` },
        slot: slotProperty,
      },
      required: ['id', 'slot'],
    },
    async execute(args) {
      try {
        const entity = await getEntity(args.id as string);
        if (!entity) return { success: false, error: `${entityLabelCap} not found: ${args.id}` };

        if (typeof args.slot !== 'string' || !args.slot.trim()) throw new Error('slot is required');
        const slot = args.slot;
        entity.referenceImages = (entity.referenceImages ?? []).filter((image) => image.slot !== slot);
        entity.updatedAt = Date.now();
        await saveEntity(entity);

        return { success: true, data: { id: entity.id, slot } };
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
          slot: slotProperty,
          canvasId: { type: 'string', description: 'Canvas ID containing the node.' },
          nodeId: { type: 'string', description: 'Image node ID to pull the asset from.' },
        },
        required: ['id', 'slot', 'canvasId', 'nodeId'],
      },
      async execute(args) {
        try {
          if (!config.getCanvas) return { success: false, error: 'getCanvas not available' };
          if (typeof args.canvasId !== 'string' || !args.canvasId.trim()) throw new Error('canvasId is required');
          if (typeof args.nodeId !== 'string' || !args.nodeId.trim()) throw new Error('nodeId is required');
          if (typeof args.slot !== 'string' || !args.slot.trim()) throw new Error('slot is required');
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
          const slot = args.slot as string;
          entity.referenceImages = (entity.referenceImages ?? []).filter((image) => image.slot !== slot);
          entity.referenceImages.push({ slot, assetHash, isStandard: isStandardSlot(slot) });
          entity.updatedAt = Date.now();
          await saveEntity(entity);
          return { success: true, data: { id: entity.id, slot, assetHash } };
        } catch (err) {
          return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    });
  }

  return tools;
}

/** @deprecated Use createRefImageTools instead */
export function createRefImageTool<T extends RefImageEntity>(config: RefImageFactoryConfig<T> & { toolName: string }): AgentTool {
  // Backward compat shim — returns the first tool from the new factory
  const tools = createRefImageTools({ ...config, toolNamePrefix: config.toolName.replace(/\.refImage$/, '') });
  return tools[0];
}
