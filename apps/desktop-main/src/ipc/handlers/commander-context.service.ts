/**
 * Commander context-building service.
 *
 * Extracted from commander.handlers.ts — builds the AgentContext
 * (workspace snapshot, selected-node summaries, process-prompt detection,
 * master index) that gets injected into the LLM system prompt.
 */
import {
  deriveNodeStatus,
  type Canvas,
  type CanvasNode,
  type ImageNodeData,
  type VideoNodeData,
  type PresetDefinition,
  type Character,
  type Location,
  type Equipment,
} from '@lucid-fin/contracts';
import { matchNode } from '@lucid-fin/shared-utils';
import type { SqliteIndex } from '@lucid-fin/storage';
import type { AgentContext } from '@lucid-fin/application';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CONTEXT_SELECTED_NODES = 10;
const MAX_CONTEXT_SELECTED_NODE_SUMMARIES = 4;
const MAX_CONTEXT_PROMPT_GUIDES = 8;


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function summarizeCharacterRefIds(refs: unknown): string[] | undefined {
  if (!Array.isArray(refs) || refs.length === 0) return undefined;
  const result = refs.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const ref = entry as Record<string, unknown>;
    const characterId = normalizeOptionalString(ref.characterId);
    if (!characterId) return [];
    return [characterId];
  });
  return result.length > 0 ? result : undefined;
}

function summarizeLocationRefIds(refs: unknown): string[] | undefined {
  if (!Array.isArray(refs) || refs.length === 0) return undefined;
  const result = refs.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const ref = entry as Record<string, unknown>;
    const locationId = normalizeOptionalString(ref.locationId);
    if (!locationId) return [];
    return [locationId];
  });
  return result.length > 0 ? result : undefined;
}

function summarizeEquipmentRefIds(refs: unknown): string[] | undefined {
  if (!Array.isArray(refs) || refs.length === 0) return undefined;
  const result = refs.flatMap((entry) => {
    if (typeof entry === 'string') {
      return [entry];
    }
    if (!entry || typeof entry !== 'object') return [];
    const ref = entry as Record<string, unknown>;
    const equipmentId = normalizeOptionalString(ref.equipmentId);
    if (!equipmentId) return [];
    return [equipmentId];
  });
  return result.length > 0 ? result : undefined;
}

function summarizeSelectedNode(node: CanvasNode, _db: SqliteIndex): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    id: node.id,
    type: node.type,
    title: node.title,
    status: deriveNodeStatus(node),
  };

  return matchNode(node.type, {
    text: () => {
      const content = normalizeOptionalString((node.data as { content?: unknown }).content);
      if (content) summary.content = content;
      return summary;
    },
    image: addMediaFields,
    video: () => {
      addMediaFields();
      const videoData = node.data as VideoNodeData;
      if (typeof videoData.duration === 'number') summary.duration = videoData.duration;
      if (typeof videoData.fps === 'number') summary.fps = videoData.fps;
      const firstFrameNodeId = normalizeOptionalString(videoData.firstFrameNodeId);
      const lastFrameNodeId = normalizeOptionalString(videoData.lastFrameNodeId);
      if (firstFrameNodeId) summary.firstFrameNodeId = firstFrameNodeId;
      if (lastFrameNodeId) summary.lastFrameNodeId = lastFrameNodeId;
      return summary;
    },
    audio: addMediaFields,
    backdrop: addMediaFields,
  });

  function addMediaFields(): Record<string, unknown> {
    const mediaData = node.data as ImageNodeData | VideoNodeData;
    const prompt = normalizeOptionalString((mediaData as { prompt?: unknown }).prompt);
    const negativePrompt = normalizeOptionalString(
      (mediaData as { negativePrompt?: unknown }).negativePrompt,
    );
    const providerId = normalizeOptionalString((mediaData as { providerId?: unknown }).providerId);
    const sourceImageHash = normalizeOptionalString(
      (mediaData as { sourceImageHash?: unknown }).sourceImageHash,
    );

    if (prompt) summary.hasPrompt = true;
    if (negativePrompt) summary.hasNegativePrompt = true;
    if (providerId) summary.providerId = providerId;
    if (sourceImageHash) summary.sourceImageHash = sourceImageHash;

    const characterRefIds = summarizeCharacterRefIds(
      (mediaData as { characterRefs?: unknown }).characterRefs,
    );
    const locationRefIds = summarizeLocationRefIds(
      (mediaData as { locationRefs?: unknown }).locationRefs,
    );
    const equipmentRefIds = summarizeEquipmentRefIds(
      (mediaData as { equipmentRefs?: unknown }).equipmentRefs,
    );
    if (characterRefIds) summary.characterRefIds = characterRefIds;
    if (locationRefIds) summary.locationRefIds = locationRefIds;
    if (equipmentRefIds) summary.equipmentRefIds = equipmentRefIds;

    return summary;
  }
}

