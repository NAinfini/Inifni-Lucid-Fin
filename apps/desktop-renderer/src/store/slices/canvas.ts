import {
  createSlice,
  current,
  type ActionCreatorWithPayload,
  type PayloadAction,
  type Reducer,
} from '@reduxjs/toolkit';
import {
  PRESET_CATEGORIES,
  createEmptyPresetTrackSet,
  type Canvas,
  type CanvasNode,
  type CanvasEdge,
  type CanvasViewport,
  type CanvasNodeType,
  type CanvasNodeData,
  type NodeStatus,
  type EdgeStatus,
  type PresetCategory,
  type PresetTrack,
  type PresetTrackEntry,
  type PresetTrackSet,
  type CharacterRef,
  type EquipmentRef,
  type LocationRef,
  type BackdropNodeData,
  type ImageNodeData,
  type VideoNodeData,
  type AudioNodeData,
  type CanvasNote,
  type ShotTemplate,
} from '@lucid-fin/contracts';
import { t } from '../../i18n.js';

/**
 * Loose accessor type for PresetTrackSet — avoids TS `never` when indexing a
 * mapped type with a union key in Immer reducer mutations.
 */
type TrackMap = Record<PresetCategory, PresetTrack>;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface CanvasSliceState {
  /** All canvases loaded for the current project */
  canvases: Canvas[];
  /** ID of the canvas currently visible on screen */
  activeCanvasId: string | null;
  /** Currently selected node IDs */
  selectedNodeIds: string[];
  /** Currently selected edge IDs */
  selectedEdgeIds: string[];
  /** Current viewport state (synced from React Flow) */
  viewport: CanvasViewport;
  /** ReactFlow container dimensions */
  containerWidth: number;
  containerHeight: number;
  /** Internal clipboard payload for cross-canvas paste */
  clipboard: CanvasClipboardPayload | null;
  /** Loading indicator */
  loading: boolean;
}

export interface CanvasClipboardPayload {
  version: 1;
  sourceCanvasId: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  copiedAt: number;
}

