import type {
  AudioNodeData,
  Canvas,
  ImageNodeData,
  ReferenceImage,
  VideoNodeData,
} from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';

export interface RefImageEntity {
  id: string;
  referenceImages?: ReferenceImage[];
  updatedAt?: number;
}

export interface RefImageFactoryConfig<T extends RefImageEntity> {
  toolName: string;
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

export function createRefImageTool<T extends RefImageEntity>(config: RefImageFactoryConfig<T>): AgentTool {
  const {
    toolName,
    entityLabel,
    tags,
    getEntity,
    saveEntity,
    buildPrompt,
    isStandardSlot,
    defaultWidth = 1536,
    defaultHeight = 1024,
    slotEnum,
  } = config;

  const entityLabelCap = entityLabel.charAt(0).toUpperCase() + entityLabel.slice(1);

  const slotProperty: AgentTool['parameters']['properties'][string] = slotEnum
    ? { type: 'string', description: 'Reference image slot or angle.', enum: slotEnum }
    : { type: 'string', description: 'Reference image slot or angle.' };

  const hasGenerate = config.generateImage !== undefined;

  const actionEnum = hasGenerate
    ? ['generate', 'set', 'delete', 'setFromNode']
    : ['set', 'delete', 'setFromNode'];

  return {
    name: toolName,
    description: config.description ?? `Manage reference images for a ${entityLabel}.`,
    tags,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: `The ${entityLabel} ID.` },
        action: {
          type: 'string',
          description: 'The operation to perform.',
          enum: actionEnum,
        },
        slot: slotProperty,
        assetHash: { type: 'string', description: 'CAS asset hash to assign. Required for action=set.' },
        canvasId: { type: 'string', description: 'Canvas ID. Required for action=setFromNode.' },
        nodeId: { type: 'string', description: 'Image node ID to pull the generated asset from. Required for action=setFromNode.' },
        width: { type: 'number', description: `Image width in pixels. Default ${defaultWidth}. Auto-clamped to provider max. For action=generate.` },
        height: { type: 'number', description: `Image height in pixels. Default ${defaultHeight}. Auto-clamped to provider max. For action=generate.` },
        prompt: { type: 'string', description: 'Optional custom prompt override. For action=generate.' },
        providerId: { type: 'string', description: 'Optional provider ID override. For action=generate.' },
      },
      required: ['id', 'action'],
    },
    async execute(args) {
      try {
        const action = args.action as string;

        if (action === 'generate') {
          const entity = await getEntity(args.id as string);
          if (!entity) {
            return { success: false, error: `${entityLabelCap} not found: ${args.id}` };
          }
          if (!config.generateImage) {
            return { success: false, error: 'Image generation not available' };
          }

          const slot = typeof args.slot === 'string' ? args.slot : 'main';
          const finalPrompt = typeof args.prompt === 'string' && args.prompt.trim().length > 0
            ? args.prompt
            : buildPrompt(entity, slot);

          const reqWidth = typeof args.width === 'number' && args.width > 0 ? args.width : defaultWidth;
          const reqHeight = typeof args.height === 'number' && args.height > 0 ? args.height : defaultHeight;
          const providerId = typeof args.providerId === 'string' && args.providerId ? args.providerId : undefined;
          const result = await config.generateImage(finalPrompt, { width: reqWidth, height: reqHeight, ...(providerId !== undefined && { providerId }) });
          const referenceImages = [...(entity.referenceImages ?? [])];
          const existingIndex = referenceImages.findIndex((image) => image.slot === slot);
          if (existingIndex >= 0) {
            const existing = referenceImages[existingIndex];
            const prevVariants = existing.variants ?? [];
            if (existing.assetHash && !prevVariants.includes(existing.assetHash)) {
              prevVariants.push(existing.assetHash);
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
              isStandard: isStandardSlot(slot),
            });
          }

          entity.referenceImages = referenceImages;
          entity.updatedAt = Date.now();
          await saveEntity(entity);

          const variantCount = referenceImages.find((r) => r.slot === slot)?.variants?.length ?? 0;
          return { success: true, data: { assetHash: result.assetHash, slot, variantCount } };
        }

        if (action === 'set') {
          const entity = await getEntity(args.id as string);
          if (!entity) {
            return { success: false, error: `${entityLabelCap} not found: ${args.id}` };
          }

          if (typeof args.slot !== 'string' || !args.slot.trim()) throw new Error('slot is required for action=set');
          if (typeof args.assetHash !== 'string' || !args.assetHash.trim()) throw new Error('assetHash is required for action=set');
          const slot = args.slot;
          const assetHash = args.assetHash;
          const referenceImages = [...(entity.referenceImages ?? [])];
          const referenceImage = {
            slot,
            assetHash,
            isStandard: isStandardSlot(slot),
          };
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
        }

        if (action === 'delete') {
          const entity = await getEntity(args.id as string);
          if (!entity) {
            return { success: false, error: `${entityLabelCap} not found: ${args.id}` };
          }

          if (typeof args.slot !== 'string' || !args.slot.trim()) throw new Error('slot is required for action=delete');
          const slot = args.slot;
          entity.referenceImages = (entity.referenceImages ?? []).filter((image) => image.slot !== slot);
          entity.updatedAt = Date.now();
          await saveEntity(entity);

          return { success: true, data: { id: entity.id, slot } };
        }

        if (action === 'setFromNode') {
          if (!config.getCanvas) return { success: false, error: 'getCanvas not available' };
          if (typeof args.canvasId !== 'string' || !args.canvasId.trim()) throw new Error('canvasId is required for action=setFromNode');
          if (typeof args.nodeId !== 'string' || !args.nodeId.trim()) throw new Error('nodeId is required for action=setFromNode');
          if (typeof args.slot !== 'string' || !args.slot.trim()) throw new Error('slot is required for action=setFromNode');
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
          entity.referenceImages.push({
            slot,
            assetHash,
            isStandard: isStandardSlot(slot),
          });
          entity.updatedAt = Date.now();
          await saveEntity(entity);
          return { success: true, data: { id: entity.id, slot, assetHash } };
        }

        return { success: false, error: `Unknown action: ${action}` };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
