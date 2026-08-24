export type AssetType = 'image' | 'video' | 'audio';

import type { ResolutionAudit } from './resolution.js';
import type { VisualStyleProvenance } from './visual-style.js';

/** Entity reference snapshot captured at generation time. */
export interface GenerationEntityRef {
  entityId: string;
  imageHashes: string[];
}

/** Structured generation metadata stored alongside assets in the DB. */
export interface AssetGenerationMetadata {
  prompt: string;
  negativePrompt?: string;
  provider: string;
  seed?: number;
  width?: number;
  height?: number;
  sourceImageHash?: string;
  characterRefs?: GenerationEntityRef[];
  equipmentRefs?: GenerationEntityRef[];
  locationRefs?: GenerationEntityRef[];
  frameReferenceHashes?: { first?: string; last?: string };
  steps?: number;
  cfgScale?: number;
  scheduler?: string;
  img2imgStrength?: number;
  model?: string;
  generationTimeMs?: number;
  cost?: number;
  /** Persistent production-media provenance. */
  taskListId?: string;
  taskId?: string;
  attemptId?: string;
  /** Exact Commander-owned prompt assembly used for this generated asset. */
  promptAssemblyId?: string;
  specHash?: string;
  promptHash?: string;
  referenceAssetHashes?: string[];
  estimatedCostUsd?: number;
  reportedActualCostUsd?: number;
  resolution?: ResolutionAudit;
  /** Exact style authority used to compile this provider request. */
  visualStyle?: VisualStyleProvenance;
  /** Timestamped evaluation-frame provenance. */
  sourceVideoHash?: string;
  timestampSeconds?: number;
  rubricVersion?: string;
}

export interface AssetMeta {
  hash: string;
  type: AssetType;
  format: string;
  originalName: string;
  fileSize: number;
  width?: number;
  height?: number;
  duration?: number;
  /** Authoritative probe result for video content. Undefined for non-video or not yet probed. */
  hasAudio?: boolean;
  prompt?: string;
  provider?: string;
  createdAt: number;
  generationMetadata?: AssetGenerationMetadata;
}

/** A user-managed library entry pointing at immutable CAS content. */
export interface AssetEntry extends Omit<AssetMeta, 'createdAt'> {
  id: string;
  displayName: string;
  tags: string[];
  folderId: string | null;
  /** When this logical library entry was created. */
  createdAt: number;
  /** When the underlying CAS content was first recorded. */
  contentCreatedAt: number;
}

export interface AssetRef {
  hash: string;
  type: AssetType;
  format: string;
  path: string;
}
