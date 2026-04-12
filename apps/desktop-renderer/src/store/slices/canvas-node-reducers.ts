import type { PayloadAction } from '@reduxjs/toolkit';
import type {
  CanvasNodeType,
  CanvasNodeData,
  NodeStatus,
  BackdropNodeData,
  ImageNodeData,
  VideoNodeData,
} from '@lucid-fin/contracts';
import type { CanvasSliceState } from './canvas.js';
import {
  findActiveCanvas,
  createNodeRecord,
  getGenerationNodeData,
} from './canvas-helpers.js';

// ---------------------------------------------------------------------------
// Node CRUD
// ---------------------------------------------------------------------------

export function addNode(
  state: CanvasSliceState,
  action: PayloadAction<{
    type: CanvasNodeType;
    position: { x: number; y: number };
    id: string;
    title?: string;
    data?: CanvasNodeData;
    width?: number;
    height?: number;
  }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = createNodeRecord(action.payload);
  canvas.nodes.push(node);
  canvas.updatedAt = node.updatedAt;
}

export function removeNodes(state: CanvasSliceState, action: PayloadAction<string[]>): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const ids = new Set(action.payload);
  canvas.nodes = canvas.nodes.filter((n) => !ids.has(n.id));
  canvas.edges = canvas.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target));
  state.selectedNodeIds = state.selectedNodeIds.filter((id) => !ids.has(id));
  canvas.updatedAt = Date.now();
}

export function updateNode(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; changes: Partial<import('@lucid-fin/contracts').CanvasNode> }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (node) {
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
}

export function updateNodeData(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; data: Partial<CanvasNodeData> }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (node) {
    Object.assign(node.data, action.payload.data);
    node.updatedAt = Date.now();
    canvas.updatedAt = node.updatedAt;
  }
}

export function moveNode(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; position: { x: number; y: number } }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (node && !node.locked) {
    node.position = action.payload.position;
    node.updatedAt = Date.now();
    canvas.updatedAt = node.updatedAt;
  }
}

export function moveNodes(
  state: CanvasSliceState,
  action: PayloadAction<Array<{ id: string; position: { x: number; y: number } }>>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const now = Date.now();
  for (const { id, position } of action.payload) {
    const node = canvas.nodes.find((n) => n.id === id);
    if (node && !node.locked) {
      node.position = position;
      node.updatedAt = now;
    }
  }
  canvas.updatedAt = now;
}

export function renameNode(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; title: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (node) {
    node.title = action.payload.title;
    node.updatedAt = Date.now();
    canvas.updatedAt = node.updatedAt;
  }
}

export function setNodeStatus(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; status: NodeStatus }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (node) {
    node.status = action.payload.status;
    node.updatedAt = Date.now();
    canvas.updatedAt = node.updatedAt;
  }
}

// ---------------------------------------------------------------------------
// Node toggle / property actions
// ---------------------------------------------------------------------------

export function toggleBypass(state: CanvasSliceState, action: PayloadAction<{ id: string }>): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node) return;
  node.bypassed = !node.bypassed;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setNodeColorTag(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; colorTag: string | undefined }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node) return;
  node.colorTag = action.payload.colorTag;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function toggleLock(state: CanvasSliceState, action: PayloadAction<{ id: string }>): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node) return;
  node.locked = !node.locked;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

// ---------------------------------------------------------------------------
// Backdrop-specific
// ---------------------------------------------------------------------------

export function toggleBackdropCollapse(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || node.type !== 'backdrop') return;
  const data = node.data as BackdropNodeData;
  data.collapsed = !data.collapsed;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setBackdropOpacity(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; opacity: number }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || node.type !== 'backdrop' || node.locked) return;
  const data = node.data as BackdropNodeData;
  data.opacity = Math.max(0.05, Math.min(1, action.payload.opacity));
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setBackdropColor(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; color: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || node.type !== 'backdrop' || node.locked) return;
  const data = node.data as BackdropNodeData;
  data.color = action.payload.color;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setBackdropBorderStyle(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; borderStyle: 'dashed' | 'solid' | 'dotted' }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || node.type !== 'backdrop') return;
  const data = node.data as BackdropNodeData;
  data.borderStyle = action.payload.borderStyle;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setBackdropTitleSize(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; titleSize: 'sm' | 'md' | 'lg' }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || node.type !== 'backdrop') return;
  const data = node.data as BackdropNodeData;
  data.titleSize = action.payload.titleSize;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setBackdropLockChildren(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; lockChildren: boolean }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || node.type !== 'backdrop') return;
  const data = node.data as BackdropNodeData;
  data.lockChildren = action.payload.lockChildren;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

