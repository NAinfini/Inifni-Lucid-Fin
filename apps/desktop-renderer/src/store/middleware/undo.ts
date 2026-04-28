import type { Middleware, UnknownAction } from '@reduxjs/toolkit';
import { t } from '../../i18n.js';
import { computeInverseAction, estimateActionBytes } from './undo-inverse.js';

export interface UndoCommand {
  label: string;
  timestamp: number;
  execute: UnknownAction;
  undo: UnknownAction;
  /** Approximate byte size of the undo payload — used for memory eviction */
  byteSize: number;
}

const TRACKED_PREFIXES = [
  'characters/',
  'equipment/',
  'storyboard/',
  'orchestration/',
  'audio/',
  'canvas/',
  'presets/',
];
const DEFAULT_MAX_STACK = 100;
/** Maximum total undo stack memory before oldest entries are evicted (10 MB) */
const MAX_UNDO_MEMORY = 10 * 1024 * 1024;
const DEFAULT_GROUP_WINDOW_MS = 300;

/** Read settings from store, falling back to defaults if unavailable */
function getUndoSettings(state: Record<string, unknown>): { maxStack: number; groupWindowMs: number } {
  const commander = state.commander as { undoStackDepth?: number; undoGroupWindowMs?: number } | undefined;
  return {
    maxStack: commander?.undoStackDepth ?? DEFAULT_MAX_STACK,
    groupWindowMs: commander?.undoGroupWindowMs ?? DEFAULT_GROUP_WINDOW_MS,
  };
}

const undoStack: UndoCommand[] = [];
const redoStack: UndoCommand[] = [];

/** Running total of approximate byte sizes across the undo stack */
let undoStackBytes = 0;

function shouldTrack(type: string): boolean {
  return TRACKED_PREFIXES.some((p) => type.startsWith(p));
}

function actionLabel(type: string): string {
  const parts = type.split('/');
  const labels: Record<string, string> = {
    addKeyframe: 'undo.action.addKeyframe',
    updateKeyframe: 'undo.action.updateKeyframe',
    removeKeyframe: 'undo.action.removeKeyframe',
    reorderKeyframes: 'undo.action.reorderKeyframes',
    addSegment: 'undo.action.addSegment',
    updateSegment: 'undo.action.updateSegment',
    removeSegment: 'undo.action.removeSegment',
    addTrack: 'undo.action.addTrack',
    removeTrack: 'undo.action.removeTrack',
    addClip: 'undo.action.addClip',
    removeClip: 'undo.action.removeClip',
    splitClip: 'undo.action.splitClip',
  };
  return labels[parts[1]] ? t(labels[parts[1]]) : `${parts[0]}.${parts[1]}`;
}

/** Evict the oldest undo entry and subtract its byte size */
function evictOldest(): void {
  const removed = undoStack.shift();
  if (removed) {
    undoStackBytes -= removed.byteSize;
    if (undoStackBytes < 0) undoStackBytes = 0;
  }
}

export const undoMiddleware: Middleware = (store) => (next) => (action) => {
  if (typeof action !== 'object' || action === null || !('type' in action)) {
    return next(action);
  }

  const typed = action as UnknownAction & { type: string };

  if (typed.type === 'undo/undo') {
    const entry = undoStack.pop();
    if (entry) {
      undoStackBytes -= entry.byteSize;
      if (undoStackBytes < 0) undoStackBytes = 0;
      redoStack.push(entry);
      store.dispatch(entry.undo);
    }
    return;
  }

  if (typed.type === 'undo/redo') {
    const entry = redoStack.pop();
    if (entry) {
      undoStack.push(entry);
      undoStackBytes += entry.byteSize;
      return next(entry.execute);
    }
    return;
  }

  if (shouldTrack(typed.type)) {
    const sliceName = typed.type.split('/')[0];
    const currentState = store.getState() as Record<string, unknown>;
    const prevSliceState = currentState[sliceName];
    const { maxStack, groupWindowMs } = getUndoSettings(currentState);
    const now = Date.now();
    const label = actionLabel(typed.type);

    // Try to compute a minimal inverse action first
    const inverseAction = computeInverseAction(
      typed.type,
      typed,
      prevSliceState as Record<string, unknown>,
    );

    const undoAction: UnknownAction = inverseAction !== null
      ? inverseAction
      : ({ type: `${sliceName}/restore`, payload: prevSliceState } as UnknownAction);

    const byteSize = estimateActionBytes(undoAction);

    // Group rapid edits of the same action type
    const lastEntry = undoStack[undoStack.length - 1];
    if (
      lastEntry &&
      lastEntry.execute.type === typed.type &&
      now - lastEntry.timestamp < groupWindowMs
    ) {
      // Update the grouped command's execute to latest, keep original undo
      // Adjust byte accounting: remove old size, add new size
      undoStackBytes -= lastEntry.byteSize;
      lastEntry.execute = typed;
      lastEntry.timestamp = now;
      // Keep the original undo action (earliest state in the group)
      undoStackBytes += lastEntry.byteSize;
    } else {
      const command: UndoCommand = {
        label,
        timestamp: now,
        execute: typed,
        undo: undoAction,
        byteSize,
      };
      undoStack.push(command);
      undoStackBytes += byteSize;

      // Evict oldest entries when over MAX_STACK count
      if (undoStack.length > maxStack) {
        evictOldest();
      }

      // Evict oldest entries when over memory threshold
      while (undoStackBytes > MAX_UNDO_MEMORY && undoStack.length > 1) {
        evictOldest();
      }
    }

    redoStack.length = 0;
  }

  return next(action);
};

export function canUndo(): boolean {
  return undoStack.length > 0;
}
export function canRedo(): boolean {
  return redoStack.length > 0;
}
export function getUndoLabel(): string | null {
  return undoStack[undoStack.length - 1]?.label ?? null;
}
export function getRedoLabel(): string | null {
  return redoStack[redoStack.length - 1]?.label ?? null;
}
export function getUndoStackSize(): number {
  return undoStack.length;
}
export function getRedoStackSize(): number {
  return redoStack.length;
}
/** Returns approximate total byte size of the current undo stack */
export function getUndoStackBytes(): number {
  return undoStackBytes;
}
