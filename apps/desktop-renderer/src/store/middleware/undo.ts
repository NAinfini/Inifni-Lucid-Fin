import type { Middleware, UnknownAction } from '@reduxjs/toolkit';
import { t } from '../../i18n.js';

export interface UndoCommand {
  label: string;
  timestamp: number;
  execute: UnknownAction;
  undo: UnknownAction;
}

const TRACKED_PREFIXES = [
  'script/',
  'characters/',
  'equipment/',
  'storyboard/',
  'orchestration/',
  'audio/',
  'canvas/',
  'presets/',
];
const MAX_STACK = 100;
const GROUP_WINDOW_MS = 300;

const undoStack: UndoCommand[] = [];
const redoStack: UndoCommand[] = [];

function shouldTrack(type: string): boolean {
  return TRACKED_PREFIXES.some((p) => type.startsWith(p));
}

function actionLabel(type: string): string {
  const parts = type.split('/');
  const labels: Record<string, string> = {
    updateContent: 'undo.action.updateContent',
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

export const undoMiddleware: Middleware = (store) => (next) => (action) => {
  if (typeof action !== 'object' || action === null || !('type' in action)) {
    return next(action);
  }

  const typed = action as UnknownAction & { type: string };

  if (typed.type === 'undo/undo') {
    const entry = undoStack.pop();
    if (entry) {
      redoStack.push(entry);
      store.dispatch(entry.undo);
    }
    return;
  }

  if (typed.type === 'undo/redo') {
    const entry = redoStack.pop();
    if (entry) {
      undoStack.push(entry);
      return next(entry.execute);
    }
    return;
  }

  if (shouldTrack(typed.type)) {
    const sliceName = typed.type.split('/')[0];
    const prevSliceState = (store.getState() as Record<string, unknown>)[sliceName];
    const now = Date.now();

    const label = actionLabel(typed.type);

    // Group rapid edits of the same action type
    const lastEntry = undoStack[undoStack.length - 1];
    if (
      lastEntry &&
      lastEntry.execute.type === typed.type &&
      now - lastEntry.timestamp < GROUP_WINDOW_MS
    ) {
      // Update the grouped command's execute to latest, keep original undo
      lastEntry.execute = typed;
      lastEntry.timestamp = now;
    } else {
      const command: UndoCommand = {
        label,
        timestamp: now,
        execute: typed,
        undo: { type: `${sliceName}/restore`, payload: prevSliceState } as UnknownAction,
      };
      undoStack.push(command);
      if (undoStack.length > MAX_STACK) undoStack.shift();
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
