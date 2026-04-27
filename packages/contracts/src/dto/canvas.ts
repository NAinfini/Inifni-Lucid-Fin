import type { PresetTrackSet } from './presets/index.js';
import type { CharacterRef } from './character.js';
import type { EquipmentRef } from './equipment.js';
import type { LocationRef } from './location.js';
import type { NodeKind } from '../types/node-kinds.js';

// ---------------------------------------------------------------------------
// Canvas DTOs — shared between main and renderer
// ---------------------------------------------------------------------------

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
  type: NodeKind;
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

// --- Canvas Settings -------------------------------------------------------
// Per-canvas overrides for ref-image style anchoring, aspect ratio,
// provider selection, and Commander permission mode. Snapshot pattern:
// global defaults are copied to the canvas on creation; updates to the
// global settings afterward do NOT back-propagate to existing canvases.

/** Publishing aspect ratio driving image-node / video / render output. */
export type CanvasAspectRatio = '16:9' | '9:16' | '1:1' | '2.39:1';

/** Canvas-scoped default output resolution for ref-image generation. */
export interface CanvasResolution {
  width: number;
  height: number;
}

/**
 * Canvas-scoped settings. Every field is optional so a canvas can declare
 * a subset of overrides; repository code is responsible for resolving the
 * final effective value by layering canvas fields over global defaults.
 */
export interface CanvasSettings {
  /**
   * Free-form style prompt describing the visual look of this canvas/video.
   * Prepended to every ref-image prompt as the leading style anchor. Both
   * the user and Commander AI can edit this.
   */
  stylePlate?: string;
  /**
   * Free-form negative prompt. Appended to every ref-image prompt as an
   * "Avoid: …" trailing segment. Typical content: "text, watermark,
   * blurry, low-quality, extra limbs".
   */
  negativePrompt?: string;
  /**
   * Default output size for ref-image generation. Per-entity factory
   * defaults apply when unset; when set it overrides them for every
   * character/location/equipment ref-image rendered on this canvas.
   */
  refResolution?: CanvasResolution;
  /**
   * Default publishing size for image nodes on this canvas. When unset,
   * each image node falls back to its hardcoded factory default. Usually
   * paired with a matching `aspectRatio`.
   */
  publishImageResolution?: CanvasResolution;
  /**
   * Default publishing size for video nodes on this canvas. When unset,
   * each video node falls back to its hardcoded factory default. Kept
   * separate from `publishImageResolution` because image and video providers
   * support different max dimensions — users may publish images at 4K but
   * videos at 1080p (Veo is the only video provider that currently supports
   * 4K output).
   */
  publishVideoResolution?: CanvasResolution;
  /** Publishing aspect ratio. Does NOT govern ref-image layout (those are layout-driven). */
  aspectRatio?: CanvasAspectRatio;
  /** Provider id for LLM calls in this canvas (Commander). */
  llmProviderId?: string;
  /** Provider id for image generation. */
  imageProviderId?: string;
  /** Provider id for video generation. */
  videoProviderId?: string;
  /** Provider id for audio generation. */
  audioProviderId?: string;
}

// --- Canvas (top-level) ----------------------------------------------------

export interface Canvas {
  id: string;
  name: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: CanvasViewport;
  notes: CanvasNote[];
  settings?: CanvasSettings;
  createdAt: number;
  updatedAt: number;
}
