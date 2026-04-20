import {
  PRESET_CATEGORIES,
  createEmptyPresetTrackSet,
  type CameraDirection,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSettings,
  type PresetCategory,
  type PresetTrack,
  type PresetTrackEntry,
  type PresetTrackSet,
} from '@lucid-fin/contracts';
import { isGeneratableMedia, isVisualMedia } from '@lucid-fin/shared-utils';
import type { AgentTool } from '../tool-registry.js';
export { ok, fail, requireString, requireText, requireNumber, requireStringArray, requireBoolean, TypedToolError, formatValidationError } from './tool-result-helpers.js';

export interface CanvasToolDeps {
  getCanvas: (canvasId: string) => Promise<Canvas>;
  deleteCanvas: (canvasId: string) => Promise<void>;
  addNode: (canvasId: string, node: CanvasNode) => Promise<void>;
  moveNode: (canvasId: string, nodeId: string, position: { x: number; y: number }) => Promise<void>;
  renameNode: (canvasId: string, nodeId: string, title: string) => Promise<void>;
  renameCanvas: (canvasId: string, name: string) => Promise<void>;
  connectNodes: (canvasId: string, edge: CanvasEdge) => Promise<void>;
  setNodePresets: (canvasId: string, nodeId: string, presetTracks: PresetTrackSet) => Promise<void>;
  getCanvasState: (canvasId: string) => Promise<Canvas>;
  layoutNodes: (canvasId: string, direction: 'horizontal' | 'vertical' | 'auto') => Promise<void>;
  triggerGeneration: (
    canvasId: string,
    nodeId: string,
    providerId?: string,
    variantCount?: number,
  ) => Promise<void>;
  cancelGeneration: (canvasId: string, nodeId: string) => Promise<void>;
  deleteNode: (canvasId: string, nodeId: string) => Promise<void>;
  deleteEdge: (canvasId: string, edgeId: string) => Promise<void>;
  updateNodeData: (canvasId: string, nodeId: string, data: Record<string, unknown>) => Promise<void>;
  listPresets: (category?: PresetCategory) => Promise<import('@lucid-fin/contracts').PresetDefinition[]>;
  savePreset: (preset: import('@lucid-fin/contracts').PresetDefinition) => Promise<import('@lucid-fin/contracts').PresetDefinition>;
  listShotTemplates: () => Promise<import('@lucid-fin/contracts').ShotTemplate[]>;
  saveShotTemplate: (template: import('@lucid-fin/contracts').ShotTemplate) => Promise<import('@lucid-fin/contracts').ShotTemplate>;
  deleteShotTemplate: (templateId: string) => Promise<void>;
  removeCharacterRef: (canvasId: string, nodeId: string, characterId: string) => Promise<void>;
  removeEquipmentRef: (canvasId: string, nodeId: string, equipmentId: string) => Promise<void>;
  removeLocationRef: (canvasId: string, nodeId: string, locationId: string) => Promise<void>;
  clearSelection: (canvasId: string) => Promise<void>;
  importWorkflow: (canvasId: string, json: string) => Promise<Canvas>;
  exportWorkflow: (canvasId: string) => Promise<string>;
  setNodeColorTag: (canvasId: string, nodeId: string, color: string) => Promise<void>;
  toggleSeedLock: (canvasId: string, nodeId: string) => Promise<void>;
  selectVariant: (canvasId: string, nodeId: string, index: number) => Promise<void>;
  estimateCost: (
    canvasId: string,
    nodeIds?: string[],
  ) => Promise<{
    totalEstimatedCost: number;
    currency: string;
    nodeCosts: Array<{ nodeId: string; estimatedCost: number }>;
  }>;
  previewPrompt?: (
    canvasId: string,
    nodeId: string,
  ) => Promise<{
    prompt: string;
    negativePrompt?: string;
    segments: Array<{ source: string; text: string; trimmed: boolean }>;
    wordCount: number;
    budget: number;
    diagnostics: Array<{ type: string; severity: string; message: string }>;
    providerId: string;
    mode: string;
  }>;
  addNote: (canvasId: string, content: string) => Promise<import('@lucid-fin/contracts').CanvasNote>;
  getRecentLogs: (
    level?: string,
    category?: string,
    limit?: number,
  ) => Promise<Array<Record<string, unknown>>>;
  updateNote: (canvasId: string, noteId: string, content: string) => Promise<void>;
  deleteNote: (canvasId: string, noteId: string) => Promise<void>;
  undo: (canvasId: string) => Promise<void>;
  redo: (canvasId: string) => Promise<void>;
  listLLMProviders?: () => Promise<Array<{ id: string; name: string; model: string; hasKey: boolean }>>;
  setActiveLLMProvider?: (providerId: string) => Promise<void>;
  setLLMProviderApiKey?: (providerId: string, apiKey: string) => Promise<void>;
  deleteProviderKey?: (providerId: string) => Promise<void>;
  /** Check whether a media provider has an API key stored. */
  isProviderKeyConfigured?: (providerId: string) => Promise<boolean>;
  /** Get the user's default provider for a media group (image/video/audio). */
  getDefaultProviderId?: (group: 'image' | 'video' | 'audio') => string | undefined;

