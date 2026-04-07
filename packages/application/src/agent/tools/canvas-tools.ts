import {
  PRESET_CATEGORIES,
  createEmptyPresetTrackSet,
  type CameraDirection,
  type Canvas,
  type CanvasEdge,
  type CanvasNote,
  type CanvasNode,
  type PresetCategory,
  type PresetDefinition,
  type PresetTrack,
  type PresetTrackEntry,
  type PresetTrackSet,
  type ShotTemplate,
} from '@lucid-fin/contracts';
import type { AgentTool } from '../tool-registry.js';

export interface CanvasToolDeps {
  getCanvas: (canvasId: string) => Promise<Canvas>;
  deleteCanvas: (canvasId: string) => Promise<void>;
  addNode: (canvasId: string, node: CanvasNode) => Promise<void>;
  moveNode: (canvasId: string, nodeId: string, position: { x: number; y: number }) => Promise<void>;
  renameNode: (canvasId: string, nodeId: string, title: string) => Promise<void>;
  renameCanvas: (canvasId: string, name: string) => Promise<void>;
  loadCanvas: (canvasId: string) => Promise<void>;
  saveCanvas: (canvasId: string) => Promise<void>;
  connectNodes: (canvasId: string, edge: CanvasEdge) => Promise<void>;
  setNodePresets: (canvasId: string, nodeId: string, presetTracks: PresetTrackSet) => Promise<void>;
  getCanvasState: (canvasId: string) => Promise<Canvas>;
  layoutNodes: (canvasId: string, direction: 'horizontal' | 'vertical') => Promise<void>;
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
  listPresets: (category?: PresetCategory) => Promise<PresetDefinition[]>;
  savePreset: (preset: PresetDefinition) => Promise<PresetDefinition>;
  listShotTemplates: () => Promise<ShotTemplate[]>;
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
  addNote: (canvasId: string, content: string) => Promise<CanvasNote>;
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
}

type CanvasToolResult =
  | { success: true; data?: unknown }
  | { success: false; error: string };

const CANVAS_CONTEXT = ['canvas'];
type TrackMap = Record<PresetCategory, PresetTrack>;

function ok(data?: unknown): CanvasToolResult {
  return data === undefined ? { success: true } : { success: true, data };
}

function fail(error: unknown): CanvasToolResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function requireText(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') {
    throw new Error(`${key} is required`);
  }
  return value;
}

function requireStringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${key} must be a non-empty array`);
  }
  return Array.from(
    new Set(
      value.map((entry, index) => {
        if (typeof entry !== 'string' || entry.trim().length === 0) {
          throw new Error(`${key}[${index}] must be a non-empty string`);
        }
        return entry.trim();
      }),
    ),
  );
}

function requireBoolean(args: Record<string, unknown>, key: string): boolean {
  const value = args[key];
  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean`);
  }
  return value;
}

