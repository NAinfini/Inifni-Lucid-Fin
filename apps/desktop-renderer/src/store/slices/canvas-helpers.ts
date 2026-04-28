import {
  PRESET_CATEGORIES,
  createEmptyPresetTrackSet,
  type Canvas,
  type CanvasNode,
  type CanvasEdge,
  type NodeKind,
  type CanvasNodeData,
  type PresetCategory,
  type PresetTrackEntry,
  type PresetTrackSet,
  type EquipmentRef,
  type BackdropNodeData,
  type ImageNodeData,
  type VideoNodeData,
  type AudioNodeData,
} from '@lucid-fin/contracts';
import { isGeneratableMedia } from '@lucid-fin/shared-utils';
import { t } from '../../i18n.js';
import type { CanvasClipboardPayload, CanvasSliceState } from './canvas.js';

// ---------------------------------------------------------------------------
// Loose accessor type for PresetTrackSet — avoids TS `never` when indexing a
// mapped type with a union key in Immer reducer mutations.
// ---------------------------------------------------------------------------

export type TrackMap = Record<PresetCategory, import('@lucid-fin/contracts').PresetTrack>;

export type GenerationNodeData = ImageNodeData | VideoNodeData | AudioNodeData;

export const DEFAULT_MEDIA_NODE_FRAME = {
  width: 240,
  height: 180,
} as const;

export function getDefaultNodeFrame(
  type: NodeKind,
): { width: number; height: number } | undefined {
  switch (type) {
    case 'image':
    case 'video':
      return DEFAULT_MEDIA_NODE_FRAME;
    case 'text':
      return { width: 300, height: 200 };
    case 'backdrop':
      return { width: 420, height: 240 };
    default:
      return undefined;
  }
}

export function normalizeCanvasNodeFrame(node: CanvasNode): CanvasNode {
  const defaultFrame = getDefaultNodeFrame(node.type);
  if (!defaultFrame) return node;
  if (node.width != null && node.height != null) return node;

  return {
    ...node,
    width: node.width ?? defaultFrame.width,
    height: node.height ?? defaultFrame.height,
  };
}

export function normalizeCanvasNodeFrames(canvas: Canvas): Canvas {
  let changed = false;
  const nodes = canvas.nodes.map((node) => {
    const normalized = normalizeCanvasNodeFrame(node);
    if (normalized !== node) {
      changed = true;
    }
    return normalized;
  });

  return changed ? { ...canvas, nodes } : canvas;
}

// ---------------------------------------------------------------------------
// Pure helpers (no Redux dependency)
// ---------------------------------------------------------------------------

export function findActiveCanvas(state: CanvasSliceState): Canvas | undefined {
  if (!state.activeCanvasId) return undefined;
  return state.canvases.entities[state.activeCanvasId];
}

export function findCanvasById(state: CanvasSliceState, canvasId: string | null | undefined): Canvas | undefined {
  if (!canvasId) return undefined;
  return state.canvases.entities[canvasId];
}

export function createDefaultPresetTracks(): PresetTrackSet {
  return createEmptyPresetTrackSet();
}

