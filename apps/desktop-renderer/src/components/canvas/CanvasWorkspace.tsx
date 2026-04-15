import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useSelector, useDispatch, shallowEqual } from 'react-redux';
import {
  ReactFlow,
  Background,
  MiniMap,
  ConnectionMode,
  ConnectionLineType,
  useReactFlow,
  type NodeTypes,
  type EdgeTypes,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type OnReconnect,
  type Node,
  type Edge,
  type NodeChange,
  MarkerType,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { AppDispatch, RootState } from '../../store/index.js';
import { selectActiveCanvas } from '../../store/slices/canvas-selectors.js';
import {
  addNode,
  removeNodes,
  moveNode,
  moveNodes,
  addEdge as addEdgeAction,
  removeEdges,
  setClipboard,
  setActiveCanvas,
  pasteNodes as pasteNodesAction,
  setSelection,
  clearSelection,
  updateNode,
  updateViewport,
  updateContainerSize,
  reconnectCanvasEdge,
  setCanvases,
} from '../../store/slices/canvas.js';
import {
  setRightPanel,
  toggleMinimapVisible,
  toggleSearchPanel,
  toggleSnapToGrid,
} from '../../store/slices/ui.js';
import { recordUndo, recordRedo, recordShotCreate, recordProjectActivity } from '../../store/slices/settings.js';
import { canUndo, canRedo } from '../../store/middleware/undo.js';
import { enqueueToast } from '../../store/slices/toast.js';
import type { CanvasNodeType } from '@lucid-fin/contracts';

import { TextNode } from './nodes/TextNode.js';
import { ImageNode } from './nodes/ImageNode.js';
import { VideoNode } from './nodes/VideoNode.js';
import { AudioNode } from './nodes/AudioNode.js';
import { BackdropNode } from './nodes/BackdropNode.js';
import { LinkEdge } from './edges/LinkEdge.js';
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
import { downloadWorkflowDocument } from '../../utils/workflowExport.js';
import { materializeImportedCanvas, readWorkflowDocument } from '../../utils/workflowImport.js';
import { t } from '../../i18n.js';
import {
  buildClipboardPayload,
  parseClipboardPayload,
  minimapNodeColor,
} from './canvas-utils.js';
import { useFlowData, applyNodeChanges } from './useFlowData.js';
import { useCanvasNodeCallbacks } from './useCanvasNodeCallbacks.js';
import { useCanvasEdgeCallbacks } from './useCanvasEdgeCallbacks.js';

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

const DEFAULT_EDGE_OPTIONS = {
  type: 'link' as const,
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
};

// Callbacks are delivered via Context (not via node/edge data)
// to keep data objects stable for memo().
import { NodeCallbacksContext } from './node-callbacks-context.js';
import { EdgeCallbacksContext } from './edge-callbacks-context.js';
import { useCanvasLod, CanvasLodContext } from './use-canvas-lod.js';

// ---- Main component --------------------------------------------------------

export function CanvasWorkspace() {
  const dispatch = useDispatch<AppDispatch>();
  const reactFlow = useReactFlow();
  // Single LOD subscription for all nodes — avoids N per-node Zustand subscriptions.
  const canvasLod = useCanvasLod();
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const workflowImportInputRef = useRef<HTMLInputElement | null>(null);
  const { generate } = useCanvasGeneration();
  const hoveredNodeIdRef = useRef<string | null>(null);
  // RAF-based batching: accumulate node changes across mouse events within
  // the same animation frame, then flush once. This prevents multiple
  // setAppliedNodes calls (and thus multiple React re-renders) per frame.
  const pendingNodeChangesRef = useRef<import('@xyflow/react').NodeChange[]>([]);
  const rafIdRef = useRef<number | null>(null);
  // Track children captured by a backdrop when drag starts
  const backdropChildrenRef = useRef<Map<string, { offsetX: number; offsetY: number }>>(new Map());
  const draggingNodeIdsRef = useRef<Set<string>>(new Set());
  const [depHighlightLocked, setDepHighlightLocked] = useState(false);
  const [connectingFromNodeId, setConnectingFromNodeId] = useState<string | null>(null);
  const [videoCloneOpen, setVideoCloneOpen] = useState(false);
  // Track whether the user is actively panning/zooming. Uses a ref instead
  // of state to avoid re-rendering the entire component tree on every pan
  // start/end. The MiniMap is hidden via CSS (visibility) rather than unmounted.
  const isPanningRef = useRef(false);
  const minimapWrapperRef = useRef<HTMLDivElement | null>(null);

  const activeCanvasId = useSelector((s: RootState) => s.canvas.activeCanvasId);
  const canvas = useSelector(selectActiveCanvas);
  const canvasViewport = useSelector((s: RootState) => s.canvas.viewport);
  const projectStyleGuide = useSelector((s: RootState) => s.settings.styleGuide);
  const selectedNodeIds = useSelector((s: RootState) => s.canvas.selectedNodeIds);
  const selectedEdgeIds = useSelector((s: RootState) => s.canvas.selectedEdgeIds);
  const clipboard = useSelector((s: RootState) => s.canvas.clipboard, shallowEqual);
  const minimapVisible = useSelector((s: RootState) => s.ui.minimapVisible);
  const searchPanelOpen = useSelector((s: RootState) => s.ui.searchPanelOpen);
  const snapToGrid = useSelector((s: RootState) => s.ui.snapToGrid);
  const rightPanel = useSelector((s: RootState) => s.ui.rightPanel);
  const canvasViewMode = useSelector((s: RootState) => s.ui.canvasViewMode);
  const editViewFocusedNodeId = useSelector((s: RootState) => s.ui.editViewFocusedNodeId);

  const debouncedViewportUpdate = useMemo(
    () => debounce((viewport: { x: number; y: number; zoom: number }) => dispatch(updateViewport(viewport)), 120),
    [dispatch],
  );

  // When the active canvas changes, imperatively move ReactFlow's viewport
  // to the restored position.  `defaultViewport` is an init-only prop, so
  // switching canvases while <ReactFlow> stays mounted requires this.
  const prevCanvasIdRef = useRef(activeCanvasId);
  useEffect(() => {
    if (activeCanvasId && activeCanvasId !== prevCanvasIdRef.current) {
      reactFlow.setViewport(canvasViewport, { duration: 0 });
    }
    prevCanvasIdRef.current = activeCanvasId;
  }, [activeCanvasId, canvasViewport, reactFlow]);

  // ---- Extracted hooks -------------------------------------------------------

  // Node & edge callbacks (delivered via Context to keep data objects stable)
  const nodeCallbacks = useCanvasNodeCallbacks({
    generate,
    setConnectingFromNodeId,
    setVideoCloneOpen,
  });
  const edgeCallbacks = useCanvasEdgeCallbacks();

  // Dependency highlight focus
  const dependencyFocusNodeId = depHighlightLocked
    ? selectedNodeIds[0] ?? null
    : null;

  // Flow data: DTO→ReactFlow mapping, caching, search, dependency graph
  const {
    appliedNodes,
    appliedEdges,
    setAppliedNodes,
    matchingNodeIds,
    matchedNodeIdsArray,
  } = useFlowData({ dependencyFocusNodeId });

  // Keep a ref to the current canvas so event handlers can read it without
  // being in the dependency array of every callback.
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;

  const selectedNodeIdsRef = useRef(selectedNodeIds);
  selectedNodeIdsRef.current = selectedNodeIds;

  // ---- Navigation helper ----------------------------------------------------

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

  useEffect(() => {
    const handler = (e: Event) => {
      const nodeId = (e as CustomEvent).detail?.nodeId;
      if (typeof nodeId === 'string') handleNavigateToNode(nodeId);
    };
    window.addEventListener('commander:navigate-to-node', handler);
    return () => window.removeEventListener('commander:navigate-to-node', handler);
  }, [handleNavigateToNode]);

  // ---- React Flow event handlers -------------------------------------------

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => {
      // ---- RAF batching: collect changes and flush once per frame ----
      pendingNodeChangesRef.current.push(...changes);
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(() => {
          const batched = pendingNodeChangesRef.current;
          pendingNodeChangesRef.current = [];
          rafIdRef.current = null;
          if (batched.length > 0) {
            setAppliedNodes((prev) => applyNodeChanges(batched, prev));
          }
        });
      }

      // Sync relevant changes back to Redux (source of truth for persistence).
      const currentCanvas = canvasRef.current;
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          if (change.dragging) {
            // ---- Active drag: local-only, no Redux ----
            if (currentCanvas) {
              const movedNode = currentCanvas.nodes.find((n) => n.id === change.id);
              if (movedNode?.type === 'backdrop') {
                if (backdropChildrenRef.current.size === 0) {
                  const bw = movedNode.width ?? 420;
                  const bh = movedNode.height ?? 240;
                  for (const child of currentCanvas.nodes) {
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
                const childChanges: NodeChange[] = [];
                for (const [childId, offset] of backdropChildrenRef.current) {
                  childChanges.push({
                    type: 'position',
                    id: childId,
                    position: {
                      x: change.position.x + offset.offsetX,
                      y: change.position.y + offset.offsetY,
                    },
                    dragging: true,
                  });
                }
                if (childChanges.length > 0) {
                  pendingNodeChangesRef.current.push(...childChanges);
                }
              }
            }
            draggingNodeIdsRef.current.add(change.id);
          } else if (change.dragging === false) {
            // ---- Drag ended: commit final positions to Redux ----
            draggingNodeIdsRef.current.delete(change.id);
            dispatch(moveNode({ id: change.id, position: change.position }));

            if (backdropChildrenRef.current.size > 0) {
              const moves: Array<{ id: string; position: { x: number; y: number } }> = [];
              for (const [childId, offset] of backdropChildrenRef.current) {
                moves.push({
                  id: childId,
                  position: {
                    x: change.position.x + offset.offsetX,
                    y: change.position.y + offset.offsetY,
                  },
                });
              }
              if (moves.length > 0) dispatch(moveNodes(moves));
              backdropChildrenRef.current.clear();
            }
          }
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
    [dispatch, setAppliedNodes],
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

  const selectedEdgeIdsRef = useRef(selectedEdgeIds);
  selectedEdgeIdsRef.current = selectedEdgeIds;

  const onSelectionChange = useCallback(
    ({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) => {
      const newNodeIds = nodes.map((n) => n.id);
      const newEdgeIds = edges.map((e) => e.id);
      // Guard: skip dispatch if selection hasn't actually changed (prevents render loop)
      const prevNodeIds = selectedNodeIdsRef.current;
      const prevEdgeIds = selectedEdgeIdsRef.current;
      if (
        newNodeIds.length === prevNodeIds.length &&
        newNodeIds.every((id, i) => id === prevNodeIds[i]) &&
        newEdgeIds.length === prevEdgeIds.length &&
        newEdgeIds.every((id, i) => id === prevEdgeIds[i])
      ) {
        return;
      }
      dispatch(
        setSelection({
          nodeIds: newNodeIds,
          edgeIds: newEdgeIds,
        }),
      );
    },
    [dispatch],
  );

  const onPaneClick = useCallback(() => {
    hoveredNodeIdRef.current = null;
    setConnectingFromNodeId(null);
    requestAnimationFrame(() => dispatch(clearSelection()));
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
      requestAnimationFrame(() => {
        dispatch(setSelection({ nodeIds: [node.id], edgeIds: [] }));
        if (!rightPanel) {
          dispatch(setRightPanel('inspector'));
        }
      });
    },
    [connectingFromNodeId, dispatch, rightPanel],
  );

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: Edge) => {
      requestAnimationFrame(() => dispatch(setSelection({ nodeIds: [], edgeIds: [edge.id] })));
    },
    [dispatch],
  );
  const onNodeMouseEnter = useCallback((_event: React.MouseEvent, node: Node) => {
    hoveredNodeIdRef.current = node.id;
  }, []);
  const onNodeMouseLeave = useCallback(() => {
    hoveredNodeIdRef.current = null;
  }, []);
  const onPaneMouseLeave = useCallback(() => {
    hoveredNodeIdRef.current = null;
  }, []);
  const onMoveStart = useCallback(() => {
    isPanningRef.current = true;
    if (minimapWrapperRef.current) {
      minimapWrapperRef.current.style.visibility = 'hidden';
    }
  }, []);
  const onMoveEnd = useCallback(
    (_event: unknown, viewport: { x: number; y: number; zoom: number }) => {
      isPanningRef.current = false;
      if (minimapWrapperRef.current) {
        minimapWrapperRef.current.style.visibility = '';
      }
      debouncedViewportUpdate(viewport);
    },
    [debouncedViewportUpdate],
  );

  const onFlowInit = useCallback(
    (instance: ReactFlowInstance) => {
      rfInstanceRef.current = instance;
      const wrapper = document.querySelector('.react-flow__renderer') as HTMLElement | null;
      const bounds = wrapper?.getBoundingClientRect();
      if (bounds && bounds.width > 0) {
        dispatch(updateContainerSize({ width: bounds.width, height: bounds.height }));
      }
    },
    [dispatch],
  );

  // ---- Add node from context menu -------------------------------------------

  const handleAddNode = useCallback(
    (type: CanvasNodeType, screenPosition: { x: number; y: number }) => {
      const rfInstance = rfInstanceRef.current;
      if (!rfInstance) return;

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
      dispatch(recordShotCreate());
      dispatch(recordProjectActivity({ nodesCreated: 1 }));
    },
    [dispatch],
  );

  // Drag-drop — delegated to extracted hook
  const { handleDrop, handleDragOver } = useCanvasDragDrop(rfInstanceRef);

  // ---- Paste / Undo / Redo (shared by keyboard shortcuts + context menu) ----

  const handlePaste = useCallback(async () => {
    let payload = clipboard;
    try {
      if (navigator.clipboard?.readText) {
        const raw = await navigator.clipboard.readText();
        payload = parseClipboardPayload(raw) ?? payload;
      }
    } catch {
      // Clipboard read can fail (permission denied, empty, etc.) — fall back to Redux clipboard
    }
    if (!payload) return;
    dispatch(setClipboard(payload));
    dispatch(pasteNodesAction({ offset: { x: 50, y: 50 } }));
  }, [clipboard, dispatch]);

  const handleUndo = useCallback(() => {
    dispatch({ type: 'undo/undo' });
    dispatch(recordUndo());
  }, [dispatch]);

  const handleRedo = useCallback(() => {
    dispatch({ type: 'undo/redo' });
    dispatch(recordRedo());
  }, [dispatch]);

  // canUndo/canRedo read module-level stacks. They update whenever any
  // tracked action dispatches through the undo middleware. Since those
  // actions also mutate the canvas slice, the component re-renders and
  // picks up the fresh values here automatically.
  const undoEnabled = canUndo();
  const redoEnabled = canRedo();

  // ---- Keyboard shortcuts ---------------------------------------------------

  const handleNodeGenerate = useCallback(
    (id: string) => { void generate(id); },
    [generate],
  );

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

  const handlePaneContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    const clientX = 'clientX' in e ? e.clientX : 0;
    const clientY = 'clientY' in e ? e.clientY : 0;
    setContextMenuPosition(clientX, clientY);
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
    const canvasWithViewport = canvas.viewport === canvasViewport
      ? canvas
      : { ...canvas, viewport: canvasViewport };
    downloadWorkflowDocument(canvasWithViewport);
  }, [canvas, canvasViewport]);

  const handleOpenWorkflowImport = useCallback(() => {
    workflowImportInputRef.current?.click();
  }, []);

  const handleWorkflowImport = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !canvas) return;

      try {
        const document = await readWorkflowDocument(file);
        if (!document?.canvas) {
          dispatch(
            enqueueToast({
              variant: 'error',
              title: t('toast.error.workflowImportFailed'),
              message: t('toast.error.workflowImportInvalid'),
            }),
          );
          return;
        }
        const replacingActiveCanvas = canvas.nodes.length === 0 && canvas.edges.length === 0;
        const importedCanvas = materializeImportedCanvas({
          document,
          canvasId: replacingActiveCanvas ? canvas.id : crypto.randomUUID(),
          name: replacingActiveCanvas ? canvas.name : `${document.canvas.name} Imported`,
        });

        await getAPI()?.canvas.save(importedCanvas);
        const api = getAPI();
        if (api) {
          const list = await api.canvas.list();
          const loaded = await Promise.all(list.map((item) => api.canvas.load(item.id)));
          dispatch(setCanvases(loaded.filter(Boolean)));
        }
        dispatch(setActiveCanvas(importedCanvas.id));
      } catch (error) {
        dispatch(
          enqueueToast({
            variant: 'error',
            title: t('toast.error.workflowImportFailed'),
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        event.target.value = '';
      }
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
      hasClipboard={Boolean(clipboard)}
    >
      <div
        ref={containerRef}
        className="relative h-full w-full"
        role="application"
        aria-label={t('canvasWorkspace.ariaLabel')}
        onContextMenu={handleContextMenu}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <input
          ref={workflowImportInputRef}
          type="file"
          accept=".json,.lucid-workflow.json"
          className="hidden"
          aria-label={t('canvasWorkspace.importFileAriaLabel')}
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
          onUndo={handleUndo}
          onRedo={handleRedo}
          undoEnabled={undoEnabled}
          redoEnabled={redoEnabled}
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
        <CanvasLodContext.Provider value={canvasLod}>
        <NodeCallbacksContext.Provider value={nodeCallbacks}>
        <EdgeCallbacksContext.Provider value={edgeCallbacks}>
        <ReactFlow
          nodes={appliedNodes}
          edges={appliedEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onSelectionChange={onSelectionChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onPaneClick={onPaneClick}
          onPaneContextMenu={handlePaneContextMenu}
          onNodeContextMenu={handleNodeContextMenu}
          onNodeMouseEnter={onNodeMouseEnter}
          onNodeMouseLeave={onNodeMouseLeave}
          onPaneMouseLeave={onPaneMouseLeave}
          onMoveStart={onMoveStart}
          onMoveEnd={onMoveEnd}
          onInit={onFlowInit}
          defaultViewport={canvasViewport}
          fitView={false}
          snapToGrid={snapToGrid}
          snapGrid={[16, 16]}
          deleteKeyCode={null}
          multiSelectionKeyCode="Control"
          selectionOnDrag
          panOnDrag={[1, 2]}
          elementsSelectable={true}
          disableKeyboardA11y
          onlyRenderVisibleElements
          edgesReconnectable
          connectionMode={ConnectionMode.Loose}
          connectionLineType={ConnectionLineType.SmoothStep}
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          aria-label={t('canvasWorkspace.ariaLabel')}
          ariaLabelConfig={{
            'minimap.ariaLabel': t('canvasWorkspace.minimapAriaLabel'),
          }}
          className="bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.04),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.04),transparent_35%),hsl(var(--background))]"
        >
          <Background gap={16} size={1} color="hsl(var(--border))" />
          {minimapVisible && (
            <div ref={minimapWrapperRef}>
              <MiniMap
                pannable
                zoomable
                className="!rounded-2xl !border !border-border/80 !bg-card/95 !shadow-xl"
                maskColor="rgba(15,23,42,0.45)"
                nodeBorderRadius={10}
                nodeColor={minimapNodeColor}
              />
            </div>
          )}
        </ReactFlow>
        </EdgeCallbacksContext.Provider>
        </NodeCallbacksContext.Provider>
        </CanvasLodContext.Provider>
        </>
        )}
      </div>
    </CanvasContextMenu>
    <VideoCloneDialog
      open={videoCloneOpen}
      onClose={() => setVideoCloneOpen(false)}
      onCanvasCreated={(canvasId) => dispatch(setActiveCanvas(canvasId))}
    />
    </>
  );
}
