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

const SNAPSHOT_CHAR_CAP = 10;
const SNAPSHOT_LOC_CAP = 8;
const SNAPSHOT_EQUIP_CAP = 6;
const SNAPSHOT_EDGE_CAP = 30;

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
// Process prompt detection
// ---------------------------------------------------------------------------

/**
 * Pre-inject process prompts based on typed session state only — never on
 * regex-matching the user's message text. If the user has an image/video
 * node selected, the corresponding generation guide is primed up front so
 * the first generate-ish tool call already has guidance in context.
 *
 * All other process prompts are injected pre-flight the moment the model
 * requests a matching tool — see `primeProcessPromptsForToolCalls` in the
 * orchestrator. That means message-text intent detection is NOT done here
 * and works identically across languages (Chinese, English, anything).
 */
function detectInitialProcessPrompts(canvas: Canvas, selectedNodeIds: string[]): string[] {
  const prompts = new Set<string>();
  const nodeMap = new Map(canvas.nodes.map((node) => [node.id, node]));
  const selectedNodes = selectedNodeIds
    .map((nodeId) => nodeMap.get(nodeId))
    .filter((node): node is CanvasNode => Boolean(node));

  for (const node of selectedNodes) {
    matchNode(node.type, {
      image: () => {
        prompts.add('image-node-generation');
      },
      backdrop: () => {
        prompts.add('image-node-generation');
      },
      video: () => {
        prompts.add('video-node-generation');
      },
      audio: () => {},
      text: () => {},
    });
  }

  // Empty canvas + no selection → the user is either starting a new story or
  // asking for one. Prime the workflow-orchestration guide so the first model
  // turn sees the 6-phase story-to-video chain instead of having to discover
  // it after its first tool call.
  if (canvas.nodes.length === 0 && selectedNodes.length === 0) {
    prompts.add('workflow-orchestration');
  }

  // Canvas has content but stylePlate is not locked → prime the style-plate-lock
  // process prompt so Commander checks `canvas.getSettings` and runs the lock
  // workflow before any ref-image generation drifts off-style.
  //
  // This is a first-turn hint only. The authoritative gate now lives in
  // `AgentOrchestrator.primeStylePlateLockIfNeeded`, which fires before any
  // generation-tool call (including mid-session, after the canvas has grown
  // from empty). Keeping this branch here is fine — it's redundant with the
  // pre-flight when the canvas already has nodes, and the orchestrator's
  // dedupe ensures no double-injection.
  const stylePlate = canvas.settings?.stylePlate;
  if (canvas.nodes.length > 0 && (!stylePlate || stylePlate.trim() === '')) {
    prompts.add('style-plate-lock');
  }

  return Array.from(prompts);
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
 * Build a compact workspace snapshot (3-5k chars) describing the current
 * canvas state, entities, and settings. Injected into the system prompt so
 * the LLM can reason about the project without calling read tools on step 1.
 */
export function buildWorkspaceSnapshot(
  canvas: Canvas,
  selectedNodeIds: string[],
  db: SqliteIndex,
): string {
  const lines: string[] = [];

  // --- Canvas metadata ---
  lines.push(`Canvas: ${canvas.name} (id: ${canvas.id})`);
  const nodesByType: Record<string, number> = {};
  const statusCounts: Record<string, number> = { idle: 0, generating: 0, done: 0, failed: 0 };
  for (const node of canvas.nodes) {
    nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1;
    const st = deriveNodeStatus(node);
    if (st in statusCounts) {
      statusCounts[st]++;
    } else {
      statusCounts[st] = (statusCounts[st] ?? 0) + 1;
    }
  }
  const typeBreakdown = Object.entries(nodesByType)
    .map(([t, c]) => `${t}:${c}`)
    .join(', ');
  lines.push(`Nodes: ${canvas.nodes.length} (${typeBreakdown || 'none'})`);
  lines.push(`Edges: ${canvas.edges.length}`);
  const statusLine = Object.entries(statusCounts)
    .filter(([, c]) => c > 0)
    .map(([s, c]) => `${s}:${c}`)
    .join(', ');
  if (statusLine) lines.push(`Status: ${statusLine}`);

  // Settings
  const settings = canvas.settings;
  if (settings) {
    if (settings.stylePlate) {
      lines.push(`Style plate: ${truncSnap(settings.stylePlate, 200)}`);
    } else {
      lines.push('Style plate: NOT SET');
    }
    if (settings.negativePrompt) {
      lines.push(`Negative prompt: ${truncSnap(settings.negativePrompt, 100)}`);
    }
    if (settings.aspectRatio) lines.push(`Aspect ratio: ${settings.aspectRatio}`);
    if (settings.refResolution) {
      lines.push(
        `Ref resolution: ${settings.refResolution.width}x${settings.refResolution.height}`,
      );
    }
    if (settings.publishImageResolution) {
      lines.push(
        `Publish image res: ${settings.publishImageResolution.width}x${settings.publishImageResolution.height}`,
      );
    }
    if (settings.publishVideoResolution) {
      lines.push(
        `Publish video res: ${settings.publishVideoResolution.width}x${settings.publishVideoResolution.height}`,
      );
    }
    const providerParts: string[] = [];
    if (settings.imageProviderId) providerParts.push(`image:${settings.imageProviderId}`);
    if (settings.videoProviderId) providerParts.push(`video:${settings.videoProviderId}`);
    if (settings.audioProviderId) providerParts.push(`audio:${settings.audioProviderId}`);
    if (providerParts.length > 0) lines.push(`Providers: ${providerParts.join(', ')}`);
  } else {
    lines.push('Style plate: NOT SET');
  }

  // --- Characters ---
  try {
    const chars: Character[] = db.repos.entities.listCharacters().rows;
    if (chars.length > 0) {
      lines.push('');
      lines.push(`Characters (${Math.min(chars.length, SNAPSHOT_CHAR_CAP)}/${chars.length}):`);
      for (const c of chars.slice(0, SNAPSHOT_CHAR_CAP)) {
        const ref = hasRefImage(c) ? 'ref:Y' : 'ref:N';
        const desc = c.description ? ` - ${truncSnap(c.description, 60)}` : '';
        lines.push(`  ${c.name} [${c.role}] ${ref}${desc}`);
      }
    }
  } catch {
    /* entity query failed — omit section */
  }

  // --- Locations ---
  try {
    const locs: Location[] = db.repos.entities.listLocations().rows;
    if (locs.length > 0) {
      lines.push('');
      lines.push(`Locations (${Math.min(locs.length, SNAPSHOT_LOC_CAP)}/${locs.length}):`);
      for (const l of locs.slice(0, SNAPSHOT_LOC_CAP)) {
        const ref = hasRefImage(l) ? 'ref:Y' : 'ref:N';
        const typeStr = l.type ? ` [${l.type}]` : '';
        const desc = l.description ? ` - ${truncSnap(l.description, 60)}` : '';
        lines.push(`  ${l.name}${typeStr} ${ref}${desc}`);
      }
    }
  } catch {
    /* entity query failed — omit section */
  }

  // --- Equipment ---
  try {
    const equips: Equipment[] = db.repos.entities.listEquipment().rows;
    if (equips.length > 0) {
      lines.push('');
      lines.push(`Equipment (${Math.min(equips.length, SNAPSHOT_EQUIP_CAP)}/${equips.length}):`);
      for (const e of equips.slice(0, SNAPSHOT_EQUIP_CAP)) {
        const ref = hasRefImage(e) ? 'ref:Y' : 'ref:N';
        const desc = e.description ? ` - ${truncSnap(e.description, 60)}` : '';
        lines.push(`  ${e.name} [${e.type}] ${ref}${desc}`);
      }
    }
  } catch {
    /* entity query failed — omit section */
  }

  // --- Edges (graph flow) ---
  if (canvas.edges.length > 0) {
    const nodeById = new Map<string, CanvasNode>();
    for (const n of canvas.nodes) nodeById.set(n.id, n);
    const edgesToShow = canvas.edges.slice(0, SNAPSHOT_EDGE_CAP);
    lines.push('');
    lines.push(`Graph edges (${edgesToShow.length}/${canvas.edges.length}):`);
    for (const edge of edgesToShow) {
      const src = nodeById.get(edge.source);
      const tgt = nodeById.get(edge.target);
      const srcLabel = src ? truncSnap(src.title || src.id, 30) : edge.source;
      const tgtLabel = tgt ? truncSnap(tgt.title || tgt.id, 30) : edge.target;
      lines.push(`  ${srcLabel} -> ${tgtLabel}`);
    }
  }

  // --- Selected nodes ---
  if (selectedNodeIds.length > 0) {
    const selected = selectedNodeIds
      .map((id) => canvas.nodes.find((n) => n.id === id))
      .filter((n): n is CanvasNode => Boolean(n));
    if (selected.length > 0) {
      lines.push('');
      lines.push(`Selected nodes (${selected.length}):`);
      for (const node of selected.slice(0, MAX_CONTEXT_SELECTED_NODES)) {
        const parts: string[] = [
          `  ${node.title || node.id} [${node.type}] status:${deriveNodeStatus(node)}`,
        ];
        const data = node.data as Record<string, unknown>;
        if (typeof data.prompt === 'string' && data.prompt.trim().length > 0) {
          parts.push(`    prompt: ${truncSnap(data.prompt.trim(), 200)}`);
        }
        const charRefs = data.characterRefs as Array<{ characterId?: string }> | undefined;
        if (Array.isArray(charRefs) && charRefs.length > 0) {
          parts.push(
            `    characterRefs: ${charRefs
              .map((r) => r.characterId)
              .filter(Boolean)
              .join(', ')}`,
          );
        }
        const locRefs = data.locationRefs as Array<{ locationId?: string }> | undefined;
        if (Array.isArray(locRefs) && locRefs.length > 0) {
          parts.push(
            `    locationRefs: ${locRefs
              .map((r) => r.locationId)
              .filter(Boolean)
              .join(', ')}`,
          );
        }
        const equipRefs = data.equipmentRefs as Array<{ equipmentId?: string }> | undefined;
        if (Array.isArray(equipRefs) && equipRefs.length > 0) {
          parts.push(
            `    equipmentRefs: ${equipRefs
              .map((r) => r.equipmentId)
              .filter(Boolean)
              .join(', ')}`,
          );
        }
        lines.push(parts.join('\n'));
      }
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
  processPromptKeys?: Array<{ processKey: string; name: string }>,
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
  const initialProcessPrompts = detectInitialProcessPrompts(canvas, limitedSelectedNodeIds);
  if (initialProcessPrompts.length > 0) {
    extra.initialProcessPrompts = initialProcessPrompts;
  }
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
  // MASTER INDEX — compact one-line catalog of every prompt/guide/skill
  // surface Commander can reach. Injected as a table into the system prompt
  // so the model does not need to discover names through trial-and-error.
  const masterIndex = buildMasterIndex(promptGuides, processPromptKeys);
  if (masterIndex) {
    extra.masterIndex = masterIndex;
  }
  return { page: 'canvas', extra };
}

// ---------------------------------------------------------------------------
// Master index
// ---------------------------------------------------------------------------

/**
 * Compose a single plaintext MASTER INDEX block listing every guide / skill /
 * process prompt available to Commander. Sections:
 *   - Prompt Guides & Skills  (from renderer-provided promptGuides)
 *   - Process Prompts         (from ProcessPromptStore.list())
 *   - Core Prompts            (single line — agent-system, unless renamed)
 * Returns null when nothing is available (e.g. startup before stores seeded).
 */
function buildMasterIndex(
  promptGuides?: Array<{ id: string; name: string; content: string; autoInject?: boolean }>,
  processPromptKeys?: Array<{ processKey: string; name: string }>,
): string | null {
  const guideLines: string[] = [];
  if (Array.isArray(promptGuides)) {
    for (const { id, name } of promptGuides) {
      guideLines.push(`- ${id}: ${name}`);
    }
  }
  const processLines: string[] = [];
  if (Array.isArray(processPromptKeys)) {
    for (const { processKey, name } of processPromptKeys) {
      processLines.push(`- ${processKey}: ${name}`);
    }
  }
  if (guideLines.length === 0 && processLines.length === 0) return null;

  const sections: string[] = [];
  sections.push('## MASTER INDEX');
  sections.push(
    'Every prompt, guide, and skill Commander can load. Use `guide.get({ ids: [id] })` to fetch guides/skills by id. Process prompts are auto-injected when you call the matching tool — you do not fetch them manually. Core prompts are already baked into the system message.',
  );
  sections.push('');
  sections.push('### Core System Prompts');
  sections.push('- agent-system: main conductor + protocol (this message).');
  if (guideLines.length > 0) {
    sections.push('');
    sections.push(`### Prompt Guides & Skills (${guideLines.length})`);
    sections.push(...guideLines);
  }
  if (processLines.length > 0) {
    sections.push('');
    sections.push(
      `### Process Prompts (${processLines.length}) — auto-injected on matching tool calls`,
    );
    sections.push(...processLines);
  }
  return sections.join('\n');
}
