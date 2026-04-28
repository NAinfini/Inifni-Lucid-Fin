import {
  createSlice,
  createEntityAdapter,
  type ActionCreatorWithPayload,
  type EntityState,
  type PayloadAction,
  type Reducer,
} from '@reduxjs/toolkit';
import type {
  Canvas,
  CanvasNode,
  CanvasEdge,
  CanvasViewport,
  CanvasNote,
  CanvasSettings,
  ImageNodeData,
  VideoNodeData,
} from '@lucid-fin/contracts';
import { findActiveCanvas, normalizeCanvasNodeFrames } from './canvas-helpers.js';
import * as nodeReducers from './canvas-node-reducers.js';
import * as refReducers from './canvas-ref-reducers.js';
import * as edgeReducers from './canvas-edge-reducers.js';
import * as generationReducers from './canvas-generation-reducers.js';
import * as presetReducers from './canvas-preset-reducers.js';

// ---------------------------------------------------------------------------
// Entity adapter for normalized canvas storage
// ---------------------------------------------------------------------------

export const canvasAdapter = createEntityAdapter<Canvas>();

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface CanvasSliceState {
  /** Normalized canvases (entity adapter: ids[] + entities{}) */
  canvases: EntityState<Canvas, string>;
  /** ID of the canvas currently visible on screen */
  activeCanvasId: string | null;
  /** Currently selected node IDs */
  selectedNodeIds: string[];
  /** Currently selected edge IDs */
  selectedEdgeIds: string[];
  /** Current viewport state (synced from React Flow) */
  viewport: CanvasViewport;
  /** ReactFlow container dimensions */
  containerWidth: number;
  containerHeight: number;
  /** Internal clipboard payload for cross-canvas paste */
  clipboard: CanvasClipboardPayload | null;
  /** Loading indicator */
  loading: boolean;
}

export interface CanvasClipboardPayload {
  version: 1;
  sourceCanvasId: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  copiedAt: number;
}

const initialState: CanvasSliceState = {
  canvases: canvasAdapter.getInitialState(),
  activeCanvasId: null,
  selectedNodeIds: [],
  selectedEdgeIds: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  containerWidth: 800,
  containerHeight: 600,
  clipboard: null,
  loading: false,
};

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

