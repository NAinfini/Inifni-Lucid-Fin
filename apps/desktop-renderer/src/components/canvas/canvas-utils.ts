/**
 * Pure utility functions extracted from CanvasWorkspace.
 *
 * Every export in this file is a pure function (no React hooks, no Redux, no
 * side-effects). This makes them trivially unit-testable and reusable across
 * the canvas module without pulling in the full CanvasWorkspace component.
 */

import { MarkerType, type Node, type Edge } from '@xyflow/react';

import type {
  AudioNodeData,
  BackdropNodeData,
  CanvasEdge as CanvasEdgeDTO,
  CanvasNode as CanvasNodeDTO,
  ImageNodeData,
  PresetCategory,
  PresetDefinition,
  TextNodeData,
  VideoNodeData,
} from '@lucid-fin/contracts';
import { isGeneratableMedia } from '@lucid-fin/shared-utils';
import type { CanvasClipboardPayload } from '../../store/slices/canvas.js';
import type { LinkEdgeData } from './edges/LinkEdge.js';
import type { FlowVisualState, PresetTrackNodeData } from './canvas-flow-types.js';
import { getDefaultNodeFrame } from '../../store/slices/canvas-helpers.js';
import { t } from '../../i18n.js';

// ---------------------------------------------------------------------------
// Preset helpers
// ---------------------------------------------------------------------------

export function localizePresetName(name: string): string {
  const key = `presetNames.${name}`;
  const localized = t(key);
  return localized !== key ? localized : name;
}

export function firstPresetNameFromCategory(
  data: PresetTrackNodeData,
  category: PresetCategory,
  presetById: Record<string, PresetDefinition>,
): string | null {
  const track = data.presetTracks?.[category];
  const first = track?.entries?.[0];
  if (!first) return null;
  if (first.blend) {
    const a = first.presetId ? presetById[first.presetId]?.name : undefined;
    const b = first.blend.presetIdB ? presetById[first.blend.presetIdB]?.name : undefined;
    const la = a ? localizePresetName(a) : undefined;
    const lb = b ? localizePresetName(b) : undefined;
    if (la && lb) return `${la} + ${lb}`;
    return la ?? lb ?? null;
  }
  if (!first.presetId) return null;
  const name = presetById[first.presetId]?.name;
  return name ? localizePresetName(name) : null;
}

// ---------------------------------------------------------------------------
// Deep clone & shallow equality
// ---------------------------------------------------------------------------

export function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Shallow-compare two plain data objects (one level deep). */
export function shallowDataEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

export function buildClipboardPayload(
  canvas: { id: string; nodes: CanvasNodeDTO[]; edges: CanvasEdgeDTO[] },
  selectedNodeIds: string[],
): CanvasClipboardPayload | null {
  if (selectedNodeIds.length === 0) return null;
  const nodeIdSet = new Set(selectedNodeIds);
  return {
    version: 1,
    sourceCanvasId: canvas.id,
    nodes: canvas.nodes.filter((node) => nodeIdSet.has(node.id)).map((node) => cloneDeep(node)),
    edges: canvas.edges
      .filter((edge) => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target))
      .map((edge) => cloneDeep(edge)),
    copiedAt: Date.now(),
  };
}

