import type { PresetTrackSet } from './presets.js';
import type { CharacterRef } from './character.js';
import type { EquipmentRef } from './equipment.js';
import type { LocationRef } from './location.js';

// ---------------------------------------------------------------------------
// Canvas DTOs — shared between main and renderer
// ---------------------------------------------------------------------------

export type CanvasNodeType = 'text' | 'image' | 'video' | 'audio' | 'backdrop';

export type NodeStatus =
  | 'idle'
  | 'queued'
  | 'generating'
  | 'done'
  | 'failed'
  | 'locked'
  | 'bypassed';

export type EdgeStatus = 'idle' | 'generating' | 'done' | 'failed';

// --- Node data variants ---------------------------------------------------

export interface TextNodeData {
  content: string;
}

export interface ImageNodeData {
  assetHash?: string;
  status: 'empty' | 'generating' | 'done' | 'failed';
  prompt?: string;
  presetTracks?: PresetTrackSet;
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
}

export interface VideoNodeData {
  assetHash?: string;
  status: 'empty' | 'generating' | 'done' | 'failed';
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  prompt?: string;
  presetTracks?: PresetTrackSet;
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
}

export interface AudioNodeData {
  assetHash?: string;
  status: 'empty' | 'generating' | 'done' | 'failed';
  audioType: 'voice' | 'music' | 'sfx';
  duration?: number;
  provider?: string;
  prompt?: string;
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
  projectId: string;
  name: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: CanvasViewport;
  notes: CanvasNote[];
  createdAt: number;
  updatedAt: number;
}
