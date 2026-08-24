import type { PayloadAction } from '@reduxjs/toolkit';
import type { OrderedDeliveryItem, OrderedDeliverySequence } from '@lucid-fin/contracts';
import type { CanvasSliceState } from './canvas.js';
import { findActiveCanvas } from './canvas-helpers.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function isValidItem(item: OrderedDeliveryItem): boolean {
  return (
    item.shotId.trim().length > 0 &&
    SHA256_PATTERN.test(item.selectedVideoHash) &&
    Number.isInteger(item.trimInMs) &&
    Number.isInteger(item.trimOutMs) &&
    item.trimInMs >= 0 &&
    item.trimOutMs > item.trimInMs
  );
}

function touch(canvas: { deliverySequence?: OrderedDeliverySequence; updatedAt: number }): void {
  if (!canvas.deliverySequence) return;
  const now = Date.now();
  canvas.deliverySequence.updatedAt = now;
  canvas.updatedAt = now;
}

function ensureSequence(state: CanvasSliceState): OrderedDeliverySequence | undefined {
  const canvas = findActiveCanvas(state);
  if (!canvas) return undefined;
  if (!canvas.deliverySequence) {
    canvas.deliverySequence = { revision: 1, items: [], updatedAt: Date.now() };
    canvas.updatedAt = canvas.deliverySequence.updatedAt;
  }
  return canvas.deliverySequence;
}

function activeSequence(state: CanvasSliceState): OrderedDeliverySequence | undefined {
  return findActiveCanvas(state)?.deliverySequence;
}

export function addDeliveryItem(
  state: CanvasSliceState,
  action: PayloadAction<OrderedDeliveryItem>,
): void {
  if (!isValidItem(action.payload)) return;
  const canvas = findActiveCanvas(state);
  const sequence = ensureSequence(state);
  if (!canvas || !sequence || sequence.items.some((item) => item.shotId === action.payload.shotId)) return;
  sequence.items.push({ ...action.payload });
  touch(canvas);
}

export function replaceDeliveryItem(
  state: CanvasSliceState,
  action: PayloadAction<OrderedDeliveryItem>,
): void {
  if (!isValidItem(action.payload)) return;
  const canvas = findActiveCanvas(state);
  const sequence = activeSequence(state);
  if (!canvas || !sequence) return;
  const index = sequence.items.findIndex((item) => item.shotId === action.payload.shotId);
  if (index < 0) return;
  sequence.items[index] = { ...action.payload };
  touch(canvas);
}

export function reorderDeliveryItem(
  state: CanvasSliceState,
  action: PayloadAction<{ shotId: string; toIndex: number }>,
): void {
  const canvas = findActiveCanvas(state);
  const sequence = activeSequence(state);
  if (!canvas || !sequence || !Number.isInteger(action.payload.toIndex)) return;
  const fromIndex = sequence.items.findIndex((item) => item.shotId === action.payload.shotId);
  if (fromIndex < 0) return;
  const toIndex = Math.max(0, Math.min(action.payload.toIndex, sequence.items.length - 1));
  if (fromIndex === toIndex) return;
  const [item] = sequence.items.splice(fromIndex, 1);
  sequence.items.splice(toIndex, 0, item!);
  touch(canvas);
}

export function trimDeliveryItem(
  state: CanvasSliceState,
  action: PayloadAction<{ shotId: string; trimInMs: number; trimOutMs: number }>,
): void {
  const canvas = findActiveCanvas(state);
  const sequence = activeSequence(state);
  if (!canvas || !sequence) return;
  const item = sequence.items.find((candidate) => candidate.shotId === action.payload.shotId);
  if (!item || !isValidItem({ ...item, ...action.payload })) return;
  item.trimInMs = action.payload.trimInMs;
  item.trimOutMs = action.payload.trimOutMs;
  touch(canvas);
}

export function setDeliveryEmbeddedAudio(
  state: CanvasSliceState,
  action: PayloadAction<{ shotId: string; embeddedAudioEnabled: boolean }>,
): void {
  const canvas = findActiveCanvas(state);
  const sequence = activeSequence(state);
  if (!canvas || !sequence) return;
  const item = sequence.items.find((candidate) => candidate.shotId === action.payload.shotId);
  if (!item) return;
  item.embeddedAudioEnabled = action.payload.embeddedAudioEnabled;
  touch(canvas);
}

export function removeDeliveryItems(
  state: CanvasSliceState,
  action: PayloadAction<string[]>,
): void {
  const canvas = findActiveCanvas(state);
  const sequence = activeSequence(state);
  if (!canvas || !sequence) return;
  const shotIds = new Set(action.payload);
  const before = sequence.items.length;
  sequence.items = sequence.items.filter((item) => !shotIds.has(item.shotId));
  if (sequence.items.length !== before) touch(canvas);
}

/** A successful CAS only advances the persisted base; newer local edits stay intact. */
export function synchronizeDeliverySequenceRevision(
  state: CanvasSliceState,
  action: PayloadAction<{ canvasId: string; revision: number }>,
): void {
  const canvas = state.canvases.entities[action.payload.canvasId];
  if (!canvas?.deliverySequence || !Number.isInteger(action.payload.revision) || action.payload.revision < 1) return;
  canvas.deliverySequence.revision = action.payload.revision;
}
