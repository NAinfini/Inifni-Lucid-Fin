import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useSelector, useDispatch, shallowEqual } from 'react-redux';
import {
  ReactFlow,
  Background,
  MiniMap,
  ConnectionMode,
  ConnectionLineType,
  useReactFlow,
  applyNodeChanges,
  type NodeTypes,
  type EdgeTypes,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type OnReconnect,
  type Node,
  type Edge,
  MarkerType,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { AppDispatch, RootState } from '../../store/index.js';
import {
  addNode,
  removeNodes,
  moveNode,
  renameNode,
  addEdge as addEdgeAction,
  copyNodes as copyNodesAction,
  insertNodeIntoEdge,
  removeEdges,
  setClipboard,
  selectVariant,
  setActiveCanvas,
  swapEdgeDirection,
  toggleSeedLock,
  setNodeColorTag,
  setNodeUploadedAsset,
  toggleLock,
  toggleBackdropCollapse,
  setBackdropOpacity,
  pasteNodes as pasteNodesAction,
  setSelection,
  clearSelection,
  updateNode,
  updateViewport,
  updateContainerSize,
  reconnectCanvasEdge,
  type CanvasClipboardPayload,
} from '../../store/slices/canvas.js';
import {
  setRightPanel,
  toggleMinimapVisible,
  toggleSearchPanel,
  toggleSnapToGrid,
} from '../../store/slices/ui.js';
import {
  type AudioNodeData,
  type BackdropNodeData,
  type CanvasEdge as CanvasEdgeDTO,
  type CanvasNode as CanvasNodeDTO,
  type CanvasNodeType,
  type ImageNodeData,
  type PresetCategory,
  type PresetDefinition,
  type PresetTrack,
  type PresetTrackSet,
  type TextNodeData,
  type VideoNodeData,
} from '@lucid-fin/contracts';

import { TextNode } from './nodes/TextNode.js';
import { ImageNode } from './nodes/ImageNode.js';
import { VideoNode } from './nodes/VideoNode.js';
import { AudioNode } from './nodes/AudioNode.js';
import { BackdropNode } from './nodes/BackdropNode.js';
import { LinkEdge, type LinkEdgeData } from './edges/LinkEdge.js';
import { CanvasSearchPanel } from './CanvasSearchPanel.js';
import { CanvasToolbar } from './CanvasToolbar.js';
import { VideoCloneDialog } from './VideoCloneDialog.js';
import { EditView } from './views/EditView.js';
import { AudioView } from './views/AudioView.js';
import { MaterialsView } from './views/MaterialsView.js';
import { CanvasContextMenu, setContextMenuPosition } from './CanvasContextMenu.js';
import { useCanvasGeneration } from '../../hooks/useCanvasGeneration.js';
import { useCanvasKeyboard } from '../../hooks/useCanvasKeyboard.js';
import { useCanvasDragDrop } from '../../hooks/useCanvasDragDrop.js';
import { debounce } from '../../utils/performance.js';
import { getAPI } from '../../utils/api.js';
import { cn as _cn } from '../../lib/utils.js';
import { downloadWorkflowDocument } from '../../utils/workflowExport.js';
import { materializeImportedCanvas, readWorkflowDocument } from '../../utils/workflowImport.js';
import { buildExternalAIPrompt } from '../../utils/prompt-export.js';
import { t } from '../../i18n.js';
import {
  duplicateNode,
  disconnectNode,
  setCanvases,
} from '../../store/slices/canvas.js';
import { getDefaultNodeFrame } from '../../store/slices/canvas-helpers.js';

// ---- React Flow node/edge type registrations --------------------------------

const nodeTypes: NodeTypes = {
  backdrop: BackdropNode,
  text: TextNode,
  image: ImageNode,
  video: VideoNode,
  audio: AudioNode,
};

const edgeTypes: EdgeTypes = {
  link: LinkEdge,
};

// ---- Node context menu callbacks interface -----------------------------------

interface NodeContextCallbacks {
  onTitleChange: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCut: (id: string) => void;
  onCopy: (id: string) => void;
  onPaste: (id: string) => void;
  onDisconnect: (id: string) => void;
  onConnectTo: (id: string) => void;
  onRename: (id: string) => void;
  onGenerate: (id: string) => void;
  onLock: (id: string) => void;
  onColorTag: (id: string, color: string | undefined) => void;
  onCopyPromptForAI: (id: string) => void;
  onUpload: (id: string) => void;
  onSelectVariant: (id: string, index: number) => void;
  onToggleSeedLock: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onOpacityChange: (id: string, opacity: number) => void;
}

interface PresetTrackNodeData {
  presetTracks?: Partial<PresetTrackSet> | Record<string, PresetTrack>;
}

interface FlowVisualState {
  dependencyRole: 'upstream' | 'downstream' | 'focus' | null;
  dimmed: boolean;
}

function localizePresetName(name: string): string {
  const key = `presetNames.${name}`;
  const localized = t(key);
  return localized !== key ? localized : name;
}

function firstPresetNameFromCategory(
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

function cloneDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildClipboardPayload(
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

function parseClipboardPayload(raw: string): CanvasClipboardPayload | null {
  try {
    const parsed = JSON.parse(raw) as { type?: string; payload?: CanvasClipboardPayload };
    if (parsed.type === 'lucid-canvas-selection' && parsed.payload?.version === 1) {
      return parsed.payload;
    }
  } catch { /* malformed or non-lucid clipboard JSON — return null to skip paste */
    return null;
  }
  return null;
}

function collectNodeSearchText(node: CanvasNodeDTO): string {
  const fragments: Array<string | undefined> = [node.title, node.status, node.type];
  if (node.type === 'text') {
    fragments.push((node.data as TextNodeData).content);
  }
  if (node.type === 'image' || node.type === 'video' || node.type === 'audio') {
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

function collectDependencies(edges: CanvasEdgeDTO[], focusNodeId: string): {
  upstream: Set<string>;
  downstream: Set<string>;
  upstreamEdges: Set<string>;
  downstreamEdges: Set<string>;
} {
  const upstream = new Set<string>();
  const downstream = new Set<string>();
  const upstreamEdges = new Set<string>();
  const downstreamEdges = new Set<string>();

  const walk = (
    direction: 'upstream' | 'downstream',
    nodeId: string,
    visited: Set<string>,
    nodes: Set<string>,
    edgeIds: Set<string>,
  ) => {
    for (const edge of edges) {
      const nextNodeId =
        direction === 'upstream'
          ? edge.target === nodeId
            ? edge.source
            : null
          : edge.source === nodeId
            ? edge.target
            : null;

      if (!nextNodeId || visited.has(nextNodeId)) continue;
      visited.add(nextNodeId);
      nodes.add(nextNodeId);
      edgeIds.add(edge.id);
      walk(direction, nextNodeId, visited, nodes, edgeIds);
    }
  };

  walk('upstream', focusNodeId, new Set([focusNodeId]), upstream, upstreamEdges);
  walk('downstream', focusNodeId, new Set([focusNodeId]), downstream, downstreamEdges);

  return { upstream, downstream, upstreamEdges, downstreamEdges };
}

// ---- Helper: convert CanvasNodeDTO → React Flow Node -----------------------

function toFlowNode(
  n: CanvasNodeDTO,
  callbacks: NodeContextCallbacks,
  presetById: Record<string, PresetDefinition>,
  visualState: FlowVisualState,
  allNodes: CanvasNodeDTO[] = [],
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
      filter:
        visualState.dependencyRole === 'upstream'
          ? 'drop-shadow(0 0 12px rgba(245, 158, 11, 0.45))'
          : visualState.dependencyRole === 'downstream'
            ? 'drop-shadow(0 0 12px rgba(56, 189, 248, 0.45))'
            : visualState.dependencyRole === 'focus'
              ? 'drop-shadow(0 0 14px rgba(168, 85, 247, 0.5))'
              : undefined,
      zIndex: n.type === 'backdrop' ? 0 : 10,
    },
  };

  const contextCallbacks: NodeContextCallbacks = callbacks;

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
          ...contextCallbacks,
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
          ...contextCallbacks,
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
          ...contextCallbacks,
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
          ...contextCallbacks,
        },
      };
    }
    case 'backdrop': {
      const backdrop = n.data as BackdropNodeData;
      // Count child nodes whose center falls within the backdrop bounds
      const bx = n.position.x;
      const by = n.position.y;
      const bw = n.width ?? 420;
      const bh = n.height ?? 240;
      let childCount = 0;
      for (const other of allNodes) {
        if (other.id === n.id || other.type === 'backdrop') continue;
        const ow = other.width ?? 200;
        const oh = other.height ?? 100;
        const cx = other.position.x + ow / 2;
        const cy = other.position.y + oh / 2;
        if (cx >= bx && cx <= bx + bw && cy >= by && cy <= by + bh) {
          childCount++;
        }
      }
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
          ...contextCallbacks,
        },
      };
    }
    default:
      return { ...base, data: {} };
  }
}