// ---------------------------------------------------------------------------
// Provider / variant / upload
// ---------------------------------------------------------------------------

export function setNodeProvider(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; providerId: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node) return;
  const data = getGenerationNodeData(node);
  if (!data) return;
  data.providerId = action.payload.providerId;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setNodeVariantCount(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; count: number }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node) return;
  const data = getGenerationNodeData(node);
  if (!data) return;
  data.variantCount = action.payload.count;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setNodeEstimatedCost(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; estimatedCost: number }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node) return;
  const data = getGenerationNodeData(node);
  if (!data) return;
  data.estimatedCost = action.payload.estimatedCost;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setNodeUploadedAsset(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; assetHash: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = node.data as ImageNodeData | VideoNodeData;
  data.assetHash = action.payload.assetHash;
  data.status = 'done';
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function clearNodeAsset(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string }>,
): void {
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
}

// ---------------------------------------------------------------------------
// Video audio / quality
// ---------------------------------------------------------------------------

export function setNodeAudio(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; audio: boolean }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || node.type !== 'video') return;
  const data = node.data as import('@lucid-fin/contracts').VideoNodeData;
  data.audio = action.payload.audio;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setNodeQuality(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; quality: 'standard' | 'pro' | undefined }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || node.type !== 'video') return;
  const data = node.data as import('@lucid-fin/contracts').VideoNodeData;
  data.quality = action.payload.quality;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

// ---------------------------------------------------------------------------
// Video frame node
// ---------------------------------------------------------------------------

export function setVideoFrameNode(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; role: 'first' | 'last'; frameNodeId: string | undefined }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || node.type !== 'video') return;
  const data = node.data as import('@lucid-fin/contracts').VideoNodeData;
  if (action.payload.role === 'first') {
    data.firstFrameNodeId = action.payload.frameNodeId;
    data.firstFrameAssetHash = undefined;
  } else {
    data.lastFrameNodeId = action.payload.frameNodeId;
    data.lastFrameAssetHash = undefined;
  }
  if (!action.payload.frameNodeId) {
    if (action.payload.role === 'first') {
      data.firstFrameAssetHash = undefined;
    } else {
      data.lastFrameAssetHash = undefined;
    }
  }
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setVideoFrameAsset(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; role: 'first' | 'last'; assetHash: string | undefined }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || node.type !== 'video') return;
  const data = node.data as import('@lucid-fin/contracts').VideoNodeData;
  if (action.payload.role === 'first') {
    data.firstFrameAssetHash = action.payload.assetHash;
    data.firstFrameNodeId = undefined;
  } else {
    data.lastFrameAssetHash = action.payload.assetHash;
    data.lastFrameNodeId = undefined;
  }
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

// ---------------------------------------------------------------------------
// Undo-restore support
// ---------------------------------------------------------------------------

/**
 * Restores nodes (and their associated edges) that were removed.
 * Used as the inverse action for `removeNodes`.
 */
export function restoreNodes(
  state: CanvasSliceState,
  action: PayloadAction<{ nodes: import('@lucid-fin/contracts').CanvasNode[]; edges: import('@lucid-fin/contracts').CanvasEdge[] }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const existingNodeIds = new Set(canvas.nodes.map((n) => n.id));
  for (const node of action.payload.nodes) {
    if (!existingNodeIds.has(node.id)) {
      canvas.nodes.push(node);
    }
  }
  const existingEdgeIds = new Set(canvas.edges.map((e) => e.id));
  for (const edge of action.payload.edges) {
    if (!existingEdgeIds.has(edge.id)) {
      canvas.edges.push(edge);
    }
  }
  canvas.updatedAt = Date.now();
}

// ---------------------------------------------------------------------------
// Commander canvas apply
// ---------------------------------------------------------------------------