// ---------------------------------------------------------------------------
// Workspace Snapshot (1A)
// ---------------------------------------------------------------------------

function truncSnap(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen - 3) + '...';
}

function hasRefImage(entity: { referenceImages?: unknown[] }): boolean {
  return Array.isArray(entity.referenceImages) && entity.referenceImages.length > 0;
}

/**
 * Build a compact workspace snapshot (~500 bytes) for the system prompt.
 * The LLM can call canvas.getInfo / canvas.getNode (Tier A) for details.
 */
export function buildWorkspaceSnapshot(
  canvas: Canvas,
  selectedNodeIds: string[],
  db: SqliteIndex,
): string {
  const lines: string[] = [];

  // Canvas summary
  const nodesByType: Record<string, number> = {};
  for (const node of canvas.nodes) {
    nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1;
  }
  const typeBreakdown = Object.entries(nodesByType).map(([t, c]) => `${t}:${c}`).join(', ');
  lines.push(`Canvas: "${canvas.name}" (${canvas.nodes.length} nodes${typeBreakdown ? ` [${typeBreakdown}]` : ''}, ${canvas.edges.length} edges)`);

  // Style plate status
  const stylePlate = canvas.settings?.stylePlate;
  lines.push(`Style plate: ${stylePlate ? truncSnap(stylePlate, 80) : 'NOT SET'}`);

  // Entity counts with ref-image status
  try {
    const chars: Character[] = db.repos.entities.listCharacters().rows;
    const locs: Location[] = db.repos.entities.listLocations().rows;
    const equips: Equipment[] = db.repos.entities.listEquipment().rows;
    const entityParts: string[] = [];
    if (chars.length > 0) {
      const withRef = chars.filter((c) => hasRefImage(c)).length;
      const names = chars.slice(0, 4).map((c) => `${c.name}${hasRefImage(c) ? ' ✓ref' : ''}`).join(', ');
      entityParts.push(`${chars.length} chars (${withRef} ref): ${names}${chars.length > 4 ? ', ...' : ''}`);
    }
    if (locs.length > 0) {
      const withRef = locs.filter((l) => hasRefImage(l)).length;
      const names = locs.slice(0, 3).map((l) => `${l.name}${hasRefImage(l) ? ' ✓ref' : ''}`).join(', ');
      entityParts.push(`${locs.length} locs (${withRef} ref): ${names}${locs.length > 3 ? ', ...' : ''}`);
    }
    if (equips.length > 0) {
      const withRef = equips.filter((e) => hasRefImage(e)).length;
      entityParts.push(`${equips.length} equip (${withRef} ref)`);
    }
    if (entityParts.length > 0) lines.push(`Entities: ${entityParts.join('; ')}`);
  } catch {
    /* entity query failed — omit */
  }

  // Selected nodes (compact)
  if (selectedNodeIds.length > 0) {
    const selected = selectedNodeIds
      .map((id) => canvas.nodes.find((n) => n.id === id))
      .filter((n): n is CanvasNode => Boolean(n));
    if (selected.length > 0) {
      const summaries = selected.slice(0, 4).map((n) =>
        `${n.title || n.id} (${n.type}, ${deriveNodeStatus(n)})`
      ).join('; ');
      lines.push(`Selected: ${summaries}${selected.length > 4 ? ` +${selected.length - 4} more` : ''}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

export function buildContext(
  canvas: Canvas,
  _presetLibrary: PresetDefinition[],
  selectedNodeIds: string[],
  db: SqliteIndex,
  promptGuides?: Array<{ id: string; name: string; content: string; autoInject?: boolean }>,
  editingNodeId?: string | null,
): AgentContext {
  const limitedSelectedNodeIds = selectedNodeIds.slice(0, MAX_CONTEXT_SELECTED_NODES);
  const nodeMap = new Map(canvas.nodes.map((node) => [node.id, node]));
  const extra: Record<string, unknown> = {
    canvasId: canvas.id,
    nodeCount: canvas.nodes.length,
    edgeCount: canvas.edges.length,
    selectedNodeIds: limitedSelectedNodeIds,
    selectedNodes: limitedSelectedNodeIds
      .slice(0, MAX_CONTEXT_SELECTED_NODE_SUMMARIES)
      .map((nodeId) => nodeMap.get(nodeId))
      .filter((node): node is CanvasNode => Boolean(node))
      .map((node) => summarizeSelectedNode(node, db)),
  };
  // R28: Editing awareness — tell the LLM which node the user is actively
  // editing so it avoids mutating it mid-keystroke. Only included when set.
  if (editingNodeId) {
    extra.editingNodeId = editingNodeId;
    const editingNode = nodeMap.get(editingNodeId);
    if (editingNode) {
      extra.editingNodeWarning =
        `Node "${editingNode.title || editingNodeId}" (id: ${editingNodeId}) is currently being edited by the user. Do NOT modify this node.`;
    }
  }
  // 1A: Workspace snapshot — rich structured overview of canvas + entities.
  // Rendered as its own section in the system prompt so the LLM can reason
  // about the project without calling read tools on step 1.
  extra.workspaceSnapshot = buildWorkspaceSnapshot(canvas, limitedSelectedNodeIds, db);
  if (Array.isArray(promptGuides) && promptGuides.length > 0) {
    // Auto-inject guides: guides with `autoInject: true` are always injected
    // into the system prompt. Remaining guides fill the budget up to 8k chars;
    // overflow becomes discovery-only via guide.get.
    const AUTO_INJECT_BUDGET = 8000;
    const autoInjected: Array<{ id: string; name: string; content: string }> = [];
    const discoveryOnly: Array<{ id: string; name: string }> = [];
    let remaining = AUTO_INJECT_BUDGET;
    const limited = promptGuides.slice(0, MAX_CONTEXT_PROMPT_GUIDES);
    // Pass 1: inject guides with autoInject flag (always included, bypass budget).
    for (const guide of limited) {
      if (guide.autoInject) {
        autoInjected.push(guide);
        remaining -= guide.content.length;
      }
    }
    // Pass 2: fill remaining budget with non-flagged guides.
    for (const guide of limited) {
      if (guide.autoInject) continue;
      if (guide.content.length <= remaining) {
        autoInjected.push(guide);
        remaining -= guide.content.length;
      } else {
        discoveryOnly.push({ id: guide.id, name: guide.name });
      }
    }
    if (autoInjected.length > 0) {
      extra.autoInjectGuides = autoInjected;
    }
    if (discoveryOnly.length > 0) {
      extra.availablePromptGuides = discoveryOnly;
    }
  }
  // v2: Master Index removed — tool.get() browsing provides equivalent info.
  return { page: 'canvas', extra };
}

// ---------------------------------------------------------------------------
// Master index — removed in v2; tool.get() browsing provides equivalent info.
// ---------------------------------------------------------------------------