  // ---- Canvas-scoped settings (Phase G1-2.5 + Phase 1 overhaul) ----
  /** Read the effective canvas-scoped settings snapshot. Returns `{}` when no overrides exist. */
  getCanvasSettings?: (canvasId: string) => Promise<CanvasSettings>;
  /** Patch canvas-scoped settings. Keys present in `patch` overwrite; `null` clears a column. */
  patchCanvasSettings?: (canvasId: string, patch: CanvasSettings) => Promise<CanvasSettings>;
}

export type CanvasToolResult =
  | { success: true; data?: unknown }
  | { success: false; error: string };

export const CANVAS_CONTEXT = ['canvas'];
export type TrackMap = Record<PresetCategory, PresetTrack>;

export function requireDirection(args: Record<string, unknown>): 'horizontal' | 'vertical' | 'auto' {
  const value = args.direction;
  if (value === 'horizontal' || value === 'vertical' || value === 'auto') {
    return value;
  }
  throw new Error('direction must be "horizontal", "vertical", or "auto"');
}

export function requirePosition(args: Record<string, unknown>): { x: number; y: number } {
  const value = args.position;
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { x?: unknown }).x !== 'number' ||
    typeof (value as { y?: unknown }).y !== 'number'
  ) {
    throw new Error('position with numeric x and y is required');
  }
  return { x: (value as { x: number }).x, y: (value as { y: number }).y };
}

export function requireCanvasNodeType(args: Record<string, unknown>): CanvasNode['type'] {
  const value = args.type;
  if (value === 'text' || value === 'image' || value === 'video' || value === 'audio' || value === 'backdrop') {
    return value;
  }
  throw new Error('type must be one of text, image, video, audio, or backdrop');
}

export function requirePresetCategory(args: Record<string, unknown>): PresetCategory {
  const value = args.category;
  if (typeof value === 'string' && PRESET_CATEGORIES.includes(value as PresetCategory)) {
    return value as PresetCategory;
  }
  throw new Error(`category must be one of ${PRESET_CATEGORIES.join(', ')}`);
}

export const CAMERA_DIRECTIONS: CameraDirection[] = [
  'front', 'back', 'left', 'right', 'above', 'below',
  'over-shoulder-left', 'over-shoulder-right', 'dutch-angle', 'pov',
  'tracking-behind', 'worms-eye', 'high-angle', 'profile',
];