export function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createEntityId(prefix: 'node' | 'edge'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getCanvasNodeType(canvas: Canvas, nodeId: string): NodeKind | undefined {
  return canvas.nodes.find((node) => node.id === nodeId)?.type;
}

export function getAutoEdgeLabel(
  sourceType: NodeKind | undefined,
  targetType: NodeKind | undefined,
): string | undefined {
  if (!sourceType || !targetType) return undefined;

  if (sourceType === 'text' && targetType === 'image') return t('edge.generateImage');
  if (sourceType === 'image' && targetType === 'video') return t('edge.animate');
  if (sourceType === 'text' && targetType === 'video') return t('edge.generateVideo');
  if (sourceType === 'audio' && (targetType === 'image' || targetType === 'video')) return t('edge.addAudio');
  if (sourceType === 'text' && targetType === 'audio') return t('edge.narrate');
  if (sourceType === 'image' && targetType === 'image') return t('edge.reference');
  if (sourceType === 'video' && targetType === 'image') return t('edge.extractFrame');
  if (sourceType === 'video' && targetType === 'audio') return t('edge.extractAudio');
  if (targetType === 'backdrop') return t('edge.group');
  if (sourceType === 'backdrop') return t('edge.ungroup');

  return `${sourceType[0]!.toUpperCase()}${sourceType.slice(1)} -> ${targetType[0]!.toUpperCase()}${targetType.slice(1)}`;
}

export function ensureEdgeLabel(canvas: Canvas, edge: CanvasEdge): CanvasEdge {
  if (edge.data.label) {
    return {
      ...edge,
      data: { ...edge.data, autoLabel: edge.data.autoLabel ?? false },
    };
  }

  return {
    ...edge,
    data: {
      ...edge.data,
      label: getAutoEdgeLabel(getCanvasNodeType(canvas, edge.source), getCanvasNodeType(canvas, edge.target)),
      autoLabel: true,
    },
  };
}

export function buildCanvasClipboardPayload(
  canvas: Canvas,
  selectedNodeIds: readonly string[],
): CanvasClipboardPayload | null {
  if (selectedNodeIds.length === 0) {
    return null;
  }

  const nodeIdSet = new Set(selectedNodeIds);
  const nodes = canvas.nodes.filter((node) => nodeIdSet.has(node.id)).map((node) => cloneDeep(node));
  const edges = canvas.edges
    .filter((edge) => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target))
    .map((edge) => cloneDeep(edge));

  return {
    version: 1,
    sourceCanvasId: canvas.id,
    nodes,
    edges,
    copiedAt: Date.now(),
  };
}

export function createNodeRecord(payload: {
  id: string;
  type: NodeKind;
  position: { x: number; y: number };
  title?: string;
  data?: CanvasNodeData;
  width?: number;
  height?: number;
}): CanvasNode {
  const now = Date.now();
  const defaultFrame = getDefaultNodeFrame(payload.type);
  const defaultData: Record<NodeKind, CanvasNodeData> = {
    text: { content: '' },
    image: {
      status: 'empty',
      width: 1024,
      height: 1024,
      variants: [],
      selectedVariantIndex: 0,
      variantCount: 1,
      seedLocked: false,
      presetTracks: createDefaultPresetTracks(),
    },
    video: {
      status: 'empty',
      width: 1280,
      height: 720,
      duration: 5,
      fps: 24,
      variants: [],
      selectedVariantIndex: 0,
      variantCount: 1,
      seedLocked: false,
      presetTracks: createDefaultPresetTracks(),
    },
    audio: {
      status: 'empty',
      audioType: 'voice',
      variants: [],
      selectedVariantIndex: 0,
      variantCount: 1,
      seedLocked: false,
    },
    backdrop: {
      color: '#334155',
      padding: 24,
      opacity: 0.14,
      collapsed: false,
    } satisfies BackdropNodeData,
  };

  const node: CanvasNode = {
    id: payload.id,
    type: payload.type,
    position: payload.position,
    data: payload.data ?? defaultData[payload.type],
    title: payload.title ?? (payload.type === 'backdrop' ? t('canvas.nodeType.backdrop') : ''),
    bypassed: false,
    locked: false,
    width: payload.width ?? defaultFrame?.width,
    height: payload.height ?? defaultFrame?.height,
    createdAt: now,
    updatedAt: now,
  };

  return node;
}

export function stampCanvasDefaultProvider(node: CanvasNode, canvas: Canvas): void {
  const s = canvas.settings;
  if (!s) return;
  const t = node.type === 'backdrop' ? 'image' : node.type;
  if (t !== 'image' && t !== 'video' && t !== 'audio') return;
  const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  if (data.providerId) return;
  const fallback =
    t === 'image' ? s.imageProviderId :
    t === 'video' ? s.videoProviderId :
    s.audioProviderId;
  if (fallback) data.providerId = fallback;
}

