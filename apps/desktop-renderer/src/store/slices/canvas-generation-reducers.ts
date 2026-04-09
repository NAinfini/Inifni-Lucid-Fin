import type { PayloadAction } from '@reduxjs/toolkit';
import type {
  ImageNodeData,
  VideoNodeData,
  AudioNodeData,
} from '@lucid-fin/contracts';
import type { CanvasSliceState } from './canvas.js';
import { findActiveCanvas, getGenerationNodeData } from './canvas-helpers.js';

// ---------------------------------------------------------------------------
// Generation lifecycle
// ---------------------------------------------------------------------------

export function setNodeGenerating(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; jobId: string }>,
): void {
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
}

export function setNodeProgress(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; progress: number; currentStep?: string }>,
): void {
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
}

export function clearNodeGenerationStatus(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string }>,
): void {
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
}

export function setNodeGenerationComplete(
  state: CanvasSliceState,
  action: PayloadAction<{
    id: string;
    variants: string[];
    primaryAssetHash: string;
    cost?: number;
    generationTimeMs: number;
  }>,
): void {
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
}

export function setNodeGenerationFailed(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; error: string }>,
): void {
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
}

// ---------------------------------------------------------------------------
// Variant selection
// ---------------------------------------------------------------------------

export function selectVariant(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; index: number }>,
): void {
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
}

// ---------------------------------------------------------------------------
// Seed / resolution / duration / fps
// ---------------------------------------------------------------------------

export function setNodeSeed(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; seed: number | undefined }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node) return;
  const data = getGenerationNodeData(node);
  if (!data) return;
  data.seed = action.payload.seed;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setNodeResolution(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; width: number; height: number }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = node.data as ImageNodeData | VideoNodeData;
  data.width = action.payload.width;
  data.height = action.payload.height;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setNodeDuration(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; duration: number }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'video' && node.type !== 'audio')) return;
  const data = node.data as VideoNodeData | AudioNodeData;
  data.duration = action.payload.duration;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setNodeFps(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; fps: number }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || node.type !== 'video') return;
  const data = node.data as VideoNodeData;
  data.fps = action.payload.fps;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function toggleSeedLock(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node) return;
  const data = getGenerationNodeData(node);
  if (!data) return;
  data.seedLocked = !data.seedLocked;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}
