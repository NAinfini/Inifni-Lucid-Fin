import { current, type PayloadAction } from '@reduxjs/toolkit';
import type {
  CanvasNode,
  CharacterRef,
  EquipmentRef,
  LocationRef,
  ImageNodeData,
  VideoNodeData,
} from '@lucid-fin/contracts';
import type { CanvasClipboardPayload, CanvasSliceState } from './canvas.js';
import {
  findActiveCanvas,
  findCanvasById,
  buildCanvasClipboardPayload,
  pasteClipboardPayload,
  normalizeEquipmentRefs,
} from './canvas-helpers.js';

// ---------------------------------------------------------------------------
// Character refs
// ---------------------------------------------------------------------------

export function setNodeCharacterRefs(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; characterRefs: CharacterRef[] }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  (node.data as ImageNodeData | VideoNodeData).characterRefs = action.payload.characterRefs;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function addNodeCharacterRef(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; characterRef: CharacterRef }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = node.data as ImageNodeData | VideoNodeData;
  if (!data.characterRefs) data.characterRefs = [];
  if (!data.characterRefs.some((r) => r.characterId === action.payload.characterRef.characterId)) {
    data.characterRefs.push(action.payload.characterRef);
  }
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function removeNodeCharacterRef(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; characterId: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = node.data as ImageNodeData | VideoNodeData;
  if (!data.characterRefs) return;
  data.characterRefs = data.characterRefs.filter(
    (r) => r.characterId !== action.payload.characterId,
  );
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function updateNodeCharacterRef(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; characterId: string; changes: Partial<CharacterRef> }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = node.data as ImageNodeData | VideoNodeData;
  if (!data.characterRefs) return;
  const ref = data.characterRefs.find((r) => r.characterId === action.payload.characterId);
  if (!ref) return;
  Object.assign(ref, action.payload.changes);
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

// ---------------------------------------------------------------------------
// Equipment refs
// ---------------------------------------------------------------------------

export function setNodeEquipmentRefs(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; equipmentRefs: EquipmentRef[] }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  (node.data as ImageNodeData | VideoNodeData).equipmentRefs = normalizeEquipmentRefs(action.payload.equipmentRefs);
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function addNodeEquipmentRef(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; equipmentId: string; angleSlot?: string; referenceImageHash?: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = node.data as ImageNodeData | VideoNodeData;
  const refs = normalizeEquipmentRefs(data.equipmentRefs);
  if (!refs.some((r) => r.equipmentId === action.payload.equipmentId)) {
    refs.push({
      equipmentId: action.payload.equipmentId,
      angleSlot: action.payload.angleSlot,
      referenceImageHash: action.payload.referenceImageHash,
    });
  }
  data.equipmentRefs = refs;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function removeNodeEquipmentRef(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; equipmentId: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = node.data as ImageNodeData | VideoNodeData;
  data.equipmentRefs = normalizeEquipmentRefs(data.equipmentRefs).filter(
    (r) => r.equipmentId !== action.payload.equipmentId,
  );
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function updateNodeEquipmentRef(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; equipmentId: string; changes: Partial<EquipmentRef> }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = node.data as ImageNodeData | VideoNodeData;
  const refs = normalizeEquipmentRefs(data.equipmentRefs);
  const ref = refs.find((r) => r.equipmentId === action.payload.equipmentId);
  if (!ref) return;
  Object.assign(ref, action.payload.changes);
  data.equipmentRefs = refs;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

// ---------------------------------------------------------------------------
// Location refs
// ---------------------------------------------------------------------------

export function setNodeLocationRefs(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; refs: LocationRef[] }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  (node.data as ImageNodeData | VideoNodeData).locationRefs = action.payload.refs;
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function addNodeLocationRef(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; locationId: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = node.data as ImageNodeData | VideoNodeData;
  if (!data.locationRefs) data.locationRefs = [];
  if (!data.locationRefs.some((r) => r.locationId === action.payload.locationId)) {
    data.locationRefs.push({ locationId: action.payload.locationId });
  }
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function removeNodeLocationRef(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; locationId: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = node.data as ImageNodeData | VideoNodeData;
  if (!data.locationRefs) return;
  data.locationRefs = data.locationRefs.filter(
    (r) => r.locationId !== action.payload.locationId,
  );
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

// ---------------------------------------------------------------------------
// Duplicate / copy / paste
// ---------------------------------------------------------------------------

export function duplicateNode(
  state: CanvasSliceState,
  action: PayloadAction<{ sourceId: string; newId: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const source = canvas.nodes.find((n) => n.id === action.payload.sourceId);
  if (!source) return;
  const now = Date.now();
  const clone: CanvasNode = {
    ...(JSON.parse(JSON.stringify(current(source))) as CanvasNode),
    id: action.payload.newId,
    position: { x: source.position.x + 40, y: source.position.y + 40 },
    createdAt: now,
    updatedAt: now,
  };
  canvas.nodes.push(clone);
  canvas.updatedAt = now;
}

export function copyNodes(
  state: CanvasSliceState,
  action: PayloadAction<string[] | undefined>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const payload = buildCanvasClipboardPayload(canvas, action.payload ?? state.selectedNodeIds);
  if (payload) {
    state.clipboard = payload;
  }
}

export function setClipboard(
  state: CanvasSliceState,
  action: PayloadAction<CanvasClipboardPayload | null>,
): void {
  state.clipboard = action.payload;
}

export function pasteNodes(
  state: CanvasSliceState,
  action: PayloadAction<
    | {
        targetCanvasId?: string;
        offset?: { x: number; y: number };
      }
    | undefined
  >,
): void {
  const clipboard = state.clipboard;
  if (!clipboard) return;
  const canvas =
    findCanvasById(state, action.payload?.targetCanvasId) ?? findActiveCanvas(state);
  if (!canvas) return;

  const { nodes, edges } = pasteClipboardPayload(canvas, clipboard, action.payload?.offset ?? { x: 50, y: 50 });
  if (nodes.length === 0) return;

  canvas.nodes.push(...nodes);
  canvas.edges.push(...edges);
  canvas.updatedAt = Date.now();
  state.selectedNodeIds = nodes.map((node) => node.id);
  state.selectedEdgeIds = edges.map((edge) => edge.id);
}

export function duplicateNodes(
  state: CanvasSliceState,
  action: PayloadAction<string[] | undefined>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;

  const clipboard = buildCanvasClipboardPayload(canvas, action.payload ?? state.selectedNodeIds);
  if (!clipboard) return;

  state.clipboard = clipboard;
  const { nodes, edges } = pasteClipboardPayload(canvas, clipboard, { x: 40, y: 40 });
  canvas.nodes.push(...nodes);
  canvas.edges.push(...edges);
  canvas.updatedAt = Date.now();
  state.selectedNodeIds = nodes.map((node) => node.id);
  state.selectedEdgeIds = edges.map((edge) => edge.id);
}