export function parseClipboardPayload(raw: string): CanvasClipboardPayload | null {
  try {
    const parsed = JSON.parse(raw) as { type?: string; payload?: CanvasClipboardPayload };
    if (parsed.type === 'lucid-canvas-selection' && parsed.payload?.version === 1) {
      return parsed.payload;
    }
  } catch {
    // malformed or non-lucid clipboard JSON — return null to skip paste
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export function collectNodeSearchText(node: CanvasNodeDTO): string {
  const fragments: Array<string | undefined> = [node.title, node.status, node.type];
  if (node.type === 'text') {
    fragments.push((node.data as TextNodeData).content);
  }
  if (isGeneratableMedia(node.type)) {
    const generationData = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
    fragments.push(
      generationData.prompt,
      generationData.providerId,
      typeof generationData.seed === 'number' ? String(generationData.seed) : '',
      generationData.error,
    );
  }
  if (node.type === 'audio') {
    fragments.push((node.data as AudioNodeData).audioType);
  }
  if (node.type === 'backdrop') {
    fragments.push((node.data as BackdropNodeData).color);
  }
  return fragments.filter(Boolean).join(' ').toLowerCase();
}

// ---------------------------------------------------------------------------
// Dependency graph traversal
// ---------------------------------------------------------------------------

export interface DependencyState {
  upstream: Set<string>;
  downstream: Set<string>;
  upstreamEdges: Set<string>;
  downstreamEdges: Set<string>;
}

export function collectDependencies(
  edges: CanvasEdgeDTO[],
  focusNodeId: string,
): DependencyState {
  // Build adjacency lists once — O(E) — instead of scanning all edges per walk step.
  const byTarget = new Map<string, { source: string; id: string }[]>();
  const bySource = new Map<string, { target: string; id: string }[]>();
  for (const edge of edges) {
    let list = byTarget.get(edge.target);
    if (!list) { list = []; byTarget.set(edge.target, list); }
    list.push({ source: edge.source, id: edge.id });

    let list2 = bySource.get(edge.source);
    if (!list2) { list2 = []; bySource.set(edge.source, list2); }
    list2.push({ target: edge.target, id: edge.id });
  }

  const upstream = new Set<string>();
  const downstream = new Set<string>();
  const upstreamEdges = new Set<string>();
  const downstreamEdges = new Set<string>();

  // DFS upstream: follow edges where target === current node
  const walkUp = (nodeId: string, visited: Set<string>) => {
    for (const { source, id } of byTarget.get(nodeId) ?? []) {
      if (visited.has(source)) continue;
      visited.add(source);
      upstream.add(source);
      upstreamEdges.add(id);
      walkUp(source, visited);
    }
  };

  // DFS downstream: follow edges where source === current node
  const walkDown = (nodeId: string, visited: Set<string>) => {
    for (const { target, id } of bySource.get(nodeId) ?? []) {
      if (visited.has(target)) continue;
      visited.add(target);
      downstream.add(target);
      downstreamEdges.add(id);
      walkDown(target, visited);
    }
  };

  walkUp(focusNodeId, new Set([focusNodeId]));
  walkDown(focusNodeId, new Set([focusNodeId]));

  return { upstream, downstream, upstreamEdges, downstreamEdges };
}

// ---------------------------------------------------------------------------
// DTO → React Flow mapping
// ---------------------------------------------------------------------------

const DEFAULT_EDGE_MARKER_END = { type: MarkerType.ArrowClosed, width: 16, height: 16 };

export function toFlowNode(
  n: CanvasNodeDTO,
  presetById: Record<string, PresetDefinition>,
  visualState: FlowVisualState,
  allNodes: CanvasNodeDTO[] = [],
  backdropChildCounts?: Map<string, number>,
): Node {
  const defaultFrame = getDefaultNodeFrame(n.type);
  const base = {
    id: n.id,
    type: n.type,
    position: n.position,
    width: n.width && n.width > 0 ? n.width : defaultFrame?.width,
    height: n.height && n.height > 0 ? n.height : defaultFrame?.height,
    dragHandle: undefined,
    style: {
      opacity: visualState.dimmed ? (n.type === 'backdrop' ? 0.28 : 0.22) : 1,
      // Use boxShadow instead of filter: drop-shadow — drop-shadow forces
      // each node into its own GPU compositing layer, causing massive
      // compositor overhead during pan/drag with many nodes.
      boxShadow:
        visualState.dependencyRole === 'upstream'
          ? '0 0 12px 2px rgba(245, 158, 11, 0.45)'
          : visualState.dependencyRole === 'downstream'
            ? '0 0 12px 2px rgba(56, 189, 248, 0.45)'
            : visualState.dependencyRole === 'focus'
              ? '0 0 14px 3px rgba(168, 85, 247, 0.5)'
              : undefined,
      zIndex: n.type === 'backdrop' ? 0 : 10,
    },
  };

  switch (n.type) {
    case 'text': {
      const td = n.data as TextNodeData;
      return {
        ...base,
        data: {
          nodeId: n.id,
          title: n.title,
          content: td.content,
          status: n.status,
          bypassed: n.bypassed,
          locked: n.locked,
          colorTag: n.colorTag,
        },
      };
    }
    case 'image': {
      const id = n.data as ImageNodeData;
      const presetData = n.data as unknown as PresetTrackNodeData;
      const cameraName = firstPresetNameFromCategory(presetData, 'camera', presetById);
      const lookName = firstPresetNameFromCategory(presetData, 'look', presetById);
      const emotionName = firstPresetNameFromCategory(presetData, 'emotion', presetById);
      const summary = [cameraName, lookName, emotionName].filter(Boolean).join(', ');
      return {
        ...base,
        data: {
          nodeId: n.id,
          title: n.title,
          status: n.status,
          bypassed: n.bypassed,
          locked: n.locked,
          colorTag: n.colorTag,
          assetHash: id.assetHash,
          generationStatus: id.status,
          variants: id.variants,
          selectedVariantIndex: id.selectedVariantIndex,
          seed: id.seed,
          seedLocked: id.seedLocked ?? false,
          estimatedCost: id.estimatedCost,
          providerId: id.providerId,
          variantCount: id.variantCount,
          progress: id.progress,
          error: id.error,
          presetSummary: summary,
        },
      };
    }
    case 'video': {
      const vd = n.data as VideoNodeData;
      const presetData = n.data as unknown as PresetTrackNodeData;
      const cameraName = firstPresetNameFromCategory(presetData, 'camera', presetById);
      const flowName = firstPresetNameFromCategory(presetData, 'flow', presetById);
      const emotionName = firstPresetNameFromCategory(presetData, 'emotion', presetById);
      const summary = [cameraName, flowName, emotionName].filter(Boolean).join(', ');
      const firstFrameNode = vd.firstFrameNodeId ? allNodes.find((x) => x.id === vd.firstFrameNodeId) : undefined;
      const lastFrameNode = vd.lastFrameNodeId ? allNodes.find((x) => x.id === vd.lastFrameNodeId) : undefined;
      const firstFrameHash =
        vd.firstFrameAssetHash ??
        (firstFrameNode ? (firstFrameNode.data as ImageNodeData).assetHash : undefined);
      const lastFrameHash =
        vd.lastFrameAssetHash ??
        (lastFrameNode ? (lastFrameNode.data as ImageNodeData).assetHash : undefined);
      return {
        ...base,
        data: {
          nodeId: n.id,
          title: n.title,
          status: n.status,
          bypassed: n.bypassed,
          locked: n.locked,
          colorTag: n.colorTag,
          assetHash: vd.assetHash,
          generationStatus: vd.status,
          duration: vd.duration,
          variants: vd.variants,
          selectedVariantIndex: vd.selectedVariantIndex,
          seed: vd.seed,
          seedLocked: vd.seedLocked ?? false,
          estimatedCost: vd.estimatedCost,
          providerId: vd.providerId,
          variantCount: vd.variantCount,
          progress: vd.progress,
          error: vd.error,
          presetSummary: summary,
          firstFrameHash,
          lastFrameHash,
        },
      };
    }
    case 'audio': {
      const ad = n.data as AudioNodeData;
      return {
        ...base,
        data: {
          nodeId: n.id,
          title: n.title,
          status: n.status,
          bypassed: n.bypassed,
          locked: n.locked,
          colorTag: n.colorTag,
          assetHash: ad.assetHash,
          audioType: ad.audioType,
          duration: ad.duration,
          generationStatus: ad.status,
          variants: ad.variants ?? [],
          selectedVariantIndex: ad.selectedVariantIndex ?? 0,
          seed: ad.seed,
          seedLocked: ad.seedLocked ?? false,
          estimatedCost: ad.estimatedCost,
          providerId: ad.providerId,
          variantCount: ad.variantCount,
          progress: ad.progress,
          error: ad.error,
        },
      };
    }
    case 'backdrop': {
      const backdrop = n.data as BackdropNodeData;
      const childCount = backdropChildCounts?.get(n.id) ?? 0;
      return {
        ...base,
        data: {
          nodeId: n.id,
          title: n.title,
          color: backdrop.color,
          opacity: backdrop.opacity,
          collapsed: backdrop.collapsed,
          locked: n.locked,
          colorTag: n.colorTag,
          width: n.width,
          height: n.height,
          borderStyle: backdrop.borderStyle,
          titleSize: backdrop.titleSize,
          childCount,
        },
      };
    }
    default:
      return { ...base, data: {} };
  }
}

export function toFlowEdge(
  e: CanvasEdgeDTO,
  targetSummaryByNodeId: Record<string, string>,
  visualState: FlowVisualState,
): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: 'link',
    markerEnd: DEFAULT_EDGE_MARKER_END,
    data: {
      label: e.data.label ?? targetSummaryByNodeId[e.target],
      status: e.data.status,
      dependencyRole: visualState.dependencyRole,
      dimmed: visualState.dimmed,
    } satisfies LinkEdgeData,
  };
}

// ---------------------------------------------------------------------------
// MiniMap color
// ---------------------------------------------------------------------------

/** Stable module-scope function — no closure, no re-creation per render. */
export function minimapNodeColor(node: { type?: string }): string {
  switch (node.type) {
    case 'text':
      return '#ffffff';
    case 'image':
      return '#3b82f6';
    case 'video':
      return '#a855f7';
    case 'audio':
      return '#22c55e';
    case 'backdrop':
      return '#334155';
    default:
      return 'hsl(var(--muted-foreground))';
  }
}