export function pasteClipboardPayload(
  canvas: Canvas,
  clipboard: CanvasClipboardPayload,
  offset: { x: number; y: number },
): { nodes: CanvasNode[]; edges: CanvasEdge[] } {
  const nodeIdMap = new Map<string, string>();
  const now = Date.now();

  const nodes = clipboard.nodes.map((sourceNode) => {
    const nextId = createEntityId('node');
    nodeIdMap.set(sourceNode.id, nextId);
    return {
      ...cloneDeep(sourceNode),
      id: nextId,
      position: {
        x: sourceNode.position.x + offset.x,
        y: sourceNode.position.y + offset.y,
      },
      createdAt: now,
      updatedAt: now,
    };
  });

  const typeById = new Map<string, NodeKind>();
  for (const node of canvas.nodes) {
    typeById.set(node.id, node.type);
  }
  for (const node of nodes) {
    typeById.set(node.id, node.type);
  }

  const edges = clipboard.edges.flatMap((sourceEdge) => {
    const nextSource = nodeIdMap.get(sourceEdge.source);
    const nextTarget = nodeIdMap.get(sourceEdge.target);
    if (!nextSource || !nextTarget) {
      return [];
    }

    const sourceType = typeById.get(nextSource);
    const targetType = typeById.get(nextTarget);

    return [
      {
        ...cloneDeep(sourceEdge),
        id: createEntityId('edge'),
        source: nextSource,
        target: nextTarget,
        data: {
          ...cloneDeep(sourceEdge.data),
          label:
            sourceEdge.data.autoLabel === true
              ? getAutoEdgeLabel(sourceType, targetType)
              : sourceEdge.data.label,
        },
      },
    ];
  });

  return { nodes, edges };
}

export function ensureNodePresetTracks(node: CanvasNode): { presetTracks: TrackMap } {
  const data = node.data as {
    presetTracks?: Record<string, { category?: PresetCategory; entries: PresetTrackEntry[] }>;
  };
  if (!data.presetTracks) {
    data.presetTracks = createDefaultPresetTracks();
  }

  const OLD_TO_NEW: Record<string, PresetCategory> = {
    motion: 'camera',
    lighting: 'scene',
    environment: 'scene',
    style: 'look',
    color: 'look',
    texture: 'look',
    pacing: 'flow',
    transition: 'flow',
    'aspect-ratio': 'technical',
    quality: 'technical',
  };

  for (const [oldCat, newCat] of Object.entries(OLD_TO_NEW)) {
    const old = data.presetTracks[oldCat];
    if (old && old.entries.length > 0) {
      if (!data.presetTracks[newCat]) {
        data.presetTracks[newCat] = { category: newCat, entries: [] };
      }
      for (const entry of old.entries) {
        entry.category = newCat;
        data.presetTracks[newCat].entries.push(entry);
      }
    }
    delete data.presetTracks[oldCat];
  }

  for (const category of PRESET_CATEGORIES) {
    if (!data.presetTracks[category]) {
      data.presetTracks[category] = { category, entries: [] };
      continue;
    }
    data.presetTracks[category].category = category;
  }
  return data as { presetTracks: TrackMap };
}

export function normalizeTrackEntries(track: { entries: PresetTrackEntry[] }, category: PresetCategory): void {
  track.entries.forEach((entry: PresetTrackEntry, index: number) => {
    entry.category = category;
    entry.order = index;
  });
}

export function getGenerationNodeData(node: CanvasNode): GenerationNodeData | undefined {
  if (isGeneratableMedia(node.type)) {
    return node.data as GenerationNodeData;
  }
  return undefined;
}

export function normalizeEquipmentRefs(refs: EquipmentRef[] | undefined): EquipmentRef[] {
  if (!Array.isArray(refs)) return [];
  const seen = new Set<string>();
  const result: EquipmentRef[] = [];
  for (const ref of refs) {
    if (!ref?.equipmentId?.trim()) continue;
    const equipmentId = ref.equipmentId.trim();
    if (seen.has(equipmentId)) continue;
    seen.add(equipmentId);
    result.push({ equipmentId, angleSlot: ref.angleSlot, referenceImageHash: ref.referenceImageHash });
  }
  return result;
}
