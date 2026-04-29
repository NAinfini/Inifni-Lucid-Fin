/**
 * useFlowData — converts Redux Canvas state into React Flow nodes & edges.
 *
 * This hook owns the expensive O(N) mapping passes (`toFlowNode`, `toFlowEdge`),
 * the data-reference caching layer (`shallowDataEqual`), the backdrop-containment
 * calculation, and the `appliedNodes`/`appliedEdges` local state that preserves
 * React Flow's internal `measured`/`internals` properties across updates.
 *
 * Extracting this from CanvasWorkspace reduces the god-component from ~1680
 * to ~800 lines and makes the flow-data pipeline independently testable.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSelector, shallowEqual } from 'react-redux';
import { applyNodeChanges, type Node, type Edge } from '@xyflow/react';

import type { RootState } from '../../store/index.js';
import { selectActiveCanvas } from '../../store/slices/canvas-selectors.js';
import type { BackdropNodeData } from '@lucid-fin/contracts';
import { deriveNodeStatus } from '@lucid-fin/contracts';
import {
  toFlowNode,
  toFlowEdge,
  shallowDataEqual,
  collectNodeSearchText,
  collectDependencies,
  type DependencyState,
} from './canvas-utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseFlowDataParams {
  /** Node id for dependency highlighting. Derived from depHighlightLocked
   *  + selectedNodeIds in CanvasWorkspace. */
  dependencyFocusNodeId: string | null;
}