function requireNumber(args: Record<string, unknown>, key: string): number {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number`);
  }
  return value;
}

function requireDirection(args: Record<string, unknown>): 'horizontal' | 'vertical' {
  const value = args.direction;
  if (value === 'horizontal' || value === 'vertical') {
    return value;
  }
  throw new Error('direction must be "horizontal" or "vertical"');
}

function requirePosition(args: Record<string, unknown>): { x: number; y: number } {
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

function requireCanvasNodeType(args: Record<string, unknown>): CanvasNode['type'] {
  const value = args.type;
  if (value === 'text' || value === 'image' || value === 'video' || value === 'audio') {
    return value;
  }
  throw new Error('type must be one of text, image, video, or audio');
}

function requirePresetCategory(args: Record<string, unknown>): PresetCategory {
  const value = args.category;
  if (typeof value === 'string' && PRESET_CATEGORIES.includes(value as PresetCategory)) {
    return value as PresetCategory;
  }
  throw new Error(`category must be one of ${PRESET_CATEGORIES.join(', ')}`);
}

const CAMERA_DIRECTIONS: CameraDirection[] = [
  'front', 'back', 'left', 'right', 'above', 'below',
  'over-shoulder-left', 'over-shoulder-right', 'dutch-angle', 'pov',
  'tracking-behind', 'worms-eye', 'high-angle', 'profile',
];

function clampIntensity(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseOptionalCameraDirection(value: unknown): CameraDirection | undefined {
  if (typeof value !== 'string') return undefined;
  if (CAMERA_DIRECTIONS.includes(value as CameraDirection)) return value as CameraDirection;
  return undefined;
}

function requireCameraDirection(value: unknown, key: string): CameraDirection {
  const direction = parseOptionalCameraDirection(value);
  if (!direction) {
    throw new Error(`${key} must be a valid camera direction`);
  }
  return direction;
}

function requireBackdropBorderStyle(args: Record<string, unknown>): 'dashed' | 'solid' | 'dotted' {
  const value = args.borderStyle;
  if (value === 'dashed' || value === 'solid' || value === 'dotted') {
    return value;
  }
  throw new Error('borderStyle must be one of dashed, solid, or dotted');
}

function requireBackdropTitleSize(args: Record<string, unknown>): 'sm' | 'md' | 'lg' {
  const value = args.titleSize;
  if (value === 'sm' || value === 'md' || value === 'lg') {
    return value;
  }
  throw new Error('titleSize must be one of sm, md, or lg');
}

function requireMoveDirection(args: Record<string, unknown>): 'up' | 'down' {
  const value = args.direction;
  if (value === 'up' || value === 'down') {
    return value;
  }
  throw new Error('direction must be "up" or "down"');
}

async function requireCanvas(deps: CanvasToolDeps, canvasId: string): Promise<Canvas> {
  const canvas = await deps.getCanvas(canvasId);
  if (!canvas) {
    throw new Error(`Canvas not found: ${canvasId}`);
  }
  return canvas;
}

async function requireNode(
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

function requireCanvasEdge(canvas: Canvas, edgeId: string): CanvasEdge {
  const edge = canvas.edges.find((entry) => entry.id === edgeId);
  if (!edge) {
    throw new Error(`Edge not found: ${edgeId}`);
  }
  return edge;
}

function requireCanvasNodeById(canvas: Canvas, nodeId: string): CanvasNode {
  const node = canvas.nodes.find((entry) => entry.id === nodeId);
  if (!node) {
    throw new Error(`Node not found: ${nodeId}`);
  }
  return node;
}

function selectEdgeHandles(sourceNode: CanvasNode, targetNode: CanvasNode): Pick<CanvasEdge, 'sourceHandle' | 'targetHandle'> {
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

  if (Math.abs(deltaY) >= Math.abs(deltaX)) {
    return deltaY >= 0
      ? { sourceHandle: 'bottom', targetHandle: 'top' }
      : { sourceHandle: 'top', targetHandle: 'bottom' };
  }

  return deltaX >= 0
    ? { sourceHandle: 'right', targetHandle: 'left' }
    : { sourceHandle: 'left', targetHandle: 'right' };
}

function requireMediaNode(
  node: CanvasNode,
  message = `Node type "${node.type}" does not support this operation`,
): void {
  if (node.type !== 'image' && node.type !== 'video' && node.type !== 'audio') {
    throw new Error(message);
  }
}

function requireVisualGenerationNode(
  node: CanvasNode,
  message = `Node type "${node.type}" does not support this operation`,
): void {
  if (node.type !== 'image' && node.type !== 'video') {
    throw new Error(message);
  }
}

function requireBackdropNode(
  node: CanvasNode,
  message = `Node type "${node.type}" does not support backdrop styling`,
): void {
  if (node.type !== 'backdrop') {
    throw new Error(message);
  }
}

function clonePresetTrackSet(node: CanvasNode): TrackMap {
  requireVisualGenerationNode(node, `Node type "${node.type}" does not support presets`);
  return structuredClone(
    (node.data as { presetTracks?: PresetTrackSet }).presetTracks ?? createEmptyPresetTrackSet(),
  ) as TrackMap;
}

function requirePresetTrackEntry(track: PresetTrack, entryId: string): PresetTrackEntry {
  const entry = track.entries.find((item) => item.id === entryId);
  if (!entry) {
    throw new Error(`Preset track entry not found: ${entryId}`);
  }
  return entry;
}

function normalizeTrackOrders(track: PresetTrack): void {
  track.entries.forEach((entry, index) => {
    entry.order = index;
  });
}

function requirePresetTrackEntryChanges(
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

async function replaceNodePreservingEdges(
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

function buildDefaultNodeData(type: CanvasNode['type']): CanvasNode['data'] {
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
  return {
    status: 'empty',
    audioType: 'voice',
    variants: [],
    selectedVariantIndex: 0,
    variantCount: 1,
    seedLocked: false,
  };
}

function createTrackSetWithPreset(
  existing: PresetTrackSet | undefined,
  category: PresetCategory,
  presetId: string,
): PresetTrackSet {
  const next = structuredClone(existing ?? createEmptyPresetTrackSet()) as TrackMap;
  const track = next[category];
  next[category] = {
    category,
    aiDecide: track?.aiDecide ?? false,
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

function buildDuplicatedNodes(canvas: Canvas, nodeIds: string[]): CanvasNode[] {
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

async function layoutCanvasNodes(
  deps: CanvasToolDeps,
  canvasId: string,
  direction: 'horizontal' | 'vertical',
): Promise<Array<{ id: string; position: { x: number; y: number } }>> {
  const canvas = await requireCanvas(deps, canvasId);
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

const askUser: AgentTool = {
  name: 'commander.askUser',
  description:
    'Ask the user a question with multiple choice options. Use this when you need user input to proceed — for preferences, confirmations, or clarification.',
  tags: ['meta', 'interaction'],
  tier: 1,
  context: CANVAS_CONTEXT,
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to ask the user' },
      options: {
        type: 'array',
        description: 'Array of option objects with label and optional description',
        items: {
          type: 'object',
          description: 'A single option',
          properties: {
            label: { type: 'string', description: 'Short option label' },
            description: { type: 'string', description: 'Longer description of what this option means' },
          },
        },
      },
    },
    required: ['question', 'options'],
  },
  execute: async () => {
    // This tool is NEVER executed directly — the orchestrator intercepts it
    // and routes it through the question flow.
    return { success: true, data: 'Waiting for user response...' };
  },
};

export function createCanvasTools(deps: CanvasToolDeps): AgentTool[] {
  let clipboardNodes: CanvasNode[] = [];

  const readLogs: AgentTool = {
    name: 'logger.read',
    description: 'Read recent application log entries for debugging',
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        level: { type: 'string', description: 'Optional log level filter.' },
        category: { type: 'string', description: 'Optional log category filter.' },
        limit: { type: 'number', description: 'Optional max number of log entries to return.' },
      },
      required: [],
    },
    async execute(args) {
      try {
        const level =
          typeof args.level === 'string' && args.level.trim().length > 0
            ? args.level.trim()
            : undefined;
        const category =
          typeof args.category === 'string' && args.category.trim().length > 0
            ? args.category.trim()
            : undefined;
        const limit =
          typeof args.limit === 'number' && Number.isFinite(args.limit)
            ? Math.max(1, Math.floor(args.limit))
            : undefined;
        const entries = await deps.getRecentLogs(level, category, limit);
        return ok(entries);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const addNode: AgentTool = {
    name: 'canvas.addNode',
    description: 'Add a new node to the current canvas at a specific position.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        type: {
          type: 'string',
          description: 'The node type to create.',
          enum: ['text', 'image', 'video', 'audio'],
        },
        title: { type: 'string', description: 'The display title for the node.' },
        content: { type: 'string', description: 'Optional text content for text nodes.' },
        position: {
          type: 'object',
          description: 'The node position on the canvas.',
          properties: {
            x: { type: 'number', description: 'Horizontal coordinate.' },
            y: { type: 'number', description: 'Vertical coordinate.' },
          },
        },
      },
      required: ['canvasId', 'type', 'title', 'position'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const type = requireCanvasNodeType(args);
        const title = requireString(args, 'title');
        const position = requirePosition(args);
        await requireCanvas(deps, canvasId);

        const now = Date.now();
        const node: CanvasNode = {
          id: crypto.randomUUID(),
          type,
          position,
          title,
          data: buildDefaultNodeData(type),
          status: 'idle',
          bypassed: false,
          locked: false,
          createdAt: now,
          updatedAt: now,
        };

        if (type === 'text' && typeof args.content === 'string') {
          node.data = { content: args.content };
        }

        await deps.addNode(canvasId, node);
        return ok(node);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const moveNode: AgentTool = {
    name: 'canvas.moveNode',
    description: 'Move an existing node to a new position on the canvas.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to move.' },
        position: {
          type: 'object',
          description: 'The node position on the canvas.',
          properties: {
            x: { type: 'number', description: 'Horizontal coordinate.' },
            y: { type: 'number', description: 'Vertical coordinate.' },
          },
        },
      },
      required: ['canvasId', 'nodeId', 'position'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const position = requirePosition(args);
        await requireNode(deps, canvasId, nodeId);
        await deps.moveNode(canvasId, nodeId, position);
        return ok({ nodeId, position });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const renameNode: AgentTool = {
    name: 'canvas.renameNode',
    description: 'Rename an existing node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to rename.' },
        title: { type: 'string', description: 'The new node title.' },
      },
      required: ['canvasId', 'nodeId', 'title'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const title = requireString(args, 'title');
        await requireNode(deps, canvasId, nodeId);
        await deps.renameNode(canvasId, nodeId, title);
        return ok({ nodeId, title });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const renameCanvas: AgentTool = {
    name: 'canvas.renameCanvas',
    description: 'Rename an existing canvas.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        name: { type: 'string', description: 'The new canvas name.' },
      },
      required: ['canvasId', 'name'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const name = requireString(args, 'name');
        await requireCanvas(deps, canvasId);
        await deps.renameCanvas(canvasId, name);
        return ok({ canvasId, name });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const loadCanvas: AgentTool = {
    name: 'canvas.loadCanvas',
    description: 'Load an existing canvas by ID.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The canvas ID to load.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        await requireCanvas(deps, canvasId);
        await deps.loadCanvas(canvasId);
        return ok({ canvasId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const saveCanvas: AgentTool = {
    name: 'canvas.saveCanvas',
    description: 'Save the current state of a canvas by ID.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The canvas ID to save.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        await requireCanvas(deps, canvasId);
        await deps.saveCanvas(canvasId);
        return ok({ canvasId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const connectNodes: AgentTool = {
    name: 'canvas.connectNodes',
    description: 'Create a directional edge between two nodes.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        sourceId: { type: 'string', description: 'The source node ID.' },
        targetId: { type: 'string', description: 'The target node ID.' },
        label: { type: 'string', description: 'Optional edge label.' },
      },
      required: ['canvasId', 'sourceId', 'targetId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const sourceId = requireString(args, 'sourceId');
        const targetId = requireString(args, 'targetId');
        const canvas = await requireCanvas(deps, canvasId);
        const sourceNode = requireCanvasNodeById(canvas, sourceId);
        const targetNode = requireCanvasNodeById(canvas, targetId);
        const edge: CanvasEdge = {
          id: crypto.randomUUID(),
          source: sourceId,
          target: targetId,
          ...selectEdgeHandles(sourceNode, targetNode),
          data: {
            label: typeof args.label === 'string' ? args.label : undefined,
            status: 'idle',
          },
        };
        await deps.connectNodes(canvasId, edge);
        return ok(edge);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const duplicateNodes: AgentTool = {
    name: 'canvas.duplicateNodes',
    description: 'Duplicate one or more nodes with new IDs and offset positions by 50 pixels.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'The node IDs to duplicate.',
          items: { type: 'string', description: 'A node ID.' },
        },
      },
      required: ['canvasId', 'nodeIds'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = requireStringArray(args, 'nodeIds');
        const canvas = await requireCanvas(deps, canvasId);
        const duplicatedNodes = buildDuplicatedNodes(canvas, nodeIds);

        for (const node of duplicatedNodes) {
          await deps.addNode(canvasId, node);
        }

        return ok({ nodeIds, nodes: duplicatedNodes });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const deleteCanvas: AgentTool = {
    name: 'canvas.deleteCanvas',
    description: 'Delete an entire canvas by ID.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        await requireCanvas(deps, canvasId);
        await deps.deleteCanvas(canvasId);
        return ok({ canvasId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const cutNodes: AgentTool = {
    name: 'canvas.cutNodes',
    description: 'Copy nodes into the internal Commander clipboard, then delete them from the canvas.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'The node IDs to cut.',
          items: { type: 'string', description: 'A node ID.' },
        },
      },
      required: ['canvasId', 'nodeIds'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = requireStringArray(args, 'nodeIds');
        const canvas = await requireCanvas(deps, canvasId);
        const copiedNodes = buildDuplicatedNodes(canvas, nodeIds);
        clipboardNodes = copiedNodes;

        for (const nodeId of nodeIds) {
          await deps.deleteNode(canvasId, nodeId);
        }

        return ok({
          nodeIds,
          clipboardCount: clipboardNodes.length,
          nodes: clipboardNodes,
        });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const toggleBypass: AgentTool = {
    name: 'canvas.toggleBypass',
    description: 'Set the bypassed flag on one or more nodes.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'The node IDs to update.',
          items: { type: 'string', description: 'A node ID.' },
        },
        bypassed: { type: 'boolean', description: 'Whether the nodes should be bypassed.' },
      },
      required: ['canvasId', 'nodeIds', 'bypassed'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = requireStringArray(args, 'nodeIds');
        const bypassed = requireBoolean(args, 'bypassed');
        const updatedNodes: CanvasNode[] = [];

        for (const nodeId of nodeIds) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          updatedNodes.push(await replaceNodePreservingEdges(deps, canvasId, node, { bypassed }));
        }

        return ok({ nodeIds, bypassed, nodes: updatedNodes });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const toggleLock: AgentTool = {
    name: 'canvas.toggleLock',
    description: 'Set the locked flag on one or more nodes.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'The node IDs to update.',
          items: { type: 'string', description: 'A node ID.' },
        },
        locked: { type: 'boolean', description: 'Whether the nodes should be locked.' },
      },
      required: ['canvasId', 'nodeIds', 'locked'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = requireStringArray(args, 'nodeIds');
        const locked = requireBoolean(args, 'locked');
        const updatedNodes: CanvasNode[] = [];

        for (const nodeId of nodeIds) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          updatedNodes.push(await replaceNodePreservingEdges(deps, canvasId, node, { locked }));
        }

        return ok({ nodeIds, locked, nodes: updatedNodes });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const selectNodes: AgentTool = {
    name: 'canvas.selectNodes',
    description: 'Query nodes by type or status and return matching node IDs without changing UI selection.',
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        filter: {
          type: 'object',
          description: 'Optional query filter.',
          properties: {
            type: {
              type: 'string',
              description: 'Optional node type filter.',
              enum: ['text', 'image', 'video', 'audio', 'backdrop'],
            },
            status: {
              type: 'string',
              description: 'Optional node status filter.',
              enum: ['idle', 'queued', 'generating', 'done', 'failed', 'locked', 'bypassed'],
            },
            all: {
              type: 'boolean',
              description: 'When true, return all nodes unless other filters narrow the result.',
            },
          },
        },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const canvas = await requireCanvas(deps, canvasId);
        const filter =
          typeof args.filter === 'object' && args.filter !== null
            ? (args.filter as { type?: CanvasNode['type']; status?: CanvasNode['status']; all?: boolean })
            : undefined;
        const matches = canvas.nodes.filter((node) => {
          if (filter?.type && node.type !== filter.type) {
            return false;
          }
          if (filter?.status && node.status !== filter.status) {
            return false;
          }
          return true;
        });

        return ok({
          nodeIds: matches.map((node) => node.id),
          count: matches.length,
          filter: filter ?? { all: true },
        });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const clearSelection: AgentTool = {
    name: 'canvas.clearSelection',
    description: 'Clear the current canvas selection.',
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        await requireCanvas(deps, canvasId);
        await deps.clearSelection(canvasId);
        return ok({ canvasId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const importWorkflow: AgentTool = {
    name: 'canvas.importWorkflow',
    description: 'Import a workflow JSON document into the current canvas.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        json: { type: 'string', description: 'Serialized workflow JSON document.' },
      },
      required: ['canvasId', 'json'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const json = requireText(args, 'json');
        const canvas = await deps.importWorkflow(canvasId, json);
        return ok(canvas);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const exportWorkflow: AgentTool = {
    name: 'canvas.exportWorkflow',
    description: 'Export the current canvas as a workflow JSON document.',
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        await requireCanvas(deps, canvasId);
        const json = await deps.exportWorkflow(canvasId);
        return ok({ json });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setPresets: AgentTool = {
    name: 'canvas.setPresets',
    description: 'Apply a preset to a specific preset category on an image or video node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        category: {
          type: 'string',
          description: 'The preset category to update.',
          enum: [
            'camera',
            'lens',
            'look',
            'scene',
            'composition',
            'emotion',
            'flow',
            'technical',
          ],
        },
        presetId: { type: 'string', description: 'The preset definition ID to assign.' },
      },
      required: ['canvasId', 'nodeId', 'category', 'presetId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const category = requirePresetCategory(args);
        const presetId = requireString(args, 'presetId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support presets`);
        }

        const presetTracks = createTrackSetWithPreset(
          (node.data as { presetTracks?: PresetTrackSet }).presetTracks,
          category,
          presetId,
        );
        await deps.setNodePresets(canvasId, nodeId, presetTracks);
        return ok({ nodeId, category, presetId, presetTracks });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const getState: AgentTool = {
    name: 'canvas.getState',
    description: 'Read canvas metadata and edge list only (no node details). Use canvas.searchNodes to find nodes, canvas.getNode for a single node.',
    tags: ['canvas', 'read'],
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const canvas = await requireCanvas(deps, canvasId);
        return ok({
          id: canvas.id,
          name: canvas.name,
          nodeCount: canvas.nodes.length,
          edgeCount: canvas.edges.length,
          edges: canvas.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.data?.label })),
        });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const searchNodes: AgentTool = {
    name: 'canvas.searchNodes',
    description: 'Search canvas nodes with lightweight summaries. Use canvas.getNode to read full details of a specific node.',
    tags: ['canvas', 'read', 'search'],
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        type: { type: 'string', description: 'Optional node type filter.' },
        titleContains: { type: 'string', description: 'Optional case-insensitive title substring filter.' },
        status: { type: 'string', description: 'Optional status filter.' },
        providerId: { type: 'string', description: 'Optional provider id filter.' },
        limit: { type: 'number', description: 'Optional max number of summaries to return.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const canvas = await requireCanvas(deps, canvasId);
        const type = typeof args.type === 'string' ? args.type : undefined;
        const titleContains = typeof args.titleContains === 'string' ? args.titleContains.trim().toLowerCase() : '';
        const status = typeof args.status === 'string' ? args.status : undefined;
        const providerId = typeof args.providerId === 'string' ? args.providerId : undefined;
        const limit =
          typeof args.limit === 'number' && Number.isFinite(args.limit)
            ? Math.max(1, Math.floor(args.limit))
            : canvas.nodes.length;

        return ok(
          canvas.nodes
            .map((node) => {
              const data = node.data as Record<string, unknown>;
              return {
                id: node.id,
                type: node.type,
                title: node.title,
                status: typeof data.status === 'string' ? data.status : node.status,
                providerId: typeof data.providerId === 'string' ? data.providerId : null,
              };
            })
            .filter((node) => (
              (type === undefined || node.type === type)
              && (titleContains.length === 0 || node.title.toLowerCase().includes(titleContains))
              && (status === undefined || node.status === status)
              && (providerId === undefined || node.providerId === providerId)
            ))
            .slice(0, limit),
        );
      } catch (error) {
        return fail(error);
      }
    },
  };

  const getNode: AgentTool = {
    name: 'canvas.getNode',
    description: 'Read full details of a single node by ID, including prompt, presets, refs, variants.',
    tags: ['canvas', 'read'],
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to read.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const canvas = await requireCanvas(deps, canvasId);
        const node = canvas.nodes.find((n) => n.id === nodeId);
        if (!node) return fail(new Error(`Node not found: ${nodeId}`));
        return ok(node);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const layout: AgentTool = {
    name: 'canvas.layout',
    description: 'Automatically arrange nodes either horizontally or vertically.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        direction: {
          type: 'string',
          description: 'Layout direction.',
          enum: ['horizontal', 'vertical'],
        },
      },
      required: ['canvasId', 'direction'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const direction = requireDirection(args);
        const positions = await layoutCanvasNodes(deps, canvasId, direction);
        await deps.layoutNodes(canvasId, direction);
        return ok({ direction, positions });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const generate: AgentTool = {
    name: 'canvas.generate',
    description: 'Trigger media generation for an image, video, or audio node.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to generate.' },
        providerId: { type: 'string', description: 'Optional provider override.' },
        variantCount: { type: 'number', description: 'Optional number of variants to generate.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        await requireNode(deps, canvasId, nodeId);
        const providerId =
          typeof args.providerId === 'string' && args.providerId.trim().length > 0
            ? args.providerId.trim()
            : undefined;
        const variantCount =
          typeof args.variantCount === 'number' ? Math.round(args.variantCount) : undefined;
        await deps.triggerGeneration(canvasId, nodeId, providerId, variantCount);
        return ok({ nodeId, providerId, variantCount });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const cancelGeneration: AgentTool = {
    name: 'canvas.cancelGeneration',
    description: 'Cancel an active generation job for an image, video, or audio node.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID whose generation should be cancelled.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireMediaNode(node);
        await deps.cancelGeneration(canvasId, nodeId);
        return ok({ nodeId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setSeed: AgentTool = {
    name: 'canvas.setSeed',
    description: 'Set the seed value on one or more image, video, or audio nodes.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'The node IDs to update.',
          items: { type: 'string', description: 'A node ID.' },
        },
        seed: { type: 'number', description: 'The seed value to assign.' },
      },
      required: ['canvasId', 'nodeIds', 'seed'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = requireStringArray(args, 'nodeIds');
        const seed = Math.round(requireNumber(args, 'seed'));

        for (const nodeId of nodeIds) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          requireMediaNode(node);
          await deps.updateNodeData(canvasId, nodeId, { seed });
        }

        return ok({ nodeIds, seed });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setVariantCount: AgentTool = {
    name: 'canvas.setVariantCount',
    description: 'Set the variant count on one or more image or video nodes.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'The node IDs to update.',
          items: { type: 'string', description: 'A node ID.' },
        },
        count: {
          type: 'number',
          description: 'The variant count to assign.',
        },
      },
      required: ['canvasId', 'nodeIds', 'count'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeIds = requireStringArray(args, 'nodeIds');
        const count = Math.round(requireNumber(args, 'count'));
        if (![1, 2, 4, 9].includes(count)) {
          throw new Error('count must be one of 1, 2, 4, or 9');
        }

        for (const nodeId of nodeIds) {
          const { node } = await requireNode(deps, canvasId, nodeId);
          requireVisualGenerationNode(node);
          await deps.updateNodeData(canvasId, nodeId, { variantCount: count });
        }

        return ok({ nodeIds, count });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setNodeColorTag: AgentTool = {
    name: 'canvas.setNodeColorTag',
    description: 'Set the color tag for a node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        color: { type: 'string', description: 'The color tag to assign.' },
      },
      required: ['canvasId', 'nodeId', 'color'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const color = requireString(args, 'color');
        await requireNode(deps, canvasId, nodeId);
        await deps.setNodeColorTag(canvasId, nodeId, color);
        return ok({ nodeId, color });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const toggleSeedLock: AgentTool = {
    name: 'canvas.toggleSeedLock',
    description: 'Toggle the seed lock state for an image, video, or audio node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireMediaNode(node);
        await deps.toggleSeedLock(canvasId, nodeId);
        return ok({ nodeId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const selectVariant: AgentTool = {
    name: 'canvas.selectVariant',
    description: 'Select the active generated variant for an image, video, or audio node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        index: { type: 'number', description: 'The variant index to select.' },
      },
      required: ['canvasId', 'nodeId', 'index'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const index = Math.round(requireNumber(args, 'index'));
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireMediaNode(node);
        await deps.selectVariant(canvasId, nodeId, index);
        return ok({ nodeId, index });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const estimateCost: AgentTool = {
    name: 'canvas.estimateCost',
    description: 'Estimate total generation cost for specific nodes or for all media nodes on the canvas.',
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'Optional node IDs to include in the estimate.',
          items: { type: 'string', description: 'A node ID.' },
        },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        await requireCanvas(deps, canvasId);
        const nodeIds =
          Array.isArray(args.nodeIds) && args.nodeIds.length > 0
            ? requireStringArray(args, 'nodeIds')
            : undefined;
        return ok(await deps.estimateCost(canvasId, nodeIds));
      } catch (error) {
        return fail(error);
      }
    },
  };

  const addNote: AgentTool = {
    name: 'canvas.addNote',
    description: 'Add a note to the current canvas.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        content: { type: 'string', description: 'The note content.' },
      },
      required: ['canvasId', 'content'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const content = requireText(args, 'content');
        return ok(await deps.addNote(canvasId, content));
      } catch (error) {
        return fail(error);
      }
    },
  };

  const updateNote: AgentTool = {
    name: 'canvas.updateNote',
    description: 'Update the content of an existing canvas note.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        noteId: { type: 'string', description: 'The note ID to update.' },
        content: { type: 'string', description: 'The new note content.' },
      },
      required: ['canvasId', 'noteId', 'content'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const noteId = requireString(args, 'noteId');
        const content = requireText(args, 'content');
        await deps.updateNote(canvasId, noteId, content);
        return ok({ noteId, content });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const deleteNote: AgentTool = {
    name: 'canvas.deleteNote',
    description: 'Delete a note from the current canvas.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        noteId: { type: 'string', description: 'The note ID to delete.' },
      },
      required: ['canvasId', 'noteId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const noteId = requireString(args, 'noteId');
        await deps.deleteNote(canvasId, noteId);
        return ok({ noteId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const undo: AgentTool = {
    name: 'canvas.undo',
    description: 'Undo the most recent canvas action.',
    context: CANVAS_CONTEXT,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        await requireCanvas(deps, canvasId);
        await deps.undo(canvasId);
        return ok({ canvasId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const redo: AgentTool = {
    name: 'canvas.redo',
    description: 'Redo the most recently undone canvas action.',
    context: CANVAS_CONTEXT,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        await requireCanvas(deps, canvasId);
        await deps.redo(canvasId);
        return ok({ canvasId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const generateAll: AgentTool = {
    name: 'canvas.generateAll',
    description: 'Trigger generation sequentially for specific nodes or for all image and video nodes on the canvas.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeIds: {
          type: 'array',
          description: 'Optional node IDs to generate. If omitted, all image and video nodes are used.',
          items: { type: 'string', description: 'A node ID.' },
        },
        providerId: { type: 'string', description: 'Optional provider override.' },
      },
      required: ['canvasId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const canvas = await requireCanvas(deps, canvasId);
        const providerId =
          typeof args.providerId === 'string' && args.providerId.trim().length > 0
            ? args.providerId.trim()
            : undefined;
        const nodeIds =
          Array.isArray(args.nodeIds) && args.nodeIds.length > 0
            ? requireStringArray(args, 'nodeIds')
            : canvas.nodes
                .filter((node) => node.type === 'image' || node.type === 'video')
                .map((node) => node.id);

        if (nodeIds.length === 0) {
          throw new Error('No nodes available for generation');
        }

        for (const nodeId of nodeIds) {
          const node = canvas.nodes.find((entry) => entry.id === nodeId);
          if (!node) {
            throw new Error(`Node not found: ${nodeId}`);
          }
          requireMediaNode(node, `Node type "${node.type}" does not support generation`);
          await deps.triggerGeneration(canvasId, nodeId, providerId);
        }

        return ok({ nodeIds, providerId, count: nodeIds.length });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const deleteNode: AgentTool = {
    name: 'canvas.deleteNode',
    description: 'Delete a node from the canvas (also removes connected edges).',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to delete.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        await requireNode(deps, canvasId, nodeId);
        await deps.deleteNode(canvasId, nodeId);
        return ok({ nodeId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const deleteEdge: AgentTool = {
    name: 'canvas.deleteEdge',
    description: 'Delete an edge (connection) from the canvas.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        edgeId: { type: 'string', description: 'The edge ID to delete.' },
      },
      required: ['canvasId', 'edgeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const edgeId = requireString(args, 'edgeId');
        await deps.deleteEdge(canvasId, edgeId);
        return ok({ edgeId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const swapEdgeDirection: AgentTool = {
    name: 'canvas.swapEdgeDirection',
    description: 'Swap the source and target of an existing edge.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        edgeId: { type: 'string', description: 'The edge ID to swap.' },
      },
      required: ['canvasId', 'edgeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const edgeId = requireString(args, 'edgeId');
        const canvas = await requireCanvas(deps, canvasId);
        const edge = requireCanvasEdge(canvas, edgeId);
        const swappedEdge: CanvasEdge = {
          ...(structuredClone(edge) as CanvasEdge),
          source: edge.target,
          target: edge.source,
          sourceHandle: edge.targetHandle,
          targetHandle: edge.sourceHandle,
        };

        await deps.deleteEdge(canvasId, edgeId);
        await deps.connectNodes(canvasId, swappedEdge);
        return ok(swappedEdge);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const disconnectNode: AgentTool = {
    name: 'canvas.disconnectNode',
    description: 'Remove all edges connected to a node.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to disconnect.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { canvas } = await requireNode(deps, canvasId, nodeId);
        const edgeIds = canvas.edges
          .filter((edge) => edge.source === nodeId || edge.target === nodeId)
          .map((edge) => edge.id);

        for (const edgeId of edgeIds) {
          await deps.deleteEdge(canvasId, edgeId);
        }

        return ok({ nodeId, edgeIds, count: edgeIds.length });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const editNodeContent: AgentTool = {
    name: 'canvas.editNodeContent',
    description:
      'Edit node content: sets "content" on text nodes, "prompt" on image/video/audio nodes.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to edit.' },
        content: { type: 'string', description: 'Text content (for text nodes).' },
        prompt: { type: 'string', description: 'Prompt text (for image/video/audio nodes).' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        const data: Record<string, unknown> = {};
        if (node.type === 'text') {
          if (typeof args.content !== 'string') throw new Error('content is required for text nodes');
          data.content = args.content;
        } else {
          if (typeof args.prompt !== 'string') throw new Error('prompt is required for media nodes');
          data.prompt = args.prompt;
        }
        await deps.updateNodeData(canvasId, nodeId, data);
        return ok({ nodeId, ...data });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setNodeProvider: AgentTool = {
    name: 'canvas.setNodeProvider',
    description: 'Set the AI provider for an image, video, or audio node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        providerId: { type: 'string', description: 'The provider ID to assign.' },
      },
      required: ['canvasId', 'nodeId', 'providerId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const providerId = requireString(args, 'providerId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video' && node.type !== 'audio') {
          throw new Error(`Node type "${node.type}" does not support providers`);
        }
        await deps.updateNodeData(canvasId, nodeId, { providerId });
        return ok({ nodeId, providerId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setCharacterRefs: AgentTool = {
    name: 'canvas.setCharacterRefs',
    description: 'Assign character references to an image or video node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        characterRefs: {
          type: 'array',
          description: 'Array of character references.',
          items: {
            type: 'object',
            description: 'A character reference.',
            properties: {
              characterId: { type: 'string', description: 'Character ID.' },
              loadoutId: { type: 'string', description: 'Optional loadout ID.' },
            },
          },
        },
      },
      required: ['canvasId', 'nodeId', 'characterRefs'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support character refs`);
        }
        if (!Array.isArray(args.characterRefs)) throw new Error('characterRefs must be an array');
        const characterRefs = (args.characterRefs as Array<Record<string, unknown>>).map((r) => ({
          characterId: String(r.characterId ?? ''),
          loadoutId: typeof r.loadoutId === 'string' ? r.loadoutId : '',
        }));
        await deps.updateNodeData(canvasId, nodeId, { characterRefs });
        return ok({ nodeId, characterRefs });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setEquipmentRefs: AgentTool = {
    name: 'canvas.setEquipmentRefs',
    description: 'Assign equipment references to an image or video node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        equipmentRefs: {
          type: 'array',
          description: 'Array of equipment references.',
          items: {
            type: 'object',
            description: 'An equipment reference.',
            properties: {
              equipmentId: { type: 'string', description: 'Equipment ID.' },
            },
          },
        },
      },
      required: ['canvasId', 'nodeId', 'equipmentRefs'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support equipment refs`);
        }
        if (!Array.isArray(args.equipmentRefs)) throw new Error('equipmentRefs must be an array');
        const equipmentRefs = (args.equipmentRefs as Array<Record<string, unknown>>).map((r) => ({
          equipmentId: String(r.equipmentId ?? ''),
        }));
        await deps.updateNodeData(canvasId, nodeId, { equipmentRefs });
        return ok({ nodeId, equipmentRefs });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setLocationRefs: AgentTool = {
    name: 'canvas.setLocationRefs',
    description: 'Assign location references to an image or video node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        locationRefs: {
          type: 'array',
          description: 'Array of location references.',
          items: {
            type: 'object',
            description: 'A location reference.',
            properties: {
              locationId: { type: 'string', description: 'Location ID.' },
            },
          },
        },
      },
      required: ['canvasId', 'nodeId', 'locationRefs'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support location refs`);
        }
        if (!Array.isArray(args.locationRefs)) throw new Error('locationRefs must be an array');
        const locationRefs = (args.locationRefs as Array<Record<string, unknown>>).map((r) => ({
          locationId: String(r.locationId ?? ''),
        }));
        await deps.updateNodeData(canvasId, nodeId, { locationRefs });
        return ok({ nodeId, locationRefs });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const removeCharacterRef: AgentTool = {
    name: 'canvas.removeCharacterRef',
    description: 'Remove a character reference from an image or video node.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        characterId: { type: 'string', description: 'The character ID to remove.' },
      },
      required: ['canvasId', 'nodeId', 'characterId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const characterId = requireString(args, 'characterId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireVisualGenerationNode(node, `Node type "${node.type}" does not support character refs`);
        await deps.removeCharacterRef(canvasId, nodeId, characterId);
        return ok({ nodeId, characterId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const removeEquipmentRef: AgentTool = {
    name: 'canvas.removeEquipmentRef',
    description: 'Remove an equipment reference from an image or video node.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        equipmentId: { type: 'string', description: 'The equipment ID to remove.' },
      },
      required: ['canvasId', 'nodeId', 'equipmentId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const equipmentId = requireString(args, 'equipmentId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireVisualGenerationNode(node, `Node type "${node.type}" does not support equipment refs`);
        await deps.removeEquipmentRef(canvasId, nodeId, equipmentId);
        return ok({ nodeId, equipmentId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const removeLocationRef: AgentTool = {
    name: 'canvas.removeLocationRef',
    description: 'Remove a location reference from an image or video node.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        locationId: { type: 'string', description: 'The location ID to remove.' },
      },
      required: ['canvasId', 'nodeId', 'locationId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const locationId = requireString(args, 'locationId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireVisualGenerationNode(node, `Node type "${node.type}" does not support location refs`);
        await deps.removeLocationRef(canvasId, nodeId, locationId);
        return ok({ nodeId, locationId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const batchCreate: AgentTool = {
    name: 'canvas.batchCreate',
    description:
      'Bulk create multiple nodes and edges. Edges use fromIndex/toIndex (0-based) referencing the nodes array.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodes: {
          type: 'array',
          description: 'Array of nodes to create.',
          items: {
            type: 'object',
            description: 'A node descriptor.',
            properties: {
              type: { type: 'string', description: 'Node type.', enum: ['text', 'image', 'video', 'audio'] },
              title: { type: 'string', description: 'Node title.' },
              content: { type: 'string', description: 'Text content (text nodes).' },
              prompt: { type: 'string', description: 'Prompt (media nodes).' },
            },
          },
        },
        edges: {
          type: 'array',
          description: 'Array of edges referencing nodes by index.',
          items: {
            type: 'object',
            description: 'An edge descriptor.',
            properties: {
              fromIndex: { type: 'number', description: '0-based index into nodes array.' },
              toIndex: { type: 'number', description: '0-based index into nodes array.' },
              label: { type: 'string', description: 'Optional edge label.' },
            },
          },
        },
      },
      required: ['canvasId', 'nodes'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const canvas = await requireCanvas(deps, canvasId);
        if (!Array.isArray(args.nodes) || args.nodes.length === 0) {
          throw new Error('nodes array is required and must not be empty');
        }

        const maxX = canvas.nodes.reduce(
          (max, n) => Math.max(max, n.position.x + (n.width ?? 200)),
          0,
        );
        const startX = canvas.nodes.length > 0 ? maxX + 300 : 0;
        const spacingX = 300;
        const spacingY = 250;
        const cols = Math.max(1, Math.ceil(Math.sqrt(args.nodes.length)));

        const now = Date.now();
        const nodeDescs = args.nodes as Array<Record<string, unknown>>;
        const createdNodes: CanvasNode[] = [];

        for (let i = 0; i < nodeDescs.length; i++) {
          const desc = nodeDescs[i];
          const type =
            desc.type === 'text' || desc.type === 'image' || desc.type === 'video' || desc.type === 'audio'
              ? (desc.type as CanvasNode['type'])
              : 'text';
          const title = typeof desc.title === 'string' ? desc.title : `Node ${i + 1}`;
          const col = i % cols;
          const row = Math.floor(i / cols);
          const position = { x: startX + col * spacingX, y: row * spacingY };
          const data = buildDefaultNodeData(type);
          if (type === 'text' && typeof desc.content === 'string') {
            (data as { content: string }).content = desc.content;
          } else if (type !== 'text' && typeof desc.prompt === 'string') {
            (data as { prompt?: string }).prompt = desc.prompt;
          }
          const node: CanvasNode = {
            id: crypto.randomUUID(),
            type,
            position,
            title,
            data,
            status: 'idle',
            bypassed: false,
            locked: false,
            createdAt: now,
            updatedAt: now,
          };
          createdNodes.push(node);
          await deps.addNode(canvasId, node);
        }

        const createdEdges: CanvasEdge[] = [];
        if (Array.isArray(args.edges)) {
          for (const edgeDesc of args.edges as Array<Record<string, unknown>>) {
            const fromIdx = edgeDesc.fromIndex as number;
            const toIdx = edgeDesc.toIndex as number;
            if (
              typeof fromIdx !== 'number' ||
              typeof toIdx !== 'number' ||
              fromIdx < 0 ||
              fromIdx >= createdNodes.length ||
              toIdx < 0 ||
              toIdx >= createdNodes.length
            ) {
              continue;
            }
            const edge: CanvasEdge = {
              id: crypto.randomUUID(),
              source: createdNodes[fromIdx].id,
              target: createdNodes[toIdx].id,
              ...selectEdgeHandles(createdNodes[fromIdx], createdNodes[toIdx]),
              data: {
                label: typeof edgeDesc.label === 'string' ? edgeDesc.label : undefined,
                status: 'idle',
              },
            };
            await deps.connectNodes(canvasId, edge);
            createdEdges.push(edge);
          }
        }

        return ok({ nodes: createdNodes, edges: createdEdges });
      } catch (error) {
        return fail(error);
      }
    },
  };

  // -------------------------------------------------------------------------
  // Preset System Tools
  // -------------------------------------------------------------------------

  const readNodePresetTracks: AgentTool = {
    name: 'canvas.readNodePresetTracks',
    description:
      'Read all preset tracks, entries, and intensities for an image or video node. Returns the full PresetTrackSet with per-category and per-entry details.',
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to read.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support presets`);
        }
        const tracks =
          (node.data as { presetTracks?: PresetTrackSet }).presetTracks ??
          createEmptyPresetTrackSet();
        return ok({ nodeId, presetTracks: tracks });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const writeNodePresetTracks: AgentTool = {
    name: 'canvas.writeNodePresetTracks',
    description:
      'Set or modify preset entries and intensity for a specific category on an image or video node. ' +
      'Provide "intensity" (0-100) to set category-level intensity. ' +
      'Provide "entries" to replace the category entries (each entry needs presetId, optional intensity 0-100, optional direction).',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        category: {
          type: 'string',
          description: 'The preset category to modify.',
          enum: [
            'camera', 'lens', 'look', 'scene',
            'composition', 'emotion', 'flow', 'technical',
          ],
        },
        intensity: {
          type: 'number',
          description: 'Category-level intensity (0-100). Controls overall strength of this category.',
        },
        entries: {
          type: 'array',
          description: 'Replacement entries for this category.',
          items: {
            type: 'object',
            description: 'A preset entry.',
            properties: {
              presetId: { type: 'string', description: 'The preset definition ID.' },
              intensity: { type: 'number', description: 'Entry-level intensity (0-100).' },
              direction: {
                type: 'string',
                description: 'Camera direction (only for camera category).',
              },
            },
          },
        },
      },
      required: ['canvasId', 'nodeId', 'category'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const category = requirePresetCategory(args);
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support presets`);
        }

        const existing =
          (node.data as { presetTracks?: PresetTrackSet }).presetTracks ??
          createEmptyPresetTrackSet();
        const trackSet = structuredClone(existing) as TrackMap;
        const track = trackSet[category] ?? {
          category,
          aiDecide: false,
          entries: [],
        };

        const categoryIntensity = clampIntensity(args.intensity);
        if (categoryIntensity !== undefined) {
          track.intensity = categoryIntensity;
        }

        if (Array.isArray(args.entries)) {
          const rawEntries = args.entries as Array<Record<string, unknown>>;
          const entries: Array<PresetTrackEntry> = rawEntries.map((raw, idx) => {
            const presetId = typeof raw.presetId === 'string' ? raw.presetId.trim() : '';
            if (!presetId) throw new Error(`entries[${idx}].presetId is required`);
            return {
              id: crypto.randomUUID(),
              category,
              presetId,
              params: {},
              order: idx,
              intensity: clampIntensity(raw.intensity),
              direction: parseOptionalCameraDirection(raw.direction),
            };
          });
          track.entries = entries;
          track.aiDecide = false;
        }

        trackSet[category] = track;
        await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);
        return ok({ nodeId, category, track });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setBackdropOpacity: AgentTool = {
    name: 'canvas.setBackdropOpacity',
    description: 'Set the opacity of a backdrop node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The backdrop node ID to update.' },
        opacity: { type: 'number', description: 'Backdrop opacity value.' },
      },
      required: ['canvasId', 'nodeId', 'opacity'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const opacity = requireNumber(args, 'opacity');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireBackdropNode(node);
        await deps.updateNodeData(canvasId, nodeId, { opacity });
        return ok({ nodeId, opacity });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setBackdropColor: AgentTool = {
    name: 'canvas.setBackdropColor',
    description: 'Set the background color of a backdrop node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The backdrop node ID to update.' },
        color: { type: 'string', description: 'Backdrop color string.' },
      },
      required: ['canvasId', 'nodeId', 'color'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const color = requireString(args, 'color');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireBackdropNode(node);
        await deps.updateNodeData(canvasId, nodeId, { color });
        return ok({ nodeId, color });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setBackdropBorderStyle: AgentTool = {
    name: 'canvas.setBackdropBorderStyle',
    description: 'Set the border style of a backdrop node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The backdrop node ID to update.' },
        borderStyle: {
          type: 'string',
          description: 'Backdrop border style.',
          enum: ['dashed', 'solid', 'dotted'],
        },
      },
      required: ['canvasId', 'nodeId', 'borderStyle'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const borderStyle = requireBackdropBorderStyle(args);
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireBackdropNode(node);
        await deps.updateNodeData(canvasId, nodeId, { borderStyle });
        return ok({ nodeId, borderStyle });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setBackdropTitleSize: AgentTool = {
    name: 'canvas.setBackdropTitleSize',
    description: 'Set the title size of a backdrop node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The backdrop node ID to update.' },
        titleSize: {
          type: 'string',
          description: 'Backdrop title size.',
          enum: ['sm', 'md', 'lg'],
        },
      },
      required: ['canvasId', 'nodeId', 'titleSize'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const titleSize = requireBackdropTitleSize(args);
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireBackdropNode(node);
        await deps.updateNodeData(canvasId, nodeId, { titleSize });
        return ok({ nodeId, titleSize });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setBackdropLockChildren: AgentTool = {
    name: 'canvas.setBackdropLockChildren',
    description: 'Lock or unlock child movement inside a backdrop node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The backdrop node ID to update.' },
        locked: { type: 'boolean', description: 'Whether child nodes are locked inside the backdrop.' },
      },
      required: ['canvasId', 'nodeId', 'locked'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const locked = requireBoolean(args, 'locked');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireBackdropNode(node);
        await deps.updateNodeData(canvasId, nodeId, { lockChildren: locked });
        return ok({ nodeId, locked });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const toggleBackdropCollapse: AgentTool = {
    name: 'canvas.toggleBackdropCollapse',
    description: 'Toggle the collapsed state of a backdrop node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The backdrop node ID to update.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        requireBackdropNode(node);
        const collapsed = !((node.data as { collapsed?: boolean }).collapsed ?? false);
        await deps.updateNodeData(canvasId, nodeId, { collapsed });
        return ok({ nodeId, collapsed });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const addPresetTrackEntry: AgentTool = {
    name: 'canvas.addPresetTrackEntry',
    description: 'Add a single preset entry to a specific preset track on an image or video node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        category: {
          type: 'string',
          description: 'The preset category to modify.',
          enum: [...PRESET_CATEGORIES],
        },
        presetId: { type: 'string', description: 'The preset definition ID to add.' },
        intensity: { type: 'number', description: 'Optional entry-level intensity (0-100).' },
      },
      required: ['canvasId', 'nodeId', 'category', 'presetId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const category = requirePresetCategory(args);
        const presetId = requireString(args, 'presetId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        const trackSet = clonePresetTrackSet(node);
        const track = trackSet[category];
        const entry: PresetTrackEntry = {
          id: crypto.randomUUID(),
          category,
          presetId,
          params: {},
          order: track.entries.length,
          intensity: clampIntensity(args.intensity),
        };
        track.entries.push(entry);
        track.aiDecide = false;
        normalizeTrackOrders(track);
        await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);
        return ok({ nodeId, category, entry });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const removePresetTrackEntry: AgentTool = {
    name: 'canvas.removePresetTrackEntry',
    description: 'Remove a single preset entry from a specific preset track on an image or video node.',
    context: CANVAS_CONTEXT,
    tier: 3,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        category: {
          type: 'string',
          description: 'The preset category to modify.',
          enum: [...PRESET_CATEGORIES],
        },
        entryId: { type: 'string', description: 'The preset track entry ID to remove.' },
      },
      required: ['canvasId', 'nodeId', 'category', 'entryId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const category = requirePresetCategory(args);
        const entryId = requireString(args, 'entryId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        const trackSet = clonePresetTrackSet(node);
        const track = trackSet[category];
        requirePresetTrackEntry(track, entryId);
        track.entries = track.entries.filter((entry) => entry.id !== entryId);
        track.aiDecide = false;
        normalizeTrackOrders(track);
        await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);
        return ok({ nodeId, category, entryId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const updatePresetTrackEntry: AgentTool = {
    name: 'canvas.updatePresetTrackEntry',
    description: 'Update fields on a single preset entry within a specific preset track.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        category: {
          type: 'string',
          description: 'The preset category to modify.',
          enum: [...PRESET_CATEGORIES],
        },
        entryId: { type: 'string', description: 'The preset track entry ID to update.' },
        changes: {
          type: 'object',
          description: 'Changes to apply to the preset track entry.',
          properties: {
            intensity: { type: 'number', description: 'Optional entry-level intensity (0-100).' },
            presetId: { type: 'string', description: 'Optional replacement preset ID.' },
            direction: { type: 'string', description: 'Optional camera direction.' },
          },
        },
      },
      required: ['canvasId', 'nodeId', 'category', 'entryId', 'changes'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const category = requirePresetCategory(args);
        const entryId = requireString(args, 'entryId');
        const changes = requirePresetTrackEntryChanges(args);
        const { node } = await requireNode(deps, canvasId, nodeId);
        const trackSet = clonePresetTrackSet(node);
        const track = trackSet[category];
        const entry = requirePresetTrackEntry(track, entryId);

        if (changes.intensity !== undefined) {
          entry.intensity = changes.intensity;
        }
        if (changes.presetId !== undefined) {
          entry.presetId = changes.presetId;
        }
        if (changes.direction !== undefined) {
          entry.direction = changes.direction;
        }

        track.aiDecide = false;
        normalizeTrackOrders(track);
        await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);
        return ok({ nodeId, category, entryId });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const movePresetTrackEntry: AgentTool = {
    name: 'canvas.movePresetTrackEntry',
    description: 'Move a single preset entry up or down within a specific preset track.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to update.' },
        category: {
          type: 'string',
          description: 'The preset category to modify.',
          enum: [...PRESET_CATEGORIES],
        },
        entryId: { type: 'string', description: 'The preset track entry ID to move.' },
        direction: {
          type: 'string',
          description: 'The move direction.',
          enum: ['up', 'down'],
        },
      },
      required: ['canvasId', 'nodeId', 'category', 'entryId', 'direction'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const category = requirePresetCategory(args);
        const entryId = requireString(args, 'entryId');
        const direction = requireMoveDirection(args);
        const { node } = await requireNode(deps, canvasId, nodeId);
        const trackSet = clonePresetTrackSet(node);
        const track = trackSet[category];
        requirePresetTrackEntry(track, entryId);

        const index = track.entries.findIndex((entry) => entry.id === entryId);
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        if (targetIndex >= 0 && targetIndex < track.entries.length) {
          const [entry] = track.entries.splice(index, 1);
          track.entries.splice(targetIndex, 0, entry);
        }

        track.aiDecide = false;
        normalizeTrackOrders(track);
        await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);
        return ok({ nodeId, category, entryId, direction });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const applyShotTemplate: AgentTool = {
    name: 'canvas.applyShotTemplate',
    description:
      'Apply a shot template to an image or video node by name. Searches built-in and custom templates. ' +
      'Overwrites preset tracks defined in the template; leaves other categories unchanged.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to apply the template to.' },
        templateName: {
          type: 'string',
          description: 'The template name to search for (case-insensitive partial match).',
        },
      },
      required: ['canvasId', 'nodeId', 'templateName'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const templateName = requireString(args, 'templateName').toLowerCase();
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support presets`);
        }

        const templates = await deps.listShotTemplates();
        const match =
          templates.find((t) => t.name.toLowerCase() === templateName) ??
          templates.find((t) => t.name.toLowerCase().includes(templateName));
        if (!match) {
          throw new Error(
            `Shot template "${args.templateName}" not found. Available: ${templates.map((t) => t.name).join(', ')}`,
          );
        }

        const existing =
          (node.data as { presetTracks?: PresetTrackSet }).presetTracks ??
          createEmptyPresetTrackSet();
        const trackSet = structuredClone(existing) as TrackMap;

        for (const [cat, track] of Object.entries(match.tracks)) {
          if (track) {
            trackSet[cat as PresetCategory] = structuredClone(track);
          }
        }

        await deps.setNodePresets(canvasId, nodeId, trackSet as PresetTrackSet);
        return ok({
          nodeId,
          templateId: match.id,
          templateName: match.name,
          appliedCategories: Object.keys(match.tracks),
        });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const autoFillEmptyTracks: AgentTool = {
    name: 'canvas.autoFillEmptyTracks',
    description:
      'Analyze an image or video node and return its context (prompt, characters, locations) plus a list of empty preset categories. ' +
      'Use this to understand what the node needs, then call canvas.writeNodePresetTracks for each category you want to fill.',
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: {
      type: 'object',
      properties: {
        canvasId: { type: 'string', description: 'The target canvas ID.' },
        nodeId: { type: 'string', description: 'The node ID to analyze.' },
      },
      required: ['canvasId', 'nodeId'],
    },
    async execute(args) {
      try {
        const canvasId = requireString(args, 'canvasId');
        const nodeId = requireString(args, 'nodeId');
        const { node } = await requireNode(deps, canvasId, nodeId);
        if (node.type !== 'image' && node.type !== 'video') {
          throw new Error(`Node type "${node.type}" does not support presets`);
        }

        const data = node.data as {
          prompt?: string;
          characterRefs?: Array<{ characterId: string; loadoutId?: string }>;
          locationRefs?: Array<{ locationId: string }>;
          presetTracks?: PresetTrackSet;
        };

        const tracks = data.presetTracks ?? createEmptyPresetTrackSet();
        const emptyCategories: PresetCategory[] = [];
        const filledCategories: PresetCategory[] = [];

        for (const cat of PRESET_CATEGORIES) {
          const track = (tracks as TrackMap)[cat];
          if (!track || track.entries.length === 0) {
            emptyCategories.push(cat);
          } else {
            filledCategories.push(cat);
          }
        }

        return ok({
          nodeId,
          nodeType: node.type,
          title: node.title,
          prompt: data.prompt ?? '',
          characterRefs: data.characterRefs ?? [],
          locationRefs: data.locationRefs ?? [],
          emptyCategories,
          filledCategories,
          currentTracks: tracks,
        });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const createCustomPreset: AgentTool = {
    name: 'canvas.createCustomPreset',
    description:
      'Create a new custom preset definition in the project library. The preset becomes available for use on any node.',
    context: CANVAS_CONTEXT,
    tier: 2,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the preset (e.g., "Shaky Handheld").' },
        category: {
          type: 'string',
          description: 'The preset category.',
          enum: [
            'camera', 'lens', 'look', 'scene',
            'composition', 'emotion', 'flow', 'technical',
          ],
        },
        description: { type: 'string', description: 'Short description of the visual effect.' },
        prompt: {
          type: 'string',
          description: 'The prompt fragment that describes the visual effect for AI generation.',
        },
      },
      required: ['name', 'category', 'description', 'prompt'],
    },
    async execute(args) {
      try {
        const name = requireString(args, 'name');
        const category = requirePresetCategory(args);
        const description = requireString(args, 'description');
        const prompt = requireString(args, 'prompt');

        const preset: PresetDefinition = {
          id: `custom-${crypto.randomUUID()}`,
          category,
          name,
          description,
          prompt,
          builtIn: false,
          modified: false,
          params: [],
          defaults: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        const saved = await deps.savePreset(preset);
        return ok(saved);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const listLLMProviders: AgentTool = {
    name: 'settings.listLLMProviders',
    description: 'List available LLM providers and their configuration status (which have API keys set).',
    context: CANVAS_CONTEXT,
    tier: 1,
    parameters: { type: 'object', properties: {}, required: [] },
    execute: async () => {
      if (!deps.listLLMProviders) return fail('LLM provider listing not available');
      try {
        const providers = await deps.listLLMProviders();
        return ok(providers);
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setActiveLLM: AgentTool = {
    name: 'settings.setActiveLLMProvider',
    description: 'Set the active LLM provider for Commander AI. Use after confirming the provider has an API key configured.',
    context: CANVAS_CONTEXT,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        providerId: { type: 'string', description: 'Provider ID (e.g., "openai", "claude", "gemini", "deepseek")' },
      },
      required: ['providerId'],
    },
    execute: async (args) => {
      if (!deps.setActiveLLMProvider) return fail('LLM provider switching not available');
      try {
        const providerId = requireString(args, 'providerId');
        await deps.setActiveLLMProvider(providerId);
        return ok({ providerId, message: `Active LLM provider set to ${providerId}` });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setProviderKey: AgentTool = {
    name: 'settings.setProviderKey',
    description: 'Set the API key for any configured provider. The key will be securely stored in the system keychain.',
    context: CANVAS_CONTEXT,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        providerId: { type: 'string', description: 'Provider ID (e.g., "openai", "claude", "runway")' },
        apiKey: { type: 'string', description: 'The API key to store' },
      },
      required: ['providerId', 'apiKey'],
    },
    execute: async (args) => {
      if (!deps.setLLMProviderApiKey) return fail('API key management not available');
      try {
        const providerId = requireString(args, 'providerId');
        const apiKey = requireString(args, 'apiKey');
        await deps.setLLMProviderApiKey(providerId, apiKey);
        return ok({ providerId, message: `API key set for ${providerId}` });
      } catch (error) {
        return fail(error);
      }
    },
  };

  const setLLMApiKey: AgentTool = {
    ...setProviderKey,
    name: 'settings.setLLMApiKey',
    description: 'Set the API key for a provider. Kept for backward compatibility with older Commander prompts.',
  };

  const deleteProviderKey: AgentTool = {
    name: 'settings.deleteProviderKey',
    description: 'Delete a stored provider API key from the system keychain.',
    context: CANVAS_CONTEXT,
    tier: 4,
    parameters: {
      type: 'object',
      properties: {
        providerId: { type: 'string', description: 'Provider ID whose key should be deleted.' },
      },
      required: ['providerId'],
    },
    execute: async (args) => {
      if (!deps.deleteProviderKey) return fail('API key deletion not available');
      try {
        const providerId = requireString(args, 'providerId');
        await deps.deleteProviderKey(providerId);
        return ok({ providerId, message: `API key deleted for ${providerId}` });
      } catch (error) {
        return fail(error);
      }
    },
  };

  return [
    addNode, moveNode, renameNode, renameCanvas, loadCanvas, saveCanvas, deleteCanvas, connectNodes, duplicateNodes, cutNodes, toggleBypass, toggleLock,
    selectNodes, setPresets, getState, searchNodes, getNode, layout, generate, cancelGeneration, setSeed, setVariantCount, generateAll,
    deleteNode, deleteEdge, swapEdgeDirection, disconnectNode, editNodeContent, setNodeProvider,
    setCharacterRefs, setEquipmentRefs, setLocationRefs, removeCharacterRef, removeEquipmentRef, removeLocationRef, batchCreate,
    readNodePresetTracks, writeNodePresetTracks,
    setBackdropOpacity, setBackdropColor, setBackdropBorderStyle, setBackdropTitleSize, setBackdropLockChildren, toggleBackdropCollapse,
    addPresetTrackEntry, removePresetTrackEntry, updatePresetTrackEntry, movePresetTrackEntry,
    applyShotTemplate, autoFillEmptyTracks, createCustomPreset, readLogs,
    listLLMProviders, setActiveLLM, setProviderKey, setLLMApiKey, deleteProviderKey,
    askUser,
  ];
}