// ---- Helper: convert CanvasEdgeDTO → React Flow Edge -----------------------

function toFlowEdge(
  e: CanvasEdgeDTO,
  onDelete: (id: string) => void,
  onSwap: (id: string) => void,
  onInsertNode: (id: string, type: CanvasNodeType, position: { x: number; y: number }) => void,
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
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    data: {
      label: e.data.label ?? targetSummaryByNodeId[e.target],
      status: e.data.status,
      onDelete,
      onSwapDirection: onSwap,
      onInsertNode,
      dependencyRole: visualState.dependencyRole,
      dimmed: visualState.dimmed,
    } satisfies LinkEdgeData,
  };
}

// ---- Main component --------------------------------------------------------

export function CanvasWorkspace() {
  const dispatch = useDispatch<AppDispatch>();
  const reactFlow = useReactFlow();
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const workflowImportInputRef = useRef<HTMLInputElement | null>(null);
  const { generate } = useCanvasGeneration();
  const hoveredNodeIdRef = useRef<string | null>(null);
  // Track children captured by a backdrop when drag starts
  const backdropChildrenRef = useRef<Map<string, { offsetX: number; offsetY: number }>>(new Map());
  const [depHighlightLocked, setDepHighlightLocked] = useState(false);
  const [connectingFromNodeId, setConnectingFromNodeId] = useState<string | null>(null);
  const [videoCloneOpen, setVideoCloneOpen] = useState(false);

  const activeCanvasId = useSelector((s: RootState) => s.canvas.activeCanvasId);
  const canvas = useSelector((s: RootState) =>
    s.canvas.canvases.find((c) => c.id === activeCanvasId),
  );
  const projectStyleGuide = useSelector((s: RootState) => s.project.styleGuide);
  const selectedNodeIds = useSelector((s: RootState) => s.canvas.selectedNodeIds);
  const selectedEdgeIds = useSelector((s: RootState) => s.canvas.selectedEdgeIds);
  const clipboard = useSelector((s: RootState) => s.canvas.clipboard, shallowEqual);
  const presetById = useSelector((s: RootState) => s.presets.byId);
  const {
    canvasSearchQuery,
    canvasStatusFilters,
    canvasTypeFilters,
    minimapVisible,
    searchPanelOpen,
    snapToGrid,
    rightPanel,
    hoveredDependencyNodeId,
    canvasViewMode,
    editViewFocusedNodeId,
  } = useSelector((s: RootState) => s.ui);

  const debouncedViewportUpdate = useMemo(
    () => debounce((viewport: { x: number; y: number; zoom: number }) => dispatch(updateViewport(viewport)), 120),
    [dispatch],
  );

  // Callbacks for node title changes
  const handleTitleChange = useCallback(
    (id: string, title: string) => {
      dispatch(renameNode({ id, title }));
    },
    [dispatch],
  );

  // Callbacks for node context menu actions
  const handleNodeDelete = useCallback(
    (id: string) => {
      dispatch(removeNodes([id]));
    },
    [dispatch],
  );

  const handleNodeDuplicate = useCallback(
    (id: string) => {
      const newId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      dispatch(duplicateNode({ sourceId: id, newId }));
    },
    [dispatch],
  );

  const handleNodeDisconnect = useCallback(
    (id: string) => {
      dispatch(disconnectNode(id));
    },
    [dispatch],
  );

  const handleNodeRename = useCallback((_id: string) => {
    // Rename is handled inline via double-click on title in node components
    // This callback is a no-op placeholder for the context menu
  }, []);

  const handleNodeGenerate = useCallback(
    (id: string) => {
      void generate(id);
    },
    [generate],
  );

  const handleNodeCut = useCallback(
    (id: string) => {
      if (!canvas) return;
      const payload = buildClipboardPayload(canvas, [id]);
      if (!payload) return;
      dispatch(copyNodesAction([id]));
      dispatch(setClipboard(payload));
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(
          JSON.stringify({ type: 'lucid-canvas-selection', payload }),
        );
      }
      dispatch(removeNodes([id]));
    },
    [canvas, dispatch],
  );

  const handleNodeCopy = useCallback(
    (id: string) => {
      if (!canvas) return;
      const payload = buildClipboardPayload(canvas, [id]);
      if (!payload) return;
      dispatch(copyNodesAction([id]));
      dispatch(setClipboard(payload));
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(
          JSON.stringify({ type: 'lucid-canvas-selection', payload }),
        );
      }
    },
    [canvas, dispatch],
  );

  const handleNodePaste = useCallback(
    async (_id: string) => {
      let payload = clipboard;
      try {
        if (navigator.clipboard?.readText) {
          const raw = await navigator.clipboard.readText();
          payload = parseClipboardPayload(raw) ?? payload;
        }
      } catch { /* clipboard permission denied — fall back to redux clipboard */ }
      if (!payload) return;
      dispatch(setClipboard(payload));
      dispatch(pasteNodesAction({ offset: { x: 50, y: 50 } }));
    },
    [clipboard, dispatch],
  );

  const handleNodeLock = useCallback(
    (id: string) => {
      dispatch(toggleLock({ id }));
    },
    [dispatch],
  );

  const handleCopyPromptForAI = useCallback(
    (id: string) => {
      if (!canvas) return;
      // targetSummaryByNodeId is computed later in the render, use flowNodes directly
      const summaries: Record<string, string> = {};
      for (const node of (canvas.nodes ?? [])) {
        const presetData = node.data as unknown as { presetTracks?: Record<string, unknown> };
        if (presetData.presetTracks) {
          const names: string[] = [];
          for (const [, track] of Object.entries(presetData.presetTracks)) {
            const t = track as { entries?: Array<{ presetId?: string }> };
            if (t.entries?.[0]?.presetId) {
              const p = presetById[t.entries[0].presetId];
              if (p?.name) names.push(localizePresetName(p.name));
            }
          }
          if (names.length > 0) summaries[node.id] = names.join(', ');
        }
      }
      const prompt = buildExternalAIPrompt(canvas, id, summaries);
      void navigator.clipboard.writeText(prompt);
    },
    [canvas, presetById],
  );

  const handleNodeColorTag = useCallback(
    (id: string, color: string | undefined) => {
      dispatch(setNodeColorTag({ id, colorTag: color }));
    },
    [dispatch],
  );

  const handleConnectTo = useCallback(
    (id: string) => {
      setConnectingFromNodeId(id);
    },
    [],
  );

  const handleSelectVariant = useCallback(
    (id: string, index: number) => {
      dispatch(selectVariant({ id, index }));
    },
    [dispatch],
  );

  const handleToggleSeedLock = useCallback(
    (id: string) => {
      dispatch(toggleSeedLock({ id }));
    },
    [dispatch],
  );

  const handleToggleCollapse = useCallback(
    (id: string) => {
      dispatch(toggleBackdropCollapse({ id }));
    },
    [dispatch],
  );

  const handleOpacityChange = useCallback(
    (id: string, opacity: number) => {
      dispatch(setBackdropOpacity({ id, opacity }));
    },
    [dispatch],
  );

  const handleNodeUpload = useCallback(
    async (id: string) => {
      const api = getAPI();
      if (!api) return;
      const node = canvas?.nodes.find((n) => n.id === id);
      if (!node) return;
      const ref = await api.asset.pickFile(node.type) as { hash: string } | null;
      if (!ref) return;
      dispatch(setNodeUploadedAsset({ id, assetHash: ref.hash }));
    },
    [canvas?.nodes, dispatch],
  );

  const nodeCallbacks = useMemo<NodeContextCallbacks>(
    () => ({
      onTitleChange: handleTitleChange,
      onDelete: handleNodeDelete,
      onDuplicate: handleNodeDuplicate,
      onCut: handleNodeCut,
      onCopy: handleNodeCopy,
      onPaste: (id: string) => { void handleNodePaste(id); },
      onDisconnect: handleNodeDisconnect,
      onConnectTo: handleConnectTo,
      onRename: handleNodeRename,
      onGenerate: handleNodeGenerate,
      onLock: handleNodeLock,
      onColorTag: handleNodeColorTag,
      onCopyPromptForAI: handleCopyPromptForAI,
      onUpload: (id: string) => { void handleNodeUpload(id); },
      onSelectVariant: handleSelectVariant,
      onToggleSeedLock: handleToggleSeedLock,
      onToggleCollapse: handleToggleCollapse,
      onOpacityChange: handleOpacityChange,
    }),
    [
      handleTitleChange,
      handleNodeDelete,
      handleNodeDuplicate,
      handleNodeCut,
      handleNodeCopy,
      handleNodePaste,
      handleNodeDisconnect,
      handleConnectTo,
      handleNodeRename,
      handleNodeGenerate,
      handleNodeLock,
      handleNodeColorTag,
      handleCopyPromptForAI,
      handleNodeUpload,
      handleSelectVariant,
      handleToggleSeedLock,
      handleToggleCollapse,
      handleOpacityChange,
    ],
  );

  // Callbacks for edge actions
  const handleEdgeDelete = useCallback(
    (id: string) => {
      dispatch(removeEdges([id]));
    },
    [dispatch],
  );

  const handleEdgeSwap = useCallback(
    (id: string) => {
      dispatch(swapEdgeDirection(id));
    },
    [dispatch],
  );

  const handleInsertNodeIntoEdge = useCallback(
    (edgeId: string, type: CanvasNodeType, position: { x: number; y: number }) => {
      dispatch(
        insertNodeIntoEdge({
          edgeId,
          nodeType: type,
          position,
          title:
            type === 'backdrop'
              ? 'Inserted Frame'
              : `Inserted ${type[0]!.toUpperCase()}${type.slice(1)}`,
        }),
      );
    },
    [dispatch],
  );

  // Convert Redux state → React Flow nodes/edges
  const searchQuery = canvasSearchQuery.trim().toLowerCase();
  const searchActive =
    searchQuery.length > 0 || canvasStatusFilters.length > 0 || canvasTypeFilters.length > 0;

  const matchingNodeIds = useMemo(() => {
    const matches = new Set<string>();
    for (const node of canvas?.nodes ?? []) {
      const matchesQuery = searchQuery.length === 0 || collectNodeSearchText(node).includes(searchQuery);
      const matchesType =
        canvasTypeFilters.length === 0 || canvasTypeFilters.includes(node.type);
      const matchesStatus =
        canvasStatusFilters.length === 0 || canvasStatusFilters.includes(node.status);
      if (matchesQuery && matchesType && matchesStatus) {
        matches.add(node.id);
      }
    }
    return matches;
  }, [canvas?.nodes, canvasStatusFilters, canvasTypeFilters, searchQuery]);

  const matchedNodeIdsArray = useMemo(() => Array.from(matchingNodeIds), [matchingNodeIds]);

  const handleNavigateToNode = useCallback(
    (nodeId: string) => {
      const node = canvas?.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const w = node.width ?? 200;
      const h = node.height ?? 100;
      reactFlow.setCenter(node.position.x + w / 2, node.position.y + h / 2, {
        zoom: 1,
        duration: 300,
      });
      dispatch(setSelection({ nodeIds: [nodeId], edgeIds: [] }));
    },
    [canvas?.nodes, dispatch, reactFlow],
  );

  const dependencyFocusNodeId = depHighlightLocked
    ? selectedNodeIds[0] ?? null
    : null;

  const dependencyState = useMemo(() => {
    if (!canvas || !dependencyFocusNodeId) {
      return {
        upstream: new Set<string>(),
        downstream: new Set<string>(),
        upstreamEdges: new Set<string>(),
        downstreamEdges: new Set<string>(),
      };
    }
    return collectDependencies(canvas.edges, dependencyFocusNodeId);
  }, [canvas, dependencyFocusNodeId]);

  const flowNodes = useMemo<Node[]>(() => {
      const allCanvasNodes = canvas?.nodes ?? [];
      const nodes = allCanvasNodes.map((node) => {
        const isHoveredDep = hoveredDependencyNodeId === node.id;
        const dependencyRole =
          node.id === dependencyFocusNodeId
            ? 'focus'
            : dependencyState.upstream.has(node.id)
              ? 'upstream'
              : dependencyState.downstream.has(node.id)
                ? 'downstream'
                : isHoveredDep
                  ? 'focus'
                  : null;
        const dimmed =
          (searchActive && !matchingNodeIds.has(node.id)) ||
          (!!dependencyFocusNodeId && dependencyRole === null && node.id !== dependencyFocusNodeId);
        const rfNode = toFlowNode(node, nodeCallbacks, presetById, {
          dependencyRole,
          dimmed,
        }, allCanvasNodes);
        rfNode.selected = selectedNodeIds.includes(node.id);
        return rfNode;
      });

      // Hide nodes inside collapsed backdrops
      const collapsedBackdrops = allCanvasNodes.filter(
        (n) => n.type === 'backdrop' && (n.data as BackdropNodeData).collapsed,
      );
      if (collapsedBackdrops.length > 0) {
        const hiddenIds = new Set<string>();
        for (const backdrop of collapsedBackdrops) {
          const bx = backdrop.position.x;
          const by = backdrop.position.y;
          const bw = backdrop.width ?? 420;
          const bh = backdrop.height ?? 240;
          for (const other of allCanvasNodes) {
            if (other.id === backdrop.id || other.type === 'backdrop') continue;
            const ow = other.width ?? 200;
            const oh = other.height ?? 100;
            const cx = other.position.x + ow / 2;
            const cy = other.position.y + oh / 2;
            if (cx >= bx && cx <= bx + bw && cy >= by && cy <= by + bh) {
              hiddenIds.add(other.id);
            }
          }
        }
        for (const rfNode of nodes) {
          if (hiddenIds.has(rfNode.id)) {
            rfNode.hidden = true;
            rfNode.style = { ...rfNode.style, display: 'none' };
          }
        }
      }

      return nodes;
    },
    [
      canvas?.nodes,
      dependencyFocusNodeId,
      dependencyState.downstream,
      dependencyState.upstream,
      hoveredDependencyNodeId,
      matchingNodeIds,
      nodeCallbacks,
      presetById,
      searchActive,
      selectedNodeIds,
    ],
  );

  // ReactFlow needs dimension changes applied to nodes for drag/selection to work.
  // We track applied nodes in local state, resetting from Redux when flowNodes change.
  const [appliedNodes, setAppliedNodes] = useState<Node[]>(flowNodes);
  useEffect(() => {
    setAppliedNodes(flowNodes);
  }, [flowNodes]);

  const targetSummaryByNodeId = useMemo(() => {
    const summary: Record<string, string> = {};
    for (const node of flowNodes) {
      const data = node.data as { presetSummary?: string };
      if (data?.presetSummary) {
        summary[node.id] = data.presetSummary;
      }
    }
    return summary;
  }, [flowNodes]);

  const flowEdges = useMemo<Edge[]>(() => {
      const seen = new Set<string>();
      return (canvas?.edges ?? []).filter((edge) => {
        if (seen.has(edge.id)) return false;
        seen.add(edge.id);
        return true;
      }).map((edge) => {
        const dependencyRole =
          edge.source === dependencyFocusNodeId || edge.target === dependencyFocusNodeId
            ? 'focus'
            : dependencyState.upstreamEdges.has(edge.id)
              ? 'upstream'
              : dependencyState.downstreamEdges.has(edge.id)
                ? 'downstream'
                : null;
        const dimmed =
          (searchActive &&
            !matchingNodeIds.has(edge.source) &&
            !matchingNodeIds.has(edge.target)) ||
          (!!dependencyFocusNodeId && dependencyRole === null);
        const rfEdge = toFlowEdge(
          edge,
          handleEdgeDelete,
          handleEdgeSwap,
          handleInsertNodeIntoEdge,
          targetSummaryByNodeId,
          {
            dependencyRole,
            dimmed,
          },
        );
        rfEdge.selected = selectedEdgeIds.includes(edge.id);
        return rfEdge;
      });
    },
    [
      canvas?.edges,
      dependencyFocusNodeId,
      dependencyState.downstreamEdges,
      dependencyState.upstreamEdges,
      handleEdgeDelete,
      handleEdgeSwap,
      handleInsertNodeIntoEdge,
      matchingNodeIds,
      searchActive,
      selectedEdgeIds,
      targetSummaryByNodeId,
    ],
  );

  // ---- React Flow event handlers -------------------------------------------

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      // Apply ALL changes to local flow state so ReactFlow can track
      // measured dimensions, which is required for drag/selection to work.
      setAppliedNodes((prev) => applyNodeChanges(changes, prev));

      // Sync relevant changes back to Redux (source of truth for persistence)
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          // Backdrop group drag: move contained nodes with it
          if (canvas) {
            const movedNode = canvas.nodes.find((n) => n.id === change.id);
            if (movedNode?.type === 'backdrop') {
              if (change.dragging) {
                // On first drag frame, capture children and their offsets
                if (backdropChildrenRef.current.size === 0) {
                  const bw = movedNode.width ?? 420;
                  const bh = movedNode.height ?? 240;
                  for (const child of canvas.nodes) {
                    if (child.id === change.id || child.type === 'backdrop') continue;
                    const cx = child.position.x + (child.width ?? 200) / 2;
                    const cy = child.position.y + (child.height ?? 100) / 2;
                    if (cx >= movedNode.position.x && cy >= movedNode.position.y &&
                        cx <= movedNode.position.x + bw && cy <= movedNode.position.y + bh) {
                      backdropChildrenRef.current.set(child.id, {
                        offsetX: child.position.x - movedNode.position.x,
                        offsetY: child.position.y - movedNode.position.y,
                      });
                    }
                  }
                }
                // Move children maintaining their offset from backdrop
                for (const [childId, offset] of backdropChildrenRef.current) {
                  dispatch(moveNode({
                    id: childId,
                    position: {
                      x: change.position.x + offset.offsetX,
                      y: change.position.y + offset.offsetY,
                    },
                  }));
                }
              } else if (change.dragging === false) {
                // Drag ended — clear captured children
                backdropChildrenRef.current.clear();
              }
            }
          }
          dispatch(moveNode({ id: change.id, position: change.position }));
        }
        if (change.type === 'dimensions' && change.dimensions && change.resizing) {
          const { width, height } = change.dimensions;
          if (
            Number.isFinite(width) && Number.isFinite(height) &&
            width > 0 && height > 0
          ) {
            dispatch(updateNode({ id: change.id, changes: { width, height } }));
          }
        }
        if (change.type === 'remove') {
          dispatch(removeNodes([change.id]));
        }
      }
    },
    [canvas, dispatch],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => {
      for (const change of changes) {
        if (change.type === 'remove') {
          dispatch(removeEdges([change.id]));
        }
      }
    },
    [dispatch],
  );

  const onConnect: OnConnect = useCallback(
    (connection) => {
      if (!connection.source || !connection.target) return;
      dispatch(
        addEdgeAction({
          id: `e-${connection.source}-${connection.target}-${Date.now()}`,
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle ?? undefined,
          targetHandle: connection.targetHandle ?? undefined,
          data: { status: 'idle' },
        }),
      );
    },
    [dispatch],
  );

  const onReconnect: OnReconnect = useCallback(
    (oldEdge, newConnection) => {
      if (!newConnection.source || !newConnection.target) {
        return;
      }

      dispatch(
        reconnectCanvasEdge({
          edgeId: oldEdge.id,
          connection: {
            source: newConnection.source,
            target: newConnection.target,
            sourceHandle: newConnection.sourceHandle ?? null,
            targetHandle: newConnection.targetHandle ?? null,
          },
        }),
      );
    },
    [dispatch],
  );

  const onSelectionChange = useCallback(
    ({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) => {
      dispatch(
        setSelection({
          nodeIds: nodes.map((n) => n.id),
          edgeIds: edges.map((e) => e.id),
        }),
      );
    },
    [dispatch],
  );

  const onPaneClick = useCallback(() => {
    hoveredNodeIdRef.current = null;
    setConnectingFromNodeId(null);
    dispatch(clearSelection());
  }, [dispatch]);

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      if (connectingFromNodeId) {
        if (node.id === connectingFromNodeId) {
          setConnectingFromNodeId(null);
          return;
        }
        dispatch(
          addEdgeAction({
            id: `e-${connectingFromNodeId}-${node.id}-${Date.now()}`,
            source: connectingFromNodeId,
            target: node.id,
            data: { status: 'idle' },
          }),
        );
        setConnectingFromNodeId(null);
        return;
      }
      dispatch(setSelection({ nodeIds: [node.id], edgeIds: [] }));
      if (!rightPanel) {
        dispatch(setRightPanel('inspector'));
      }
    },
    [connectingFromNodeId, dispatch, rightPanel],
  );

  // ---- Add node from context menu -------------------------------------------

  const handleAddNode = useCallback(
    (type: CanvasNodeType, screenPosition: { x: number; y: number }) => {
      const rfInstance = rfInstanceRef.current;
      if (!rfInstance) return;

      // Convert screen coords to flow coords
      const flowPos = rfInstance.screenToFlowPosition(screenPosition);
      const id = crypto.randomUUID();

      dispatch(
        addNode({
          type,
          position: flowPos,
          id,
          title: t(`canvas.nodeType.${type}`),
        }),
      );
    },
    [dispatch],
  );

  // Drag-drop — delegated to extracted hook
  const { handleDrop, handleDragOver } = useCanvasDragDrop(rfInstanceRef);

  // ---- Paste / Undo / Redo (shared by keyboard shortcuts + context menu) ----

  const handlePaste = useCallback(async () => {
    let payload = clipboard;
    if (navigator.clipboard?.readText) {
      const raw = await navigator.clipboard.readText();
      payload = parseClipboardPayload(raw) ?? payload;
    }
    if (!payload) return;
    dispatch(setClipboard(payload));
    dispatch(pasteNodesAction({ offset: { x: 50, y: 50 } }));
  }, [clipboard, dispatch]);

  const handleUndo = useCallback(() => {
    dispatch({ type: 'undo/undo' });
  }, [dispatch]);

  const handleRedo = useCallback(() => {
    dispatch({ type: 'undo/redo' });
  }, [dispatch]);

  // ---- Keyboard shortcuts ---------------------------------------------------

  useCanvasKeyboard({
    canvas,
    dispatch,
    selectedNodeIds,
    selectedEdgeIds,
    setConnectingFromNodeId,
    setDepHighlightLocked,
    handleNodeGenerate,
    handlePaste,
    handleUndo,
    handleRedo,
    buildClipboardPayload,
  });

  // ---- Context menu position tracking ---------------------------------------

  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    const clientX = 'clientX' in e ? e.clientX : 0;
    const clientY = 'clientY' in e ? e.clientY : 0;
    setContextMenuPosition(clientX, clientY);
  }, []);

  // ReactFlow intercepts contextmenu on the pane and calls preventDefault,
  // which stops Radix ContextMenu from triggering. We re-dispatch a synthetic
  // contextmenu event from the pane so Radix sees it.
  const handlePaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    const clientX = 'clientX' in e ? e.clientX : 0;
    const clientY = 'clientY' in e ? e.clientY : 0;
    setContextMenuPosition(clientX, clientY);
    // Re-fire contextmenu on the container so Radix ContextMenu.Trigger picks it up
    if (containerRef.current) {
      const syntheticEvent = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
      });
      containerRef.current.dispatchEvent(syntheticEvent);
    }
  }, []);

  const handleNodeContextMenu = useCallback((e: React.MouseEvent | MouseEvent, node: Node) => {
    e.preventDefault();
    const clientX = 'clientX' in e ? e.clientX : 0;
    const clientY = 'clientY' in e ? e.clientY : 0;
    setContextMenuPosition(clientX, clientY);

    // Radix ContextMenu.Trigger renders a <span> inside the React Flow wrapper.
    // Dispatch the synthetic event on that span so Radix picks it up.
    const wrapper = document.querySelector(`[data-id="${CSS.escape(node.id)}"]`);
    const triggerEl = wrapper?.firstElementChild;
    if (!triggerEl) return;

    const syntheticEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX,
      clientY,
      button: 2,
    });

    triggerEl.dispatchEvent(syntheticEvent);
  }, []);

  const handleExportWorkflow = useCallback(() => {
    if (!canvas) return;
    downloadWorkflowDocument(canvas);
  }, [canvas]);

  const handleOpenWorkflowImport = useCallback(() => {
    workflowImportInputRef.current?.click();
  }, []);

  const handleWorkflowImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !canvas) return;

      const document = await readWorkflowDocument(file);
      const replacingActiveCanvas = canvas.nodes.length === 0 && canvas.edges.length === 0;
      const importedCanvas = materializeImportedCanvas({
        document,
        canvasId: replacingActiveCanvas ? canvas.id : crypto.randomUUID(),
        projectId: canvas.projectId,
        name: replacingActiveCanvas ? canvas.name : `${document.canvas.name} Imported`,
      });

      await getAPI()?.canvas.save(importedCanvas);
      // Reload canvases from server to pick up the imported canvas
      const api = getAPI();
      if (api) {
        const list = await api.canvas.list();
        const loaded = await Promise.all(list.map((item) => api.canvas.load(item.id)));
        dispatch(setCanvases(loaded.filter(Boolean)));
      }
      dispatch(setActiveCanvas(importedCanvas.id));
      event.target.value = '';
    },
    [canvas, dispatch],
  );

  // ---- Render ---------------------------------------------------------------

  if (!canvas) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('canvasWorkspace.noCanvasSelected')}
      </div>
    );
  }

  return (
    <>
    <CanvasContextMenu
      onAddNode={handleAddNode}
      onPaste={() => { void handlePaste(); }}
      onUndo={handleUndo}
      onRedo={handleRedo}
      hasClipboard
    >
      <div
        ref={containerRef}
        className="relative h-full w-full"
        onContextMenu={handleContextMenu}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <input
          ref={workflowImportInputRef}
          type="file"
          accept=".json,.lucid-workflow.json"
          className="hidden"
          onChange={(event) => {
            void handleWorkflowImport(event);
          }}
        />
        <CanvasToolbar
          minimapVisible={minimapVisible}
          snapToGrid={snapToGrid}
          searchOpen={searchPanelOpen}
          onToggleSearch={() => dispatch(toggleSearchPanel())}
          onToggleMinimap={() => dispatch(toggleMinimapVisible())}
          onToggleSnapToGrid={() => dispatch(toggleSnapToGrid())}
          onExportWorkflow={handleExportWorkflow}
          onImportWorkflow={handleOpenWorkflowImport}
          onCloneVideo={() => setVideoCloneOpen(true)}
          styleGuide={{
            artStyle: projectStyleGuide?.global?.artStyle,
            lighting: projectStyleGuide?.global?.lighting,
            freeformDescription: projectStyleGuide?.global?.freeformDescription,
            onOpenSettings: () => { window.location.hash = '#/settings'; },
          }}
        />
        {connectingFromNodeId && (
          <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-full border border-primary/30 bg-card/95 px-3 py-1.5 text-xs text-foreground shadow-lg backdrop-blur">
            {t('canvasWorkspace.connectMode')}
          </div>
        )}
        {searchPanelOpen ? (
          <CanvasSearchPanel
            matchCount={matchingNodeIds.size}
            totalCount={canvas.nodes.length}
            matchedNodeIds={matchedNodeIdsArray}
            onNavigateToNode={handleNavigateToNode}
          />
        ) : null}
        {canvasViewMode === 'edit' && <EditView focusedNodeId={editViewFocusedNodeId} />}
        {canvasViewMode === 'audio' && <AudioView />}
        {canvasViewMode === 'materials' && <MaterialsView />}
        {canvasViewMode === 'main' && (
        <>
        <ReactFlow
          nodes={appliedNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onSelectionChange={onSelectionChange}
          onNodeClick={onNodeClick}
          onEdgeClick={(_event, edge) => {
            dispatch(setSelection({ nodeIds: [], edgeIds: [edge.id] }));
          }}
          onPaneClick={onPaneClick}
          onPaneContextMenu={handlePaneContextMenu}
          onNodeContextMenu={handleNodeContextMenu}
          onNodeMouseEnter={(_event, node) => { hoveredNodeIdRef.current = node.id; }}
          onNodeMouseLeave={() => { hoveredNodeIdRef.current = null; }}
          onPaneMouseLeave={() => { hoveredNodeIdRef.current = null; }}
          onMoveEnd={(_event, viewport) => {
            debouncedViewportUpdate(viewport);
          }}
          onInit={(instance) => {
            rfInstanceRef.current = instance;
            const wrapper = document.querySelector('.react-flow__renderer') as HTMLElement | null;
            const bounds = wrapper?.getBoundingClientRect();
            if (bounds && bounds.width > 0) {
              dispatch(updateContainerSize({ width: bounds.width, height: bounds.height }));
            }
          }}
          defaultViewport={canvas.viewport}
          fitView={false}
          snapToGrid={snapToGrid}
          snapGrid={[16, 16]}
          deleteKeyCode={null}
          multiSelectionKeyCode="Control"
          selectionOnDrag
          panOnDrag={[1, 2]}
          elementsSelectable={true}
          edgesReconnectable
          connectionMode={ConnectionMode.Loose}
          connectionLineType={ConnectionLineType.SmoothStep}
          defaultEdgeOptions={{
            type: 'link',
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
          }}
          className="bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.04),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.04),transparent_35%),hsl(var(--background))]"
        >
          <Background gap={16} size={1} color="hsl(var(--border))" />
          {minimapVisible ? (
            <MiniMap
              pannable
              zoomable
              className="!rounded-2xl !border !border-border/80 !bg-card/95 !shadow-xl"
              maskColor="rgba(15,23,42,0.45)"
              nodeBorderRadius={10}
              nodeColor={(node) => {
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
              }}
            />
          ) : null}
        </ReactFlow>
        </>
        )}
      </div>
    </CanvasContextMenu>
    <VideoCloneDialog
      open={videoCloneOpen}
      projectId={canvas?.projectId ?? null}
      onClose={() => setVideoCloneOpen(false)}
      onCanvasCreated={(canvasId) => dispatch(setActiveCanvas(canvasId))}
    />
    </>
  );
}
