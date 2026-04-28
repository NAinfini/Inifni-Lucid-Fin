export type AssetType = 'image' | 'video' | 'audio';

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
  prompt?: string;
  provider?: string;
  tags: string[];
  folderId?: string | null;
  createdAt: number;
  generationMetadata?: AssetGenerationMetadata;
}

export interface AssetRef {
  hash: string;
  type: AssetType;
  format: string;
  path: string;
}