export function clampIntensity(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function parseOptionalCameraDirection(value: unknown): CameraDirection | undefined {
  if (typeof value !== 'string') return undefined;
  if (CAMERA_DIRECTIONS.includes(value as CameraDirection)) return value as CameraDirection;
  return undefined;
}

export function requireCameraDirection(value: unknown, key: string): CameraDirection {
  const direction = parseOptionalCameraDirection(value);
  if (!direction) {
    throw new Error(`${key} must be a valid camera direction`);
  }
  return direction;
}

export function requireBackdropBorderStyle(args: Record<string, unknown>): 'dashed' | 'solid' | 'dotted' {
  const value = args.borderStyle;
  if (value === 'dashed' || value === 'solid' || value === 'dotted') {
    return value;
  }
  throw new Error('borderStyle must be one of dashed, solid, or dotted');
}

export function requireBackdropTitleSize(args: Record<string, unknown>): 'sm' | 'md' | 'lg' {
  const value = args.titleSize;
  if (value === 'sm' || value === 'md' || value === 'lg') {
    return value;
  }
  throw new Error('titleSize must be one of sm, md, or lg');
}

export function requireMoveDirection(args: Record<string, unknown>): 'up' | 'down' {
  const value = args.direction;
  if (value === 'up' || value === 'down') {
    return value;
  }
  throw new Error('direction must be "up" or "down"');
}

export async function requireCanvas(deps: CanvasToolDeps, canvasId: string): Promise<Canvas> {
  const canvas = await deps.getCanvas(canvasId);
  if (!canvas) {
    throw new Error(`Canvas not found: ${canvasId}`);
  }
  return canvas;
}

export async function requireNode(
  deps: CanvasToolDeps,
  canvasId: string,
  nodeId: string,
): Promise<{ canvas: Canvas; node: CanvasNode }> {
  const canvas = await requireCanvas(deps, canvasId);
  const node = canvas.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }
  return { canvas, node };
}

export function requireCanvasEdge(canvas: Canvas, edgeId: string): CanvasEdge {
  const edge = canvas.edges.find((entry) => entry.id === edgeId);
  if (!edge) {
    throw new Error(`Edge not found: ${edgeId}`);
  }
  return edge;
}

export function requireCanvasNodeById(canvas: Canvas, nodeId: string): CanvasNode {
  const node = canvas.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }
  return node;
}

export function selectEdgeHandles(sourceNode: CanvasNode, targetNode: CanvasNode): Pick<CanvasEdge, 'sourceHandle' | 'targetHandle'> {
  const sourceCenter = {
    x: sourceNode.position.x + (sourceNode.width ?? 0) / 2,
    y: sourceNode.position.y + (sourceNode.height ?? 0) / 2,
  };
  const targetCenter = {
    x: targetNode.position.x + (targetNode.width ?? 0) / 2,
    y: targetNode.position.y + (targetNode.height ?? 0) / 2,
  };
  const deltaX = targetCenter.x - sourceCenter.x;
  const deltaY = targetCenter.y - sourceCenter.y;

  // Handle IDs: source = "{side}-{offset}", target = "tgt-{side}-{offset}"
  if (Math.abs(deltaY) >= Math.abs(deltaX)) {
    return deltaY >= 0
      ? { sourceHandle: 'bottom-50', targetHandle: 'tgt-bottom-50' }
      : { sourceHandle: 'top-50', targetHandle: 'tgt-top-50' };
  }

  return deltaX >= 0
    ? { sourceHandle: 'right-50', targetHandle: 'tgt-left-50' }
    : { sourceHandle: 'left-50', targetHandle: 'tgt-right-50' };
}

export function requireMediaNode(
  node: CanvasNode,
  message = `Node type "${node.type}" does not support this operation`,
): void {
  if (!isGeneratableMedia(node.type)) {
    throw new Error(message);
  }
}

export function requireVisualGenerationNode(
  node: CanvasNode,
  message = `Node type "${node.type}" does not support this operation`,
): void {
  if (!isVisualMedia(node.type)) {
    throw new Error(message);
  }
}

export function requireBackdropNode(
  node: CanvasNode,
  message = `Node type "${node.type}" does not support backdrop styling`,
): void {
  if (node.type !== 'backdrop') {
    throw new Error(message);
  }
}

export function clonePresetTrackSet(node: CanvasNode): TrackMap {
  requireVisualGenerationNode(node, `Node type "${node.type}" does not support presets`);
  return structuredClone(
    (node.data as { presetTracks?: PresetTrackSet }).presetTracks ?? createEmptyPresetTrackSet(),
  ) as TrackMap;
}