export interface FlowDataResult {
  /** React Flow nodes with selection overlay applied. */
  appliedNodes: Node[];
  /** React Flow edges with selection overlay applied. */
  appliedEdges: Edge[];
  /** Setter forwarded to ReactFlow onNodesChange for local changes. */
  setAppliedNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  /** Preset summary keyed by node id — consumed by edge label fallback. */
  targetSummaryByNodeId: Record<string, string>;
  /** Node IDs matching the current search/filter criteria. */
  matchingNodeIds: Set<string>;
  /** Array copy of matchingNodeIds for stable component props. */
  matchedNodeIdsArray: string[];
  /** Whether any search or filter is active. */
  searchActive: boolean;
  /** Dependency state for the focused node. */
  dependencyState: DependencyState;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFlowData(params: UseFlowDataParams): FlowDataResult {
  const { dependencyFocusNodeId } = params;

  // ---- Redux selectors ----
  const canvas = useSelector(selectActiveCanvas);
  const selectedNodeIds = useSelector((s: RootState) => s.canvas.selectedNodeIds);
  const selectedEdgeIds = useSelector((s: RootState) => s.canvas.selectedEdgeIds);
  const presetById = useSelector((s: RootState) => s.presets.byId);
  const canvasSearchQuery = useSelector((s: RootState) => s.ui.canvasSearchQuery);
  const canvasStatusFilters = useSelector((s: RootState) => s.ui.canvasStatusFilters, shallowEqual);
  const canvasTypeFilters = useSelector((s: RootState) => s.ui.canvasTypeFilters, shallowEqual);
  const hoveredDependencyNodeId = useSelector((s: RootState) => s.ui.hoveredDependencyNodeId);

  // ---- Search / filter ----
  const searchQuery = canvasSearchQuery.trim().toLowerCase();
  const searchActive =
    searchQuery.length > 0 || canvasStatusFilters.length > 0 || canvasTypeFilters.length > 0;

  const matchingNodeIds = useMemo(() => {
    const matches = new Set<string>();
    for (const node of canvas?.nodes ?? []) {
      const matchesQuery =
        searchQuery.length === 0 || collectNodeSearchText(node).includes(searchQuery);
      const matchesType = canvasTypeFilters.length === 0 || canvasTypeFilters.includes(node.type);
      const matchesStatus =
        canvasStatusFilters.length === 0 || canvasStatusFilters.includes(deriveNodeStatus(node));
      if (matchesQuery && matchesType && matchesStatus) {
        matches.add(node.id);
      }
    }
    return matches;
  }, [canvas?.nodes, canvasStatusFilters, canvasTypeFilters, searchQuery]);

  const matchedNodeIdsArray = useMemo(() => Array.from(matchingNodeIds), [matchingNodeIds]);

  // ---- Dependency graph ----
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

  // ---- Flow nodes ----
  const flowNodeDataCacheRef = useRef(new Map<string, Record<string, unknown>>());

  const flowNodes = useMemo<Node[]>(() => {
    const allCanvasNodes = canvas?.nodes ?? [];

    // Single-pass backdrop containment: O(N × B) done once, reused for
    // child counts AND collapsed-backdrop hiding.
    const backdrops = allCanvasNodes.filter((n) => n.type === 'backdrop');
    const backdropChildCounts = new Map<string, number>();
    const hiddenIds = new Set<string>();
    if (backdrops.length > 0) {
      const collapsedIds = new Set(
        backdrops.filter((b) => (b.data as BackdropNodeData).collapsed).map((b) => b.id),
      );
      for (const bd of backdrops) {
        backdropChildCounts.set(bd.id, 0);
      }
      for (const other of allCanvasNodes) {
        if (other.type === 'backdrop') continue;
        const cx = other.position.x + (other.width ?? 200) / 2;
        const cy = other.position.y + (other.height ?? 100) / 2;
        for (const bd of backdrops) {
          const bx = bd.position.x;
          const by = bd.position.y;
          const bw = bd.width ?? 420;
          const bh = bd.height ?? 240;
          if (cx >= bx && cx <= bx + bw && cy >= by && cy <= by + bh) {
            backdropChildCounts.set(bd.id, (backdropChildCounts.get(bd.id) ?? 0) + 1);
            if (collapsedIds.has(bd.id)) hiddenIds.add(other.id);
          }
        }
      }
    }

    const prevCache = flowNodeDataCacheRef.current;
    const nextCache = new Map<string, Record<string, unknown>>();

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
      const rfNode = toFlowNode(
        node,
        presetById,
        { dependencyRole, dimmed },
        allCanvasNodes,
        backdropChildCounts,
      );

      // Stabilize data reference: if the new data is shallow-equal to the
      // cached version, reuse the old object so memo() can skip re-render.
      const newData = rfNode.data as Record<string, unknown>;
      const cachedData = prevCache.get(node.id);
      if (cachedData && shallowDataEqual(newData, cachedData)) {
        rfNode.data = cachedData;
      }
      nextCache.set(node.id, rfNode.data as Record<string, unknown>);

      if (hiddenIds.has(node.id)) {
        rfNode.hidden = true;
        rfNode.style = { ...rfNode.style, display: 'none' };
      }
      return rfNode;
    });

    flowNodeDataCacheRef.current = nextCache;
    return nodes;
  }, [
    canvas?.nodes,
    dependencyFocusNodeId,
    dependencyState.downstream,
    dependencyState.upstream,
    hoveredDependencyNodeId,
    matchingNodeIds,
    presetById,
    searchActive,
  ]);

  // ---- Applied nodes (with React Flow internals preservation) ----
  //
  // ReactFlow needs dimension changes applied to nodes for drag/selection to
  // work.  We track applied nodes in local state, resetting from Redux when
  // flowNodes change.  Selection is applied as a cheap overlay so that
  // selecting/deselecting doesn't force the expensive flowNodes useMemo to
  // recompute.
  //
  // IMPORTANT: When merging flowNodes updates, we MUST preserve existing
  // appliedNode objects that ReactFlow has already measured (they carry
  // internal `measured`/`internals` properties). Replacing them with fresh
  // objects from Redux causes the "node not initialized" drag warning and
  // breaks drag/resize.
  const [appliedNodes, setAppliedNodes] = useState<Node[]>(flowNodes);
  const selectedNodeIdsRef = useRef(selectedNodeIds);
  selectedNodeIdsRef.current = selectedNodeIds;

  useEffect(() => {
    const selectedSet = new Set(selectedNodeIdsRef.current);
    setAppliedNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return flowNodes.map((n) => {
        const existing = prevById.get(n.id);
        const wantSelected = selectedSet.has(n.id);
        if (
          existing &&
          existing.data === n.data &&
          existing.position === n.position &&
          existing.type === n.type &&
          existing.style === n.style &&
          (existing.width ?? 0) === (n.width ?? 0) &&
          (existing.height ?? 0) === (n.height ?? 0)
        ) {
          return existing.selected === wantSelected
            ? existing
            : { ...existing, selected: wantSelected };
        }
        return existing
          ? { ...existing, ...n, selected: wantSelected }
          : { ...n, selected: wantSelected };
      });
    });
  }, [flowNodes]);

  // When only selection changes (not the nodes themselves), apply cheaply
  useEffect(() => {
    const selectedSet = new Set(selectedNodeIds);
    setAppliedNodes((prev) => {
      let changed = false;
      const next = prev.map((n) => {
        const wantSelected = selectedSet.has(n.id);
        if (n.selected === wantSelected) return n;
        changed = true;
        return { ...n, selected: wantSelected };
      });
      return changed ? next : prev;
    });
  }, [selectedNodeIds]);

  // ---- Target summary for edge labels ----
  // Stabilize: only produce a new object reference when a summary value
  // actually changed.  This prevents the flowEdges useMemo from recomputing
  // when flowNodes changed for non-preset reasons (position, selection, etc.).
  const prevTargetSummaryRef = useRef<Record<string, string>>({});
  const targetSummaryByNodeId = useMemo(() => {
    const summary: Record<string, string> = {};
    for (const node of flowNodes) {
      const data = node.data as { presetSummary?: string };
      if (data?.presetSummary) {
        summary[node.id] = data.presetSummary;
      }
    }
    // Shallow compare: if same keys/values, reuse old reference
    const prev = prevTargetSummaryRef.current;
    const keys = Object.keys(summary);
    const prevKeys = Object.keys(prev);
    if (keys.length === prevKeys.length && keys.every((k) => prev[k] === summary[k])) {
      return prev;
    }
    prevTargetSummaryRef.current = summary;
    return summary;
  }, [flowNodes]);

  // ---- Flow edges ----
  const flowEdgeDataCacheRef = useRef(new Map<string, Record<string, unknown>>());

  const flowEdges = useMemo<Edge[]>(() => {
    const seen = new Set<string>();
    const prevCache = flowEdgeDataCacheRef.current;
    const nextCache = new Map<string, Record<string, unknown>>();
    const selectedSet = new Set(selectedNodeIds);
    const edges = (canvas?.edges ?? [])
      .filter((edge) => {
        if (seen.has(edge.id)) return false;
        seen.add(edge.id);
        return true;
      })
      .map((edge) => {
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
        const connectedToSelection = selectedSet.has(edge.source) || selectedSet.has(edge.target);
        const rfEdge = toFlowEdge(edge, targetSummaryByNodeId, {
          dependencyRole,
          dimmed,
          connectedToSelection,
        });

        // Stabilize edge data reference for memo()
        const newData = rfEdge.data as Record<string, unknown>;
        const cachedData = prevCache.get(edge.id);
        if (cachedData && shallowDataEqual(newData, cachedData)) {
          rfEdge.data = cachedData;
        }
        nextCache.set(edge.id, rfEdge.data as Record<string, unknown>);

        return rfEdge;
      });
    flowEdgeDataCacheRef.current = nextCache;
    return edges;
  }, [
    canvas?.edges,
    dependencyFocusNodeId,
    dependencyState.downstreamEdges,
    dependencyState.upstreamEdges,
    matchingNodeIds,
    searchActive,
    selectedNodeIds,
    targetSummaryByNodeId,
  ]);

  // ---- Applied edges (selection overlay) ----
  const [appliedEdges, setAppliedEdges] = useState<Edge[]>(flowEdges);
  useEffect(() => {
    const selectedSet = new Set(selectedEdgeIds);
    setAppliedEdges(
      flowEdges.map((e) => {
        const wantSelected = selectedSet.has(e.id);
        return e.selected === wantSelected ? e : { ...e, selected: wantSelected };
      }),
    );
  }, [flowEdges, selectedEdgeIds]);

  return {
    appliedNodes,
    appliedEdges,
    setAppliedNodes,
    targetSummaryByNodeId,
    matchingNodeIds,
    matchedNodeIdsArray,
    searchActive,
    dependencyState,
  };
}

// Re-export for convenience in CanvasWorkspace
export { applyNodeChanges };