const initialState: CanvasSliceState = {
  canvases: [],
  activeCanvasId: null,
  selectedNodeIds: [],
  selectedEdgeIds: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  containerWidth: 800,
  containerHeight: 600,
  clipboard: null,
  loading: false,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findActiveCanvas(state: CanvasSliceState): Canvas | undefined {
  return state.canvases.find((c) => c.id === state.activeCanvasId);
}

function findCanvasById(state: CanvasSliceState, canvasId: string | null | undefined): Canvas | undefined {
  if (!canvasId) return undefined;
  return state.canvases.find((canvas) => canvas.id === canvasId);
}

function createDefaultPresetTracks(): PresetTrackSet {
  return createEmptyPresetTrackSet();
}

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createEntityId(prefix: 'node' | 'edge'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCanvasNodeType(canvas: Canvas, nodeId: string): CanvasNodeType | undefined {
  return canvas.nodes.find((node) => node.id === nodeId)?.type;
}

function getAutoEdgeLabel(
  sourceType: CanvasNodeType | undefined,
  targetType: CanvasNodeType | undefined,
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

function ensureEdgeLabel(canvas: Canvas, edge: CanvasEdge): CanvasEdge {
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

function buildCanvasClipboardPayload(
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

function createNodeRecord(payload: {
  id: string;
  type: CanvasNodeType;
  position: { x: number; y: number };
  title?: string;
  data?: CanvasNodeData;
  width?: number;
  height?: number;
}): CanvasNode {
  const now = Date.now();
  const defaultData: Record<CanvasNodeType, CanvasNodeData> = {
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
    status: 'idle',
    bypassed: false,
    locked: false,
    width: payload.width ?? (payload.type === 'backdrop' ? 420 : undefined),
    height: payload.height ?? (payload.type === 'backdrop' ? 240 : undefined),
    createdAt: now,
    updatedAt: now,
  };

  return node;
}

function pasteClipboardPayload(
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

  const typeById = new Map<string, CanvasNodeType>();
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

function ensureNodePresetTracks(node: CanvasNode): { presetTracks: TrackMap } {
  const data = node.data as {
    presetTracks?: Record<string, { category?: PresetCategory; aiDecide: boolean; entries: PresetTrackEntry[] }>;
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
        data.presetTracks[newCat] = { category: newCat, aiDecide: old.aiDecide, entries: [] };
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
      data.presetTracks[category] = { category, aiDecide: false, entries: [] };
      continue;
    }
    data.presetTracks[category].category = category;
  }
  return data as { presetTracks: TrackMap };
}

function normalizeTrackEntries(track: { entries: PresetTrackEntry[] }, category: PresetCategory): void {
  track.entries.forEach((entry: PresetTrackEntry, index: number) => {
    entry.category = category;
    entry.order = index;
  });
}

type GenerationNodeData = ImageNodeData | VideoNodeData | AudioNodeData;

function getGenerationNodeData(node: CanvasNode): GenerationNodeData | undefined {
  if (node.type === 'image' || node.type === 'video' || node.type === 'audio') {
    return node.data as GenerationNodeData;
  }
  return undefined;
}

function normalizeEquipmentRefs(refs: Array<EquipmentRef | string> | undefined): EquipmentRef[] {
  if (!Array.isArray(refs)) return [];
  const result: EquipmentRef[] = [];
  for (const ref of refs) {
    if (typeof ref === 'string') {
      const equipmentId = ref.trim();
      if (equipmentId && !result.some((r) => r.equipmentId === equipmentId)) {
        result.push({ equipmentId });
      }
    } else if (ref && typeof ref === 'object' && typeof ref.equipmentId === 'string' && ref.equipmentId.trim()) {
      const equipmentId = ref.equipmentId.trim();
      if (!result.some((r) => r.equipmentId === equipmentId)) {
        result.push({ equipmentId, angleSlot: ref.angleSlot, referenceImageHash: ref.referenceImageHash });
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const internalCanvasSlice = createSlice({
  name: 'canvas',
  initialState,
  reducers: {
    // --- Canvas-level actions -----------------------------------------------

    setCanvases(state, action: PayloadAction<Canvas[]>) {
      state.canvases = action.payload;
      // Correct activeCanvasId if it no longer exists in the new array
      const stillValid = action.payload.some((c) => c.id === state.activeCanvasId);
      if (!stillValid) {
        state.activeCanvasId = action.payload[0]?.id ?? null;
        state.selectedNodeIds = [];
        state.selectedEdgeIds = [];
      }
    },

    addCanvas(state, action: PayloadAction<Canvas>) {
      state.canvases.push(action.payload);
    },

    removeCanvas(state, action: PayloadAction<string>) {
      state.canvases = state.canvases.filter((c) => c.id !== action.payload);
      if (state.activeCanvasId === action.payload) {
        state.activeCanvasId = state.canvases[0]?.id ?? null;
      }
    },

    setActiveCanvas(state, action: PayloadAction<string | null>) {
      state.activeCanvasId = action.payload;
      state.selectedNodeIds = [];
      state.selectedEdgeIds = [];
      const canvas = findActiveCanvas(state);
      if (canvas) {
        state.viewport = canvas.viewport;
      }
    },

    renameCanvas(state, action: PayloadAction<{ id: string; name: string }>) {
      const canvas = state.canvases.find((c) => c.id === action.payload.id);
      if (canvas) {
        canvas.name = action.payload.name;
        canvas.updatedAt = Date.now();
      }
    },

    // --- Node actions -------------------------------------------------------

    addNode(
      state,
      action: PayloadAction<{
        type: CanvasNodeType;
        position: { x: number; y: number };
        id: string;
        title?: string;
        data?: CanvasNodeData;
        width?: number;
        height?: number;
      }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = createNodeRecord(action.payload);
      canvas.nodes.push(node);
      canvas.updatedAt = node.updatedAt;
    },

    removeNodes(state, action: PayloadAction<string[]>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const ids = new Set(action.payload);
      canvas.nodes = canvas.nodes.filter((n) => !ids.has(n.id));
      // Also remove edges connected to deleted nodes
      canvas.edges = canvas.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target));
      state.selectedNodeIds = state.selectedNodeIds.filter((id) => !ids.has(id));
      canvas.updatedAt = Date.now();
    },

    updateNode(state, action: PayloadAction<{ id: string; changes: Partial<CanvasNode> }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (node) {
        // Don't overwrite stored height for collapsed backdrops
        const changes = { ...action.payload.changes };
        if (
          node.type === 'backdrop' &&
          (node.data as BackdropNodeData).collapsed &&
          changes.height != null
        ) {
          delete changes.height;
        }
        Object.assign(node, changes);
        node.updatedAt = Date.now();
        canvas.updatedAt = node.updatedAt;
      }
    },

    updateNodeData(state, action: PayloadAction<{ id: string; data: Partial<CanvasNodeData> }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (node) {
        Object.assign(node.data, action.payload.data);
        node.updatedAt = Date.now();
        canvas.updatedAt = node.updatedAt;
      }
    },

    moveNode(state, action: PayloadAction<{ id: string; position: { x: number; y: number } }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (node && !node.locked) {
        node.position = action.payload.position;
        node.updatedAt = Date.now();
        canvas.updatedAt = node.updatedAt;
      }
    },

    renameNode(state, action: PayloadAction<{ id: string; title: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (node) {
        node.title = action.payload.title;
        node.updatedAt = Date.now();
        canvas.updatedAt = node.updatedAt;
      }
    },

    setNodeStatus(state, action: PayloadAction<{ id: string; status: NodeStatus }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (node) {
        node.status = action.payload.status;
        node.updatedAt = Date.now();
        canvas.updatedAt = node.updatedAt;
      }
    },

    setNodeGenerating(state, action: PayloadAction<{ id: string; jobId: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node) return;
      const data = getGenerationNodeData(node);
      if (!data) return;
      data.status = 'generating';
      data.progress = 0;
      data.error = undefined;
      data.jobId = action.payload.jobId;
      node.status = 'generating';
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setNodeProgress(state, action: PayloadAction<{ id: string; progress: number; currentStep?: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node) return;
      const data = getGenerationNodeData(node);
      if (!data) return;
      data.progress = Math.max(0, Math.min(100, action.payload.progress));
      if (action.payload.currentStep !== undefined) {
        data.currentStep = action.payload.currentStep;
      }
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    clearNodeGenerationStatus(state, action: PayloadAction<{ id: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node) return;
      const data = getGenerationNodeData(node);
      if (!data) return;
      data.status = 'empty';
      data.progress = undefined;
      data.error = undefined;
      data.currentStep = undefined;
      data.jobId = undefined;
      node.status = 'idle';
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setNodeGenerationComplete(
      state,
      action: PayloadAction<{
        id: string;
        variants: string[];
        primaryAssetHash: string;
        cost?: number;
        generationTimeMs: number;
      }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node) return;
      const data = getGenerationNodeData(node);
      if (!data) return;
      data.status = 'done';
      data.variants = action.payload.variants;
      data.selectedVariantIndex = 0;
      data.assetHash = action.payload.primaryAssetHash;
      data.progress = 100;
      data.error = undefined;
      data.generationTimeMs = action.payload.generationTimeMs;
      if (typeof action.payload.cost === 'number') {
        data.cost = action.payload.cost;
        data.estimatedCost = action.payload.cost;
      }
      node.status = 'done';
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setNodeGenerationFailed(state, action: PayloadAction<{ id: string; error: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node) return;
      const data = getGenerationNodeData(node);
      if (!data) return;
      data.status = 'failed';
      data.error = action.payload.error;
      data.progress = undefined;
      node.status = 'failed';
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    selectVariant(state, action: PayloadAction<{ id: string; index: number }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node) return;
      const data = getGenerationNodeData(node);
      if (!data || !Array.isArray(data.variants)) return;
      const { index } = action.payload;
      if (index < 0 || index >= data.variants.length) return;
      data.selectedVariantIndex = index;
      data.assetHash = data.variants[index];
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setNodeSeed(state, action: PayloadAction<{ id: string; seed: number | undefined }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node) return;
      const data = getGenerationNodeData(node);
      if (!data) return;
      data.seed = action.payload.seed;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setNodeResolution(
      state,
      action: PayloadAction<{ id: string; width: number; height: number }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = node.data as ImageNodeData | VideoNodeData;
      data.width = action.payload.width;
      data.height = action.payload.height;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setNodeDuration(state, action: PayloadAction<{ id: string; duration: number }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'video' && node.type !== 'audio')) return;
      const data = node.data as VideoNodeData | AudioNodeData;
      data.duration = action.payload.duration;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setNodeFps(state, action: PayloadAction<{ id: string; fps: number }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || node.type !== 'video') return;
      const data = node.data as VideoNodeData;
      data.fps = action.payload.fps;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    toggleSeedLock(state, action: PayloadAction<{ id: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node) return;
      const data = getGenerationNodeData(node);
      if (!data) return;
      data.seedLocked = !data.seedLocked;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    toggleBypass(state, action: PayloadAction<{ id: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node) return;
      node.bypassed = !node.bypassed;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setNodeColorTag(state, action: PayloadAction<{ id: string; colorTag: string | undefined }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node) return;
      node.colorTag = action.payload.colorTag;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    toggleLock(state, action: PayloadAction<{ id: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node) return;
      node.locked = !node.locked;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    toggleBackdropCollapse(state, action: PayloadAction<{ id: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || node.type !== 'backdrop') return;
      const data = node.data as BackdropNodeData;
      data.collapsed = !data.collapsed;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setBackdropOpacity(state, action: PayloadAction<{ id: string; opacity: number }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || node.type !== 'backdrop' || node.locked) return;
      const data = node.data as BackdropNodeData;
      data.opacity = Math.max(0.05, Math.min(1, action.payload.opacity));
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setBackdropColor(state, action: PayloadAction<{ id: string; color: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || node.type !== 'backdrop' || node.locked) return;
      const data = node.data as BackdropNodeData;
      data.color = action.payload.color;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setBackdropBorderStyle(state, action: PayloadAction<{ id: string; borderStyle: 'dashed' | 'solid' | 'dotted' }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || node.type !== 'backdrop') return;
      const data = node.data as BackdropNodeData;
      data.borderStyle = action.payload.borderStyle;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setBackdropTitleSize(state, action: PayloadAction<{ id: string; titleSize: 'sm' | 'md' | 'lg' }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || node.type !== 'backdrop') return;
      const data = node.data as BackdropNodeData;
      data.titleSize = action.payload.titleSize;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setBackdropLockChildren(state, action: PayloadAction<{ id: string; lockChildren: boolean }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || node.type !== 'backdrop') return;
      const data = node.data as BackdropNodeData;
      data.lockChildren = action.payload.lockChildren;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setNodeProvider(state, action: PayloadAction<{ id: string; providerId: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node) return;
      const data = getGenerationNodeData(node);
      if (!data) return;
      data.providerId = action.payload.providerId;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setNodeVariantCount(state, action: PayloadAction<{ id: string; count: number }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node) return;
      const data = getGenerationNodeData(node);
      if (!data) return;
      data.variantCount = action.payload.count;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setNodeEstimatedCost(state, action: PayloadAction<{ id: string; estimatedCost: number }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node) return;
      const data = getGenerationNodeData(node);
      if (!data) return;
      data.estimatedCost = action.payload.estimatedCost;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setNodeUploadedAsset(state, action: PayloadAction<{ id: string; assetHash: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = node.data as ImageNodeData | VideoNodeData;
      data.assetHash = action.payload.assetHash;
      data.status = 'done';
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    clearNodeAsset(state, action: PayloadAction<{ id: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = node.data as ImageNodeData | VideoNodeData;
      data.assetHash = undefined;
      data.status = 'empty';
      data.variants = [];
      data.selectedVariantIndex = 0;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setNodeTrackAiDecide(
      state,
      action: PayloadAction<{ id: string; category: PresetCategory; aiDecide: boolean }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = ensureNodePresetTracks(node);
      if (!data.presetTracks[action.payload.category]) {
        data.presetTracks[action.payload.category] = {
          category: action.payload.category,
          aiDecide: false,
          entries: [],
        };
      }
      const track = data.presetTracks[action.payload.category];
      track.aiDecide = action.payload.aiDecide;
      // Also set aiDecide on all entries in this track for Commander to read
      track.entries.forEach((entry) => {
        entry.aiDecide = action.payload.aiDecide;
      });
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setAllTracksAiDecide(state, action: PayloadAction<{ id: string; aiDecide: boolean }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = ensureNodePresetTracks(node);
      Object.values(data.presetTracks).forEach((track) => {
        track.aiDecide = action.payload.aiDecide;
        track.entries.forEach((entry) => {
          entry.aiDecide = action.payload.aiDecide;
        });
      });
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    applyNodeShotTemplate(
      state,
      action: PayloadAction<{ nodeId: string; template: ShotTemplate }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.nodeId);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = ensureNodePresetTracks(node);
      const { template } = action.payload;
      for (const cat of PRESET_CATEGORIES) {
        const tmplTrack = template.tracks[cat];
        if (tmplTrack) {
          (data.presetTracks as TrackMap)[cat] = {
            category: cat,
            aiDecide: false,
            intensity: tmplTrack.intensity,
            entries: tmplTrack.entries.map((e, i) => ({
              ...e,
              id: `tmpl-${cat}-${Date.now()}-${i}`,
              order: i,
            })),
          };
        }
      }
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setVideoFrameNode(
      state,
      action: PayloadAction<{ id: string; role: 'first' | 'last'; frameNodeId: string | undefined }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || node.type !== 'video') return;
      const data = node.data as import('@lucid-fin/contracts').VideoNodeData;
      if (action.payload.role === 'first') {
        data.firstFrameNodeId = action.payload.frameNodeId;
      } else {
        data.lastFrameNodeId = action.payload.frameNodeId;
      }
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    applyCanvasFromCommander(state, action: PayloadAction<Canvas>) {
      const incoming = action.payload;
      const index = state.canvases.findIndex((canvas) => canvas.id === incoming.id);
      if (index >= 0) {
        state.canvases[index] = incoming;
      } else {
        state.canvases.push(incoming);
      }
      if (state.activeCanvasId === incoming.id) {
        state.viewport = incoming.viewport;
      }
    },

    addNodePresetTrackEntry(
      state,
      action: PayloadAction<{ id: string; category: PresetCategory; entry: PresetTrackEntry }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = ensureNodePresetTracks(node);
      if (!data.presetTracks[action.payload.category]) {
        data.presetTracks[action.payload.category] = {
          category: action.payload.category,
          aiDecide: false,
          entries: [],
        };
      }
      const track = data.presetTracks[action.payload.category];
      track.entries.push({
        ...action.payload.entry,
        category: action.payload.category,
        order: track.entries.length,
      });
      normalizeTrackEntries(track, action.payload.category);
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    updateNodePresetTrackEntry(
      state,
      action: PayloadAction<{
        id: string;
        category: PresetCategory;
        entryId: string;
        changes: Partial<PresetTrackEntry>;
      }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = ensureNodePresetTracks(node);
      if (!data.presetTracks[action.payload.category]) {
        data.presetTracks[action.payload.category] = {
          category: action.payload.category,
          aiDecide: false,
          entries: [],
        };
      }
      const track = data.presetTracks[action.payload.category];
      const entry = track.entries.find((item) => item.id === action.payload.entryId);
      if (!entry) return;
      Object.assign(entry, action.payload.changes);
      normalizeTrackEntries(track, action.payload.category);
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    removeNodePresetTrackEntry(
      state,
      action: PayloadAction<{ id: string; category: PresetCategory; entryId: string }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = ensureNodePresetTracks(node);
      if (!data.presetTracks[action.payload.category]) {
        data.presetTracks[action.payload.category] = {
          category: action.payload.category,
          aiDecide: false,
          entries: [],
        };
      }
      const track = data.presetTracks[action.payload.category];
      track.entries = track.entries.filter((item) => item.id !== action.payload.entryId);
      normalizeTrackEntries(track, action.payload.category);
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    moveNodePresetTrackEntry(
      state,
      action: PayloadAction<{
        id: string;
        category: PresetCategory;
        entryId: string;
        direction: 'up' | 'down';
      }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = ensureNodePresetTracks(node);
      if (!data.presetTracks[action.payload.category]) {
        data.presetTracks[action.payload.category] = {
          category: action.payload.category,
          aiDecide: false,
          entries: [],
        };
      }
      const track = data.presetTracks[action.payload.category];
      const currentIndex = track.entries.findIndex((item) => item.id === action.payload.entryId);
      if (currentIndex === -1) return;
      const targetIndex =
        action.payload.direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= track.entries.length) return;
      const [moved] = track.entries.splice(currentIndex, 1);
      track.entries.splice(targetIndex, 0, moved);
      normalizeTrackEntries(track, action.payload.category);
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    // --- Character & Equipment Ref actions (image/video nodes only) ----------

    setNodeCharacterRefs(
      state,
      action: PayloadAction<{ id: string; characterRefs: CharacterRef[] }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      (node.data as ImageNodeData | VideoNodeData).characterRefs = action.payload.characterRefs;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    addNodeCharacterRef(
      state,
      action: PayloadAction<{ id: string; characterRef: CharacterRef }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = node.data as ImageNodeData | VideoNodeData;
      if (!data.characterRefs) data.characterRefs = [];
      // Avoid duplicates by characterId
      if (!data.characterRefs.some((r) => r.characterId === action.payload.characterRef.characterId)) {
        data.characterRefs.push(action.payload.characterRef);
      }
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    removeNodeCharacterRef(
      state,
      action: PayloadAction<{ id: string; characterId: string }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = node.data as ImageNodeData | VideoNodeData;
      if (!data.characterRefs) return;
      data.characterRefs = data.characterRefs.filter(
        (r) => r.characterId !== action.payload.characterId,
      );
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    updateNodeCharacterRef(
      state,
      action: PayloadAction<{ id: string; characterId: string; changes: Partial<CharacterRef> }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = node.data as ImageNodeData | VideoNodeData;
      if (!data.characterRefs) return;
      const ref = data.characterRefs.find((r) => r.characterId === action.payload.characterId);
      if (!ref) return;
      Object.assign(ref, action.payload.changes);
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setNodeEquipmentRefs(
      state,
      action: PayloadAction<{ id: string; equipmentRefs: Array<EquipmentRef | string> }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      (node.data as ImageNodeData | VideoNodeData).equipmentRefs = normalizeEquipmentRefs(action.payload.equipmentRefs);
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    addNodeEquipmentRef(
      state,
      action: PayloadAction<{ id: string; equipmentId: string; angleSlot?: string; referenceImageHash?: string }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = node.data as ImageNodeData | VideoNodeData;
      const refs = normalizeEquipmentRefs(data.equipmentRefs);
      if (!refs.some((r) => r.equipmentId === action.payload.equipmentId)) {
        refs.push({
          equipmentId: action.payload.equipmentId,
          angleSlot: action.payload.angleSlot,
          referenceImageHash: action.payload.referenceImageHash,
        });
      }
      data.equipmentRefs = refs;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    removeNodeEquipmentRef(
      state,
      action: PayloadAction<{ id: string; equipmentId: string }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = node.data as ImageNodeData | VideoNodeData;
      data.equipmentRefs = normalizeEquipmentRefs(data.equipmentRefs).filter(
        (r) => r.equipmentId !== action.payload.equipmentId,
      );
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    updateNodeEquipmentRef(
      state,
      action: PayloadAction<{ id: string; equipmentId: string; changes: Partial<EquipmentRef> }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = node.data as ImageNodeData | VideoNodeData;
      const refs = normalizeEquipmentRefs(data.equipmentRefs);
      const ref = refs.find((r) => r.equipmentId === action.payload.equipmentId);
      if (!ref) return;
      Object.assign(ref, action.payload.changes);
      data.equipmentRefs = refs;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    setNodeLocationRefs(
      state,
      action: PayloadAction<{ id: string; refs: LocationRef[] }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      (node.data as ImageNodeData | VideoNodeData).locationRefs = action.payload.refs;
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    addNodeLocationRef(
      state,
      action: PayloadAction<{ id: string; locationId: string }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = node.data as ImageNodeData | VideoNodeData;
      if (!data.locationRefs) data.locationRefs = [];
      if (!data.locationRefs.some((r) => r.locationId === action.payload.locationId)) {
        data.locationRefs.push({ locationId: action.payload.locationId });
      }
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    removeNodeLocationRef(
      state,
      action: PayloadAction<{ id: string; locationId: string }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const node = canvas.nodes.find((n) => n.id === action.payload.id);
      if (!node || (node.type !== 'image' && node.type !== 'video')) return;
      const data = node.data as ImageNodeData | VideoNodeData;
      if (!data.locationRefs) return;
      data.locationRefs = data.locationRefs.filter(
        (r) => r.locationId !== action.payload.locationId,
      );
      node.updatedAt = Date.now();
      canvas.updatedAt = node.updatedAt;
    },

    duplicateNode(state, action: PayloadAction<{ sourceId: string; newId: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const source = canvas.nodes.find((n) => n.id === action.payload.sourceId);
      if (!source) return;
      const now = Date.now();
      const clone: CanvasNode = {
        ...(JSON.parse(JSON.stringify(current(source))) as CanvasNode),
        id: action.payload.newId,
        position: { x: source.position.x + 40, y: source.position.y + 40 },
        createdAt: now,
        updatedAt: now,
      };
      canvas.nodes.push(clone);
      canvas.updatedAt = now;
    },

    copyNodes(state, action: PayloadAction<string[] | undefined>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const payload = buildCanvasClipboardPayload(canvas, action.payload ?? state.selectedNodeIds);
      if (payload) {
        state.clipboard = payload;
      }
    },

    setClipboard(state, action: PayloadAction<CanvasClipboardPayload | null>) {
      state.clipboard = action.payload;
    },

    pasteNodes(
      state,
      action: PayloadAction<
        | {
            targetCanvasId?: string;
            offset?: { x: number; y: number };
          }
        | undefined
      >,
    ) {
      const clipboard = state.clipboard;
      if (!clipboard) return;
      const canvas =
        findCanvasById(state, action.payload?.targetCanvasId) ?? findActiveCanvas(state);
      if (!canvas) return;

      const { nodes, edges } = pasteClipboardPayload(canvas, clipboard, action.payload?.offset ?? { x: 50, y: 50 });
      if (nodes.length === 0) return;

      canvas.nodes.push(...nodes);
      canvas.edges.push(...edges);
      canvas.updatedAt = Date.now();
      state.selectedNodeIds = nodes.map((node) => node.id);
      state.selectedEdgeIds = edges.map((edge) => edge.id);
    },

    duplicateNodes(state, action: PayloadAction<string[] | undefined>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;

      const clipboard = buildCanvasClipboardPayload(canvas, action.payload ?? state.selectedNodeIds);
      if (!clipboard) return;

      state.clipboard = clipboard;
      const { nodes, edges } = pasteClipboardPayload(canvas, clipboard, { x: 40, y: 40 });
      canvas.nodes.push(...nodes);
      canvas.edges.push(...edges);
      canvas.updatedAt = Date.now();
      state.selectedNodeIds = nodes.map((node) => node.id);
      state.selectedEdgeIds = edges.map((edge) => edge.id);
    },

    // --- Edge actions -------------------------------------------------------

    addEdge(state, action: PayloadAction<CanvasEdge>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const edge = ensureEdgeLabel(canvas, action.payload);
      // Prevent duplicate edges
      const exists = canvas.edges.some(
        (e) =>
          e.source === edge.source &&
          e.target === edge.target &&
          e.sourceHandle === edge.sourceHandle &&
          e.targetHandle === edge.targetHandle,
      );
      if (!exists) {
        canvas.edges.push(edge);
        canvas.updatedAt = Date.now();
      }
    },

    removeEdges(state, action: PayloadAction<string[]>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const ids = new Set(action.payload);
      // Collect edges being removed to clear firstFrameNodeId/lastFrameNodeId refs
      const removedEdges = canvas.edges.filter((e) => ids.has(e.id));
      canvas.edges = canvas.edges.filter((e) => !ids.has(e.id));
      state.selectedEdgeIds = state.selectedEdgeIds.filter((id) => !ids.has(id));
      // Clear frame node refs on video nodes when the connected edge is removed
      for (const edge of removedEdges) {
        const targetNode = canvas.nodes.find((n) => n.id === edge.target);
        if (targetNode?.type === 'video') {
          const data = targetNode.data as import('@lucid-fin/contracts').VideoNodeData;
          if (data.firstFrameNodeId === edge.source) data.firstFrameNodeId = undefined;
        }
        const sourceNode = canvas.nodes.find((n) => n.id === edge.source);
        if (sourceNode?.type === 'video') {
          const data = sourceNode.data as import('@lucid-fin/contracts').VideoNodeData;
          if (data.lastFrameNodeId === edge.target) data.lastFrameNodeId = undefined;
        }
      }
      canvas.updatedAt = Date.now();
    },

    updateEdge(state, action: PayloadAction<{ id: string; changes: Partial<CanvasEdge> }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const edge = canvas.edges.find((e) => e.id === action.payload.id);
      if (edge) {
        Object.assign(edge, action.payload.changes);
        canvas.updatedAt = Date.now();
      }
    },

    setEdgeStatus(state, action: PayloadAction<{ id: string; status: EdgeStatus }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const edge = canvas.edges.find((e) => e.id === action.payload.id);
      if (edge) {
        edge.data.status = action.payload.status;
        canvas.updatedAt = Date.now();
      }
    },

    swapEdgeDirection(state, action: PayloadAction<string>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const edge = canvas.edges.find((e) => e.id === action.payload);
      if (edge) {
        const tmp = edge.source;
        edge.source = edge.target;
        edge.target = tmp;
        const tmpH = edge.sourceHandle;
        edge.sourceHandle = edge.targetHandle;
        edge.targetHandle = tmpH;
        if (edge.data.autoLabel) {
          edge.data.label = getAutoEdgeLabel(
            getCanvasNodeType(canvas, edge.source),
            getCanvasNodeType(canvas, edge.target),
          );
        }
        canvas.updatedAt = Date.now();
      }
    },

    disconnectNode(state, action: PayloadAction<string>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      canvas.edges = canvas.edges.filter(
        (e) => e.source !== action.payload && e.target !== action.payload,
      );
      canvas.updatedAt = Date.now();
    },

    insertNodeIntoEdge(
      state,
      action: PayloadAction<{
        edgeId: string;
        nodeType: CanvasNodeType;
        position: { x: number; y: number };
        title?: string;
        data?: CanvasNodeData;
        id?: string;
        width?: number;
        height?: number;
      }>,
    ) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;

      const edgeIndex = canvas.edges.findIndex((edge) => edge.id === action.payload.edgeId);
      if (edgeIndex === -1) return;

      const edge = canvas.edges[edgeIndex]!;
      const insertedNode = createNodeRecord({
        id: action.payload.id ?? createEntityId('node'),
        type: action.payload.nodeType,
        position: action.payload.position,
        title: action.payload.title,
        data: action.payload.data,
        width: action.payload.width,
        height: action.payload.height,
      });

      canvas.nodes.push(insertedNode);
      canvas.edges.splice(edgeIndex, 1);

      const status = edge.data.status;
      canvas.edges.push(
        {
          id: createEntityId('edge'),
          source: edge.source,
          target: insertedNode.id,
          sourceHandle: edge.sourceHandle,
          data: {
            status,
            label: getAutoEdgeLabel(getCanvasNodeType(canvas, edge.source), insertedNode.type),
            autoLabel: true,
          },
        },
        {
          id: createEntityId('edge'),
          source: insertedNode.id,
          target: edge.target,
          targetHandle: edge.targetHandle,
          data: {
            status,
            label: getAutoEdgeLabel(insertedNode.type, getCanvasNodeType(canvas, edge.target)),
            autoLabel: true,
          },
        },
      );

      canvas.updatedAt = Date.now();
      state.selectedNodeIds = [insertedNode.id];
      state.selectedEdgeIds = [];
    },

    // --- Selection -----------------------------------------------------------

    setSelection(state, action: PayloadAction<{ nodeIds: string[]; edgeIds: string[] }>) {
      state.selectedNodeIds = action.payload.nodeIds;
      state.selectedEdgeIds = action.payload.edgeIds;
    },

    clearSelection(state) {
      state.selectedNodeIds = [];
      state.selectedEdgeIds = [];
    },

    // --- Viewport ------------------------------------------------------------

    updateViewport(state, action: PayloadAction<CanvasViewport>) {
      state.viewport = action.payload;
      const canvas = findActiveCanvas(state);
      if (canvas) {
        canvas.viewport = action.payload;
      }
    },

    updateContainerSize(state, action: PayloadAction<{ width: number; height: number }>) {
      state.containerWidth = action.payload.width;
      state.containerHeight = action.payload.height;
    },

    // --- Loading -------------------------------------------------------------

    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },

    // --- Canvas Notes --------------------------------------------------------

    addCanvasNote(state, action: PayloadAction<{ content?: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const now = Date.now();
      const note: CanvasNote = {
        id: `note-${now}-${Math.random().toString(36).slice(2, 8)}`,
        content: action.payload.content ?? '',
        createdAt: now,
        updatedAt: now,
      };
      canvas.notes.push(note);
      canvas.updatedAt = now;
    },

    updateCanvasNote(state, action: PayloadAction<{ id: string; content: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const note = canvas.notes.find((n) => n.id === action.payload.id);
      if (note) {
        note.content = action.payload.content;
        note.updatedAt = Date.now();
        canvas.updatedAt = note.updatedAt;
      }
    },

    deleteCanvasNote(state, action: PayloadAction<{ id: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      canvas.notes = canvas.notes.filter((n) => n.id !== action.payload.id);
      canvas.updatedAt = Date.now();
    },

    // --- Undo support --------------------------------------------------------

    restore(_state, action: PayloadAction<CanvasSliceState>) {
      return action.payload;
    },
  },
});

export const canvasReducer: Reducer<CanvasSliceState> = internalCanvasSlice.reducer;
export const canvasSlice: {
  reducer: Reducer<CanvasSliceState>;
  actions: {
    setCanvases: ActionCreatorWithPayload<Canvas[]>;
  };
} = {
  reducer: internalCanvasSlice.reducer,
  actions: {
    setCanvases: internalCanvasSlice.actions.setCanvases,
  },
};

export const {
  setCanvases,
  addCanvas,
  removeCanvas,
  setActiveCanvas,
  renameCanvas,
  addNode,
  removeNodes,
  updateNode,
  updateNodeData,
  moveNode,
  renameNode,
  setNodeStatus,
  setNodeGenerating,
  setNodeProgress,
  clearNodeGenerationStatus,
  setNodeGenerationComplete,
  setNodeGenerationFailed,
  selectVariant,
  setNodeSeed,
  setNodeResolution,
  setNodeDuration,
  setNodeFps,
  toggleSeedLock,
  toggleBypass,
  setNodeColorTag,
  toggleLock,
  toggleBackdropCollapse,
  setBackdropOpacity,
  setBackdropColor,
  setBackdropBorderStyle,
  setBackdropTitleSize,
  setBackdropLockChildren,
  setNodeProvider,
  setNodeVariantCount,
  setNodeEstimatedCost,
  setNodeUploadedAsset,
  clearNodeAsset,
  setNodeTrackAiDecide,
  setAllTracksAiDecide,
  applyNodeShotTemplate,
  setVideoFrameNode,
  applyCanvasFromCommander,
  addNodePresetTrackEntry,
  updateNodePresetTrackEntry,
  removeNodePresetTrackEntry,
  moveNodePresetTrackEntry,
  setNodeCharacterRefs,
  addNodeCharacterRef,
  removeNodeCharacterRef,
  updateNodeCharacterRef,
  setNodeEquipmentRefs,
  addNodeEquipmentRef,
  removeNodeEquipmentRef,
  updateNodeEquipmentRef,
  setNodeLocationRefs,
  addNodeLocationRef,
  removeNodeLocationRef,
  duplicateNode,
  copyNodes,
  setClipboard,
  pasteNodes,
  duplicateNodes,
  addEdge,
  removeEdges,
  updateEdge,
  setEdgeStatus,
  swapEdgeDirection,
  disconnectNode,
  insertNodeIntoEdge,
  setSelection,
  clearSelection,
  updateViewport,
  updateContainerSize,
  setLoading,
  addCanvasNote,
  updateCanvasNote,
  deleteCanvasNote,
} = internalCanvasSlice.actions;