export function requirePresetTrackEntry(track: PresetTrack, entryId: string): PresetTrackEntry {
  const entry = track.entries.find((item) => item.id === entryId);
  if (!entry) {
    throw new Error(`Preset track entry not found: ${entryId}`);
  }
  return entry;
}

export function normalizeTrackOrders(track: PresetTrack): void {
  track.entries.forEach((entry, index) => {
    entry.order = index;
  });
}

export function requirePresetTrackEntryChanges(
  args: Record<string, unknown>,
): {
  intensity?: number;
  presetId?: string;
  direction?: CameraDirection;
} {
  const value = args.changes;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('changes is required');
  }

  const changes = value as Record<string, unknown>;
  const next: {
    intensity?: number;
    presetId?: string;
    direction?: CameraDirection;
  } = {};

  if (changes.intensity !== undefined) {
    const intensity = clampIntensity(changes.intensity);
    if (intensity === undefined) {
      throw new Error('changes.intensity must be a finite number');
    }
    next.intensity = intensity;
  }

  if (changes.presetId !== undefined) {
    if (typeof changes.presetId !== 'string' || changes.presetId.trim().length === 0) {
      throw new Error('changes.presetId must be a non-empty string');
    }
    next.presetId = changes.presetId.trim();
  }

  if (changes.direction !== undefined) {
    next.direction = requireCameraDirection(changes.direction, 'changes.direction');
  }

  return next;
}

export async function replaceNodePreservingEdges(
  deps: CanvasToolDeps,
  canvasId: string,
  node: CanvasNode,
  changes: Partial<Pick<CanvasNode, 'bypassed' | 'locked'>>,
): Promise<CanvasNode> {
  const canvas = await requireCanvas(deps, canvasId);
  const connectedEdges = canvas.edges
    .filter((edge) => edge.source === node.id || edge.target === node.id)
    .map((edge) => structuredClone(edge) as CanvasEdge);
  const nextNode: CanvasNode = {
    ...(structuredClone(node) as CanvasNode),
    ...changes,
    updatedAt: Date.now(),
  };

  await deps.deleteNode(canvasId, node.id);
  await deps.addNode(canvasId, nextNode);
  for (const edge of connectedEdges) {
    await deps.connectNodes(canvasId, edge);
  }

  return nextNode;
}

export function buildDefaultNodeData(type: CanvasNode['type']): CanvasNode['data'] {
  if (type === 'text') {
    return { content: '' };
  }
  if (type === 'image') {
    return {
      status: 'empty',
      variants: [],
      selectedVariantIndex: 0,
      variantCount: 1,
      seedLocked: false,
      presetTracks: createEmptyPresetTrackSet(),
    };
  }
  if (type === 'video') {
    return {
      status: 'empty',
      variants: [],
      selectedVariantIndex: 0,
      variantCount: 1,
      seedLocked: false,
      presetTracks: createEmptyPresetTrackSet(),
    };
  }
  if (type === 'backdrop') {
    return {
      opacity: 1,
      color: '#1a1a2e',
      borderStyle: 'solid',
      titleSize: 'md',
      lockChildren: false,
      collapsed: false,
    };
  }
  return {
    status: 'empty',
    audioType: 'voice',
    variants: [],
    selectedVariantIndex: 0,
    variantCount: 1,
    seedLocked: false,
  };
}

export function createTrackSetWithPreset(
  existing: PresetTrackSet | undefined,
  category: PresetCategory,
  presetId: string,
): PresetTrackSet {
  const next = structuredClone(existing ?? createEmptyPresetTrackSet()) as TrackMap;
  const _track = next[category];
  next[category] = {
    category,
    entries: [
      {
        id: crypto.randomUUID(),
        category,
        presetId,
        params: {},
        order: 0,
      },
    ],
  };
  return next as PresetTrackSet;
}