const internalCanvasSlice = createSlice({
  name: 'canvas',
  initialState,
  reducers: {
    // --- Canvas-level actions -----------------------------------------------

    setCanvases(state, action: PayloadAction<Canvas[]>) {
      const normalized = action.payload.map((canvas) => normalizeCanvasNodeFrames(canvas));
      canvasAdapter.setAll(state.canvases, normalized);
      const stillValid = state.canvases.ids.includes(state.activeCanvasId ?? '');
      if (!stillValid) {
        state.activeCanvasId = (state.canvases.ids[0] as string) ?? null;
        state.selectedNodeIds = [];
        state.selectedEdgeIds = [];
      }
      // Sync viewport from the (possibly new) active canvas so the top-level
      // state.viewport reflects the persisted value on project load.
      const active = findActiveCanvas(state);
      if (active) {
        state.viewport = active.viewport;
      }
    },

    addCanvas(state, action: PayloadAction<Canvas>) {
      canvasAdapter.addOne(state.canvases, normalizeCanvasNodeFrames(action.payload));
    },

    removeCanvas(state, action: PayloadAction<string>) {
      canvasAdapter.removeOne(state.canvases, action.payload);
      if (state.activeCanvasId === action.payload) {
        state.activeCanvasId = (state.canvases.ids[0] as string) ?? null;
      }
    },

    setActiveCanvas(state, action: PayloadAction<string | null>) {
      // Persist the current viewport into the outgoing canvas before switching.
      const outgoing = findActiveCanvas(state);
      if (outgoing) {
        outgoing.viewport = state.viewport;
      }

      state.activeCanvasId = action.payload;
      state.selectedNodeIds = [];
      state.selectedEdgeIds = [];

      // Load the incoming canvas's saved viewport.
      const canvas = findActiveCanvas(state);
      if (canvas) {
        state.viewport = canvas.viewport;
      }
    },

    renameCanvas(state, action: PayloadAction<{ id: string; name: string }>) {
      const canvas = state.canvases.entities[action.payload.id];
      if (canvas) {
        canvas.name = action.payload.name;
        canvas.updatedAt = Date.now();
      }
    },

    // --- Node actions (delegated) ------------------------------------------

    addNode: nodeReducers.addNode,
    removeNodes: nodeReducers.removeNodes,
    updateNode: nodeReducers.updateNode,
    updateNodeData: nodeReducers.updateNodeData,
    moveNode: nodeReducers.moveNode,
    moveNodes: nodeReducers.moveNodes,
    renameNode: nodeReducers.renameNode,
    toggleBypass: nodeReducers.toggleBypass,
    setNodeColorTag: nodeReducers.setNodeColorTag,
    toggleLock: nodeReducers.toggleLock,
    toggleBackdropCollapse: nodeReducers.toggleBackdropCollapse,
    setBackdropOpacity: nodeReducers.setBackdropOpacity,
    setBackdropColor: nodeReducers.setBackdropColor,
    setBackdropBorderStyle: nodeReducers.setBackdropBorderStyle,
    setBackdropTitleSize: nodeReducers.setBackdropTitleSize,
    setBackdropLockChildren: nodeReducers.setBackdropLockChildren,
    setNodeProvider: nodeReducers.setNodeProvider,
    setNodeVariantCount: nodeReducers.setNodeVariantCount,
    setNodeEstimatedCost: nodeReducers.setNodeEstimatedCost,
    setNodeUploadedAsset: nodeReducers.setNodeUploadedAsset,
    clearNodeAsset: nodeReducers.clearNodeAsset,
    setVideoFrameNode: nodeReducers.setVideoFrameNode,
    setVideoFrameAsset: nodeReducers.setVideoFrameAsset,
    setNodeAudio: nodeReducers.setNodeAudio,
    setNodeQuality: nodeReducers.setNodeQuality,
    restoreNodes: nodeReducers.restoreNodes,
    // --- Ref & clipboard actions (delegated) --------------------------------

    setNodeCharacterRefs: refReducers.setNodeCharacterRefs,
    addNodeCharacterRef: refReducers.addNodeCharacterRef,
    removeNodeCharacterRef: refReducers.removeNodeCharacterRef,
    updateNodeCharacterRef: refReducers.updateNodeCharacterRef,
    setNodeEquipmentRefs: refReducers.setNodeEquipmentRefs,
    addNodeEquipmentRef: refReducers.addNodeEquipmentRef,
    removeNodeEquipmentRef: refReducers.removeNodeEquipmentRef,
    updateNodeEquipmentRef: refReducers.updateNodeEquipmentRef,
    setNodeLocationRefs: refReducers.setNodeLocationRefs,
    addNodeLocationRef: refReducers.addNodeLocationRef,
    removeNodeLocationRef: refReducers.removeNodeLocationRef,
    duplicateNode: refReducers.duplicateNode,
    copyNodes: refReducers.copyNodes,
    setClipboard: refReducers.setClipboard,
    pasteNodes: refReducers.pasteNodes,
    duplicateNodes: refReducers.duplicateNodes,

    // --- Edge actions (delegated) ------------------------------------------

    addEdge: edgeReducers.addEdge,
    removeEdges: edgeReducers.removeEdges,
    updateEdge: edgeReducers.updateEdge,
    reconnectCanvasEdge: edgeReducers.reconnectCanvasEdge,
    setEdgeStatus: edgeReducers.setEdgeStatus,
    swapEdgeDirection: edgeReducers.swapEdgeDirection,
    disconnectNode: edgeReducers.disconnectNode,
    insertNodeIntoEdge: edgeReducers.insertNodeIntoEdge,
    restoreEdges: edgeReducers.restoreEdges,

    // --- Generation actions (delegated) ------------------------------------

    setNodeGenerating: generationReducers.setNodeGenerating,
    setNodeProgress: generationReducers.setNodeProgress,
    clearNodeGenerationStatus: generationReducers.clearNodeGenerationStatus,
    setNodeGenerationComplete: generationReducers.setNodeGenerationComplete,
    setNodeGenerationFailed: generationReducers.setNodeGenerationFailed,
    selectVariant: generationReducers.selectVariant,
    deleteVariant: generationReducers.deleteVariant,
    setNodeSeed: generationReducers.setNodeSeed,
    setNodeResolution: generationReducers.setNodeResolution,
    setNodeDuration: generationReducers.setNodeDuration,
    setNodeFps: generationReducers.setNodeFps,
    toggleSeedLock: generationReducers.toggleSeedLock,

    // --- Annotation / tags / grouping (M7, M9) ----------------------------

    setNodeAnnotation: generationReducers.setNodeAnnotation,
    setNodeTags: generationReducers.setNodeTags,
    addNodeTag: generationReducers.addNodeTag,
    removeNodeTag: generationReducers.removeNodeTag,
    setNodeGroupId: generationReducers.setNodeGroupId,

    // --- Advanced generation params (L17) ---------------------------------

    setNodeAdvancedParams: generationReducers.setNodeAdvancedParams,
    setNodeSourceImage: generationReducers.setNodeSourceImage,

    // --- Duration / scene metadata (L19) ----------------------------------

    setNodeDurationOverride: generationReducers.setNodeDurationOverride,
    setNodeSceneMetadata: generationReducers.setNodeSceneMetadata,

    // --- Generation history (M10) -----------------------------------------

    clearGenerationHistory: generationReducers.clearGenerationHistory,

    // --- Lip Sync (F2) ----------------------------------------------------

    setNodeLipSync: generationReducers.setNodeLipSync,

    // --- Preset / track actions (delegated) --------------------------------

    applyNodeShotTemplate: presetReducers.applyNodeShotTemplate,
    addNodePresetTrackEntry: presetReducers.addNodePresetTrackEntry,
    updateNodePresetTrackEntry: presetReducers.updateNodePresetTrackEntry,
    removeNodePresetTrackEntry: presetReducers.removeNodePresetTrackEntry,
    moveNodePresetTrackEntry: presetReducers.moveNodePresetTrackEntry,

    // --- Selection ---------------------------------------------------------

    setSelection(state, action: PayloadAction<{ nodeIds: string[]; edgeIds: string[] }>) {
      state.selectedNodeIds = action.payload.nodeIds;
      state.selectedEdgeIds = action.payload.edgeIds;
    },

    clearSelection(state) {
      state.selectedNodeIds = [];
      state.selectedEdgeIds = [];
    },

    // --- Viewport ----------------------------------------------------------

    updateViewport(state, action: PayloadAction<CanvasViewport>) {
      // Only update the top-level viewport — NOT canvas.viewport.
      // Writing canvas.viewport here causes Immer to produce a new canvas ref,
      // which invalidates selectActiveCanvas and triggers a full flowNodes
      // recompute on every pan gesture.  canvas.viewport is synced lazily:
      //   • setActiveCanvas saves state.viewport to the outgoing canvas.
      //   • Persist middleware snapshots state.viewport into the canvas before save.
      state.viewport = action.payload;
    },

    updateContainerSize(state, action: PayloadAction<{ width: number; height: number }>) {
      state.containerWidth = action.payload.width;
      state.containerHeight = action.payload.height;
    },

    // --- Loading -----------------------------------------------------------

    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },

    // --- Canvas Notes ------------------------------------------------------

    addCanvasNote(state, action: PayloadAction<{ content?: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const now = Date.now();
      const note: CanvasNote = {
        id: `note-${now}-${Math.random().toString(36).slice(2, 8)}`,
        content: action.payload.content ?? '',
        createdAt: now,
        updatedAt: now,
      };
      canvas.notes.push(note);
      canvas.updatedAt = now;
    },

    updateCanvasNote(state, action: PayloadAction<{ id: string; content: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      const note = canvas.notes.find((n) => n.id === action.payload.id);
      if (note) {
        note.content = action.payload.content;
        note.updatedAt = Date.now();
        canvas.updatedAt = note.updatedAt;
      }
    },

    deleteCanvasNote(state, action: PayloadAction<{ id: string }>) {
      const canvas = findActiveCanvas(state);
      if (!canvas) return;
      canvas.notes = canvas.notes.filter((n) => n.id !== action.payload.id);
      canvas.updatedAt = Date.now();
    },

    // --- Canvas Settings (H2 fix: route through Redux) --------------------

    updateCanvasSettings(state, action: PayloadAction<{ canvasId: string; settings: CanvasSettings | undefined }>) {
      const canvas = state.canvases.entities[action.payload.canvasId];
      if (!canvas) return;
      canvas.settings = action.payload.settings && Object.keys(action.payload.settings).length > 0
        ? action.payload.settings
        : undefined;
      canvas.updatedAt = Date.now();
    },

    // --- Entity ref cleanup (H9) -------------------------------------------

    /** Remove all references to a deleted entity across ALL canvases. */
    removeEntityRefsFromAllCanvases(
      state,
      action: PayloadAction<{
        entityType: 'character' | 'equipment' | 'location';
        entityId: string;
      }>,
    ) {
      const { entityType, entityId } = action.payload;
      const now = Date.now();
      for (const canvasId of state.canvases.ids) {
        const canvas = state.canvases.entities[canvasId as string];
        if (!canvas) continue;
        let dirty = false;
        for (const node of canvas.nodes) {
          if (node.type !== 'image' && node.type !== 'video' && node.type !== 'backdrop') continue;
          const data = node.data as ImageNodeData | VideoNodeData;
          if (entityType === 'character' && data.characterRefs) {
            const before = data.characterRefs.length;
            data.characterRefs = data.characterRefs.filter((r) => r.characterId !== entityId);
            if (data.characterRefs.length < before) dirty = true;
          }
          if (entityType === 'equipment' && data.equipmentRefs) {
            const before = data.equipmentRefs.length;
            data.equipmentRefs = data.equipmentRefs.filter((r) => r.equipmentId !== entityId);
            if (data.equipmentRefs.length < before) dirty = true;
          }
          if (entityType === 'location' && data.locationRefs) {
            const before = data.locationRefs.length;
            data.locationRefs = data.locationRefs.filter((r) => r.locationId !== entityId);
            if (data.locationRefs.length < before) dirty = true;
          }
        }
        if (dirty) canvas.updatedAt = now;
      }
    },

    // --- Undo support ------------------------------------------------------

    restore(_state, action: PayloadAction<CanvasSliceState>) {
      return action.payload;
    },
  },
});

export const canvasReducer: Reducer<CanvasSliceState> = internalCanvasSlice.reducer;
export const canvasSlice: {
  reducer: Reducer<CanvasSliceState>;
  actions: {
    setCanvases: ActionCreatorWithPayload<Canvas[]>;
  };
} = {
  reducer: internalCanvasSlice.reducer,
  actions: {
    setCanvases: internalCanvasSlice.actions.setCanvases,
  },
};

export const {
  setCanvases,
  addCanvas,
  removeCanvas,
  setActiveCanvas,
  renameCanvas,
  addNode,
  removeNodes,
  updateNode,
  updateNodeData,
  moveNode,
  moveNodes,
  renameNode,
  setNodeGenerating,
  setNodeProgress,
  clearNodeGenerationStatus,
  setNodeGenerationComplete,
  setNodeGenerationFailed,
  selectVariant,
  deleteVariant,
  setNodeSeed,
  setNodeResolution,
  setNodeDuration,
  setNodeFps,
  toggleSeedLock,
  toggleBypass,
  setNodeColorTag,
  toggleLock,
  toggleBackdropCollapse,
  setBackdropOpacity,
  setBackdropColor,
  setBackdropBorderStyle,
  setBackdropTitleSize,
  setBackdropLockChildren,
  setNodeProvider,
  setNodeVariantCount,
  setNodeEstimatedCost,
  setNodeUploadedAsset,
  clearNodeAsset,
  applyNodeShotTemplate,
  setVideoFrameNode,
  setVideoFrameAsset,
  setNodeAudio,
  setNodeQuality,
  addNodePresetTrackEntry,
  updateNodePresetTrackEntry,
  removeNodePresetTrackEntry,
  moveNodePresetTrackEntry,
  setNodeCharacterRefs,
  addNodeCharacterRef,
  removeNodeCharacterRef,
  updateNodeCharacterRef,
  setNodeEquipmentRefs,
  addNodeEquipmentRef,
  removeNodeEquipmentRef,
  updateNodeEquipmentRef,
  setNodeLocationRefs,
  addNodeLocationRef,
  removeNodeLocationRef,
  duplicateNode,
  copyNodes,
  setClipboard,
  pasteNodes,
  duplicateNodes,
  restoreNodes,
  addEdge,
  removeEdges,
  updateEdge,
  reconnectCanvasEdge,
  setEdgeStatus,
  swapEdgeDirection,
  disconnectNode,
  insertNodeIntoEdge,
  restoreEdges,
  setSelection,
  clearSelection,
  updateViewport,
  updateContainerSize,
  setLoading,
  addCanvasNote,
  updateCanvasNote,
  deleteCanvasNote,
  // M7: Annotation
  setNodeAnnotation,
  // M9: Tags & grouping
  setNodeTags,
  addNodeTag,
  removeNodeTag,
  setNodeGroupId,
  // M10: Generation history
  clearGenerationHistory,
  // F2: Lip Sync
  setNodeLipSync,
  // L17: Advanced generation params
  setNodeAdvancedParams,
  setNodeSourceImage,
  // L19: Duration / scene metadata
  setNodeDurationOverride,
  setNodeSceneMetadata,
  // H9: Entity ref cleanup
  removeEntityRefsFromAllCanvases,
  // H2: Canvas settings
  updateCanvasSettings,
} = internalCanvasSlice.actions;
