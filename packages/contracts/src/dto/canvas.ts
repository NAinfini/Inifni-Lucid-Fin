import type { PresetTrackSet } from './presets.js';
import type { CharacterRef } from './character.js';
import type { EquipmentRef } from './equipment.js';
import type { LocationRef } from './location.js';

// ---------------------------------------------------------------------------
// Canvas DTOs — shared between main and renderer
// ---------------------------------------------------------------------------

export type CanvasNodeType = 'text' | 'image' | 'video' | 'audio' | 'backdrop';

export type MediaNodeStatus = 'empty' | 'generating' | 'done' | 'failed';

export type NodeStatus =
  | 'idle'
  | 'queued'
  | 'generating'
  | 'done'
  | 'failed'
  | 'locked'
  | 'bypassed';

export type EdgeStatus = 'idle' | 'generating' | 'done' | 'failed';

// --- Generation history entry ------------------------------------------------

export interface GenerationHistoryEntry {
  assetHash: string;
  prompt: string;
  providerId: string;
  seed?: number;
  negativePrompt?: string;
  cost?: number;
  generationTimeMs?: number;
  createdAt: number;
}

// --- Node annotation --------------------------------------------------------

export interface NodeAnnotation {
  text: string;
  position: 'top' | 'bottom' | 'overlay';
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
}

// --- Node data variants ---------------------------------------------------

export interface TextNodeData {
  content: string;
}

export interface ImageNodeData {
  assetHash?: string;
  status: MediaNodeStatus;
  prompt?: string;
  imagePrompt?: string;
  videoPrompt?: string;
  negativePrompt?: string;
  presetTracks?: PresetTrackSet;
  appliedShotTemplateId?: string;
  appliedShotTemplateName?: string;
  sourceImageHash?: string;
  width?: number;
  height?: number;
  seed?: number;
  seedLocked?: boolean;
  variants: string[];
  selectedVariantIndex: number;
  providerId?: string;
  variantCount?: number;
  jobId?: string;
  progress?: number;
  currentStep?: string;
  error?: string;
  estimatedCost?: number;
  cost?: number;
  generationTimeMs?: number;
  characterRefs?: CharacterRef[];
  equipmentRefs?: Array<EquipmentRef | string>;
  locationRefs?: LocationRef[];
  anchorRole?: 'first-frame' | 'last-frame';
  annotation?: NodeAnnotation;
  generationHistory?: GenerationHistoryEntry[];
  /** Advanced generation params — passed through to provider */
  steps?: number;
  cfgScale?: number;
  scheduler?: string;
  /** Image-to-image strength (0-1). 0 = ignore source, 1 = max influence */
  img2imgStrength?: number;
  /** Character consistency: face embedding asset hashes */
  faceReferenceHashes?: string[];
}

export interface VideoNodeData {
  assetHash?: string;
  status: MediaNodeStatus;
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  prompt?: string;
  imagePrompt?: string;
  videoPrompt?: string;
  negativePrompt?: string;
  presetTracks?: PresetTrackSet;
  appliedShotTemplateId?: string;
  appliedShotTemplateName?: string;
  seed?: number;
  seedLocked?: boolean;
  sourceImageHash?: string;
  variants: string[];
  selectedVariantIndex: number;
  providerId?: string;
  variantCount?: number;
  jobId?: string;
  progress?: number;
  currentStep?: string;
  error?: string;
  estimatedCost?: number;
  cost?: number;
  generationTimeMs?: number;
  characterRefs?: CharacterRef[];
  equipmentRefs?: Array<EquipmentRef | string>;
  locationRefs?: LocationRef[];
  firstFrameNodeId?: string;
  lastFrameNodeId?: string;
  firstFrameAssetHash?: string;
  lastFrameAssetHash?: string;
  audio?: boolean;
  quality?: 'standard' | 'pro';
  lipSyncEnabled?: boolean;
  annotation?: NodeAnnotation;
  generationHistory?: GenerationHistoryEntry[];
  steps?: number;
  cfgScale?: number;
  scheduler?: string;
  img2imgStrength?: number;
  faceReferenceHashes?: string[];
  /** Shot duration override for NLE export (seconds) */
  durationOverride?: number;
  /** Scene number for NLE export ordering */
  sceneNumber?: string;
  /** Shot order within scene */
  shotOrder?: number;
}

export interface EmotionVector {
  happy: number;        // 0-1
  sad: number;          // 0-1
  angry: number;        // 0-1
  fearful: number;      // 0-1
  surprised: number;    // 0-1
  disgusted: number;    // 0-1
  contemptuous: number; // 0-1
  neutral: number;      // 0-1
}

export interface AudioNodeData {
  assetHash?: string;
  status: MediaNodeStatus;
  audioType: 'voice' | 'music' | 'sfx';
  duration?: number;
  provider?: string;
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  seedLocked?: boolean;
  variants: string[];
  selectedVariantIndex: number;
  providerId?: string;
  variantCount?: number;
  jobId?: string;
  progress?: number;
  currentStep?: string;
  error?: string;
  estimatedCost?: number;
  cost?: number;
  generationTimeMs?: number;
  annotation?: NodeAnnotation;
  generationHistory?: GenerationHistoryEntry[];
  emotionVector?: EmotionVector;
}

export interface BackdropNodeData {
  color?: string;
  padding?: number;
  opacity?: number;
  collapsed?: boolean;
  borderStyle?: 'dashed' | 'solid' | 'dotted';
  titleSize?: 'sm' | 'md' | 'lg';
  lockChildren?: boolean;
}

export type CanvasNodeData =
  | TextNodeData
  | ImageNodeData
  | VideoNodeData
  | AudioNodeData
  | BackdropNodeData;

// --- Canvas Node -----------------------------------------------------------

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  position: { x: number; y: number };
  data: CanvasNodeData;
  title: string;
  status: NodeStatus;
  bypassed: boolean;
  locked: boolean;
  colorTag?: string;
  /** User-defined tags for grouping and filtering */
  tags?: string[];
  /** Group ID for logical grouping of related nodes */
  groupId?: string;
  parentId?: string;
  width?: number;
  height?: number;
  createdAt: number;
  updatedAt: number;
}

// --- Canvas Edge -----------------------------------------------------------

export interface CanvasEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  data: {
    label?: string;
    status: EdgeStatus;
    autoLabel?: boolean;
  };
}

// --- Canvas Viewport -------------------------------------------------------

export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

// --- Canvas Note -----------------------------------------------------------

export interface CanvasNote {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

// --- Canvas (top-level) ----------------------------------------------------

export interface Canvas {
  id: string;
  name: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: CanvasViewport;
  notes: CanvasNote[];
  createdAt: number;
  updatedAt: number;
}