export function buildDuplicatedNodes(canvas: Canvas, nodeIds: string[]): CanvasNode[] {
  const now = Date.now();
  return nodeIds.map((nodeId) => {
    const node = canvas.nodes.find((entry) => entry.id === nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    return {
      ...(structuredClone(node) as CanvasNode),
      id: crypto.randomUUID(),
      position: {
        x: node.position.x + 50,
        y: node.position.y + 50,
      },
      createdAt: now,
      updatedAt: now,
    } satisfies CanvasNode;
  });
}

/**
 * Compute a sensible position for a new node based on its type and existing canvas layout.
 * Places nodes in type-based columns: image (col 0) | video (col 1) | text/audio (col 2).
 * Within each column, stacks below the lowest existing node of that column.
 */
export function autoPositionNode(
  canvas: Canvas,
  type: string,
): { x: number; y: number } {
  const colGap = 360;
  const rowGap = 280;

  // Determine which column this type belongs to
  const colForType = (t: string): number => {
    if (t === 'image') return 0;
    if (t === 'video') return 1;
    return 2; // text, audio, backdrop
  };

  const targetCol = colForType(type);

  // Find existing nodes in the same column
  const sameColNodes = canvas.nodes.filter((n) => colForType(n.type) === targetCol);

  if (sameColNodes.length === 0) {
    // No existing nodes in this column — find the column x from existing nodes or use default
    const colX = targetCol * colGap;
    return { x: colX, y: 0 };
  }

  // Stack below the lowest node in this column
  const maxY = sameColNodes.reduce(
    (max, n) => Math.max(max, n.position.y + (n.height ?? 200)),
    0,
  );
  const colX = sameColNodes[0].position.x;
  return { x: colX, y: maxY + (rowGap - (sameColNodes[0].height ?? 200)) };
}

export async function layoutCanvasNodes(
  deps: CanvasToolDeps,
  canvasId: string,
  direction: 'horizontal' | 'vertical' | 'auto',
): Promise<Array<{ id: string; position: { x: number; y: number } }>> {
  const canvas = await requireCanvas(deps, canvasId);

  if (direction === 'auto') {
    const colGap = 360;
    const rowGap = 280;

    // Classify nodes by edge role
    const firstFrameIds = new Set<string>();
    const lastFrameIds = new Set<string>();
    const nodeTypeMap = new Map<string, string>();
    for (const n of canvas.nodes) nodeTypeMap.set(n.id, n.type);

    for (const edge of canvas.edges) {
      const srcType = nodeTypeMap.get(edge.source);
      const tgtType = nodeTypeMap.get(edge.target);
      if (srcType === 'image' && tgtType === 'video') firstFrameIds.add(edge.source);
      if (srcType === 'video' && tgtType === 'image') lastFrameIds.add(edge.target);
    }

    // Build columns: firstFrame | video | lastFrame | text/audio
    const columns: string[][] = [[], [], [], []];
    for (const node of canvas.nodes) {
      if (node.type === 'image' && firstFrameIds.has(node.id)) {
        columns[0].push(node.id);
      } else if (node.type === 'video') {
        columns[1].push(node.id);
      } else if (node.type === 'image' && lastFrameIds.has(node.id)) {
        columns[2].push(node.id);
      } else if (node.type === 'image') {
        columns[0].push(node.id);
      } else {
        columns[3].push(node.id);
      }
    }

    const positions: Array<{ id: string; position: { x: number; y: number } }> = [];
    let colIdx = 0;
    for (const col of columns) {
      if (col.length === 0) continue;
      for (let row = 0; row < col.length; row++) {
        positions.push({ id: col[row], position: { x: colIdx * colGap, y: row * rowGap } });
      }
      colIdx++;
    }

    for (const item of positions) {
      await deps.moveNode(canvasId, item.id, item.position);
    }
    return positions;
  }

  const spacingX = 300;
  const spacingY = 250;
  const positions = canvas.nodes.map((node, index) => {
    const position =
      direction === 'horizontal'
        ? { x: index * spacingX, y: 0 }
        : { x: 0, y: index * spacingY };
    return { id: node.id, position };
  });

  for (const item of positions) {
    await deps.moveNode(canvasId, item.id, item.position);
  }

  return positions;
}

/** Re-export AgentTool for convenience in domain files */
export type { AgentTool };
