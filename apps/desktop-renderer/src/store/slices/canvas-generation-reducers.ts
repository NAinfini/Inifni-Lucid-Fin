import type { PayloadAction } from '@reduxjs/toolkit';
import type {
  ImageNodeData,
  VideoNodeData,
  AudioNodeData,
  GenerationHistoryEntry,
  NodeAnnotation,
} from '@lucid-fin/contracts';
import type { CanvasSliceState } from './canvas.js';
import { findActiveCanvas, getGenerationNodeData } from './canvas-helpers.js';

const MAX_VARIANTS = 20;
const MAX_GENERATION_HISTORY = 50;

/**
 * Append new variants to existing ones, deduplicate, enforce cap.
 * Returns the merged list and the index of the first new variant.
 */
function mergeVariants(
  existing: string[],
  incoming: string[],
  primaryAssetHash: string,
): { variants: string[]; selectedVariantIndex: number } {
  const seen = new Set(existing);
  const newHashes = incoming.filter((h) => {
    if (seen.has(h)) return false;
    seen.add(h);
    return true;
  });
  // Ensure primaryAssetHash is included
  if (!seen.has(primaryAssetHash)) {
    newHashes.push(primaryAssetHash);
  }
  let merged = [...existing, ...newHashes];
  // Trim oldest if over cap
  if (merged.length > MAX_VARIANTS) {
    merged = merged.slice(merged.length - MAX_VARIANTS);
  }
  // Select the first newly added variant
  const firstNewIndex = merged.indexOf(newHashes[0] ?? primaryAssetHash);
  return {
    variants: merged,
    selectedVariantIndex: firstNewIndex >= 0 ? firstNewIndex : 0,
  };
}

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
  const nextVariants = mergeVariants(
    data.variants ?? [],
    action.payload.variants,
    action.payload.primaryAssetHash,
  );
  data.status = 'done';
  data.variants = nextVariants.variants;
  data.selectedVariantIndex = nextVariants.selectedVariantIndex;
  data.variantCount = nextVariants.variants.length;
  data.assetHash = data.variants[data.selectedVariantIndex];
  data.progress = 100;
  data.error = undefined;
  data.generationTimeMs = action.payload.generationTimeMs;
  if (typeof action.payload.cost === 'number') {
    data.cost = action.payload.cost;
    data.estimatedCost = action.payload.cost;
  }
  // Append to generation history
  if ('generationHistory' in data) {
    const history = (data as ImageNodeData | VideoNodeData | AudioNodeData).generationHistory ?? [];
    const entry: GenerationHistoryEntry = {
      assetHash: action.payload.primaryAssetHash,
      prompt: data.prompt ?? '',
      providerId: data.providerId ?? '',
      seed: data.seed,
      negativePrompt: 'negativePrompt' in data ? (data as ImageNodeData).negativePrompt : undefined,
      cost: action.payload.cost,
      generationTimeMs: action.payload.generationTimeMs,
      createdAt: Date.now(),
    };
    history.push(entry);
    if (history.length > MAX_GENERATION_HISTORY) {
      history.splice(0, history.length - MAX_GENERATION_HISTORY);
    }
    (data as ImageNodeData | VideoNodeData | AudioNodeData).generationHistory = history;
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
// Delete variant
// ---------------------------------------------------------------------------

export function deleteVariant(
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
  data.variants.splice(index, 1);
  if (data.variants.length === 0) {
    data.status = 'empty';
    data.assetHash = undefined;
    data.selectedVariantIndex = 0;
  } else {
    if (data.selectedVariantIndex >= data.variants.length) {
      data.selectedVariantIndex = data.variants.length - 1;
    } else if (data.selectedVariantIndex > index) {
      data.selectedVariantIndex -= 1;
    } else if (data.selectedVariantIndex === index) {
      data.selectedVariantIndex = Math.min(index, data.variants.length - 1);
    }
    data.assetHash = data.variants[data.selectedVariantIndex];
  }
  data.variantCount = data.variants.length;
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

// ---------------------------------------------------------------------------
// Node annotation (M7)
// ---------------------------------------------------------------------------

export function setNodeAnnotation(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; annotation: NodeAnnotation | undefined }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node) return;
  const data = getGenerationNodeData(node);
  if (!data) return;
  (data as ImageNodeData | VideoNodeData | AudioNodeData).annotation = action.payload.annotation;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

// ---------------------------------------------------------------------------
// Node tags & grouping (M9)
// ---------------------------------------------------------------------------

export function setNodeTags(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; tags: string[] }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node) return;
  node.tags = action.payload.tags;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function addNodeTag(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; tag: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node) return;
  const tags = node.tags ?? [];
  if (!tags.includes(action.payload.tag)) {
    tags.push(action.payload.tag);
  }
  node.tags = tags;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function removeNodeTag(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; tag: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node) return;
  node.tags = (node.tags ?? []).filter((t) => t !== action.payload.tag);
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setNodeGroupId(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; groupId: string | undefined }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node) return;
  node.groupId = action.payload.groupId;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

// ---------------------------------------------------------------------------
// Advanced generation parameters (L17)
// ---------------------------------------------------------------------------

export function setNodeAdvancedParams(
  state: CanvasSliceState,
  action: PayloadAction<{
    id: string;
    negativePrompt?: string;
    steps?: number;
    cfgScale?: number;
    scheduler?: string;
    img2imgStrength?: number;
  }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = node.data as ImageNodeData | VideoNodeData;
  if (action.payload.negativePrompt !== undefined) data.negativePrompt = action.payload.negativePrompt;
  if (action.payload.steps !== undefined) data.steps = action.payload.steps;
  if (action.payload.cfgScale !== undefined) data.cfgScale = action.payload.cfgScale;
  if (action.payload.scheduler !== undefined) data.scheduler = action.payload.scheduler;
  if (action.payload.img2imgStrength !== undefined) data.img2imgStrength = action.payload.img2imgStrength;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

// ---------------------------------------------------------------------------
// Dual prompt system (F9)
// ---------------------------------------------------------------------------

export function setNodeImagePrompt(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; imagePrompt: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = node.data as ImageNodeData | VideoNodeData;
  data.imagePrompt = action.payload.imagePrompt;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setNodeVideoPrompt(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; videoPrompt: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = node.data as ImageNodeData | VideoNodeData;
  data.videoPrompt = action.payload.videoPrompt;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setNodeSourceImage(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; sourceImageHash: string | undefined }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = node.data as ImageNodeData | VideoNodeData;
  data.sourceImageHash = action.payload.sourceImageHash;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setNodeFaceReferences(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; faceReferenceHashes: string[] }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = node.data as ImageNodeData | VideoNodeData;
  data.faceReferenceHashes = action.payload.faceReferenceHashes;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

// ---------------------------------------------------------------------------
// Node duration / scene metadata for NLE export (L19)
// ---------------------------------------------------------------------------

export function setNodeDurationOverride(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; durationOverride: number | undefined }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || node.type !== 'video') return;
  const data = node.data as VideoNodeData;
  data.durationOverride = action.payload.durationOverride;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setNodeSceneMetadata(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; sceneNumber?: string; shotOrder?: number }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || node.type !== 'video') return;
  const data = node.data as VideoNodeData;
  if (action.payload.sceneNumber !== undefined) data.sceneNumber = action.payload.sceneNumber;
  if (action.payload.shotOrder !== undefined) data.shotOrder = action.payload.shotOrder;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

// ---------------------------------------------------------------------------
// Clear generation history (M10)
// ---------------------------------------------------------------------------

export function clearGenerationHistory(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node) return;
  const data = getGenerationNodeData(node);
  if (!data) return;
  (data as ImageNodeData | VideoNodeData | AudioNodeData).generationHistory = [];
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

// ---------------------------------------------------------------------------
// Lip Sync (F2)
// ---------------------------------------------------------------------------

export function setNodeLipSync(
  state: CanvasSliceState,
  action: PayloadAction<{ nodeId: string; enabled: boolean }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.nodeId);
  if (!node || node.type !== 'video') return;
  const data = node.data as VideoNodeData;
  data.lipSyncEnabled = action.payload.enabled;
  canvas.updatedAt = Date.now();
}
