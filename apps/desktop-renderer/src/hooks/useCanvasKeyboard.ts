import { useEffect } from 'react';
import type { Canvas } from '@lucid-fin/contracts';
import type { AppDispatch } from '../store/index.js';
import {
  removeNodes,
  removeEdges,
  copyNodes as copyNodesAction,
  duplicateNodes,
  toggleBypass,
  toggleLock,
  setSelection,
  clearSelection,
  moveNodes,
  type CanvasClipboardPayload,
} from '../store/slices/canvas.js';
import { setSearchPanelOpen } from '../store/slices/ui.js';
import { enqueueToast } from '../store/slices/toast.js';
import { flushPendingCanvasSave } from '../store/middleware/persist.js';
import { t } from '../i18n.js';

interface CanvasKeyboardDeps {
  canvas: Canvas | undefined;
  dispatch: AppDispatch;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  setConnectingFromNodeId: (id: string | null) => void;
  setDepHighlightLocked: (fn: (prev: boolean) => boolean) => void;
  handleNodeGenerate: (id: string) => void;
  handlePaste: () => Promise<void>;
  handleUndo: () => void;
  handleRedo: () => void;
  buildClipboardPayload: (
    canvas: Canvas,
    selectedNodeIds: string[],
  ) => CanvasClipboardPayload | null;
}

export function useCanvasKeyboard({
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
}: CanvasKeyboardDeps): void {
  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      if (!element) return false;
      return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable;
    };

    const handleCopy = async () => {
      if (!canvas || selectedNodeIds.length === 0) return;
      const payload = buildClipboardPayload(canvas, selectedNodeIds);
      if (!payload) return;
      dispatch(copyNodesAction(selectedNodeIds));
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(
          JSON.stringify({ type: 'lucid-canvas-selection', payload }),
        );
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const editable = isEditableTarget(event.target);
      const mod = event.metaKey || event.ctrlKey;

      if ((event.key === 'Delete' || event.key === 'Backspace') && !editable) {
        event.preventDefault();
        if (selectedNodeIds.length > 0) {
          dispatch(removeNodes(selectedNodeIds));
        } else if (selectedEdgeIds.length > 0) {
          dispatch(removeEdges(selectedEdgeIds));
        }
        return;
      }

      if (!mod) {
        if (event.key === 'Escape') {
          setConnectingFromNodeId(null);
          dispatch(clearSelection());
          dispatch(setSearchPanelOpen(false));
        }
        if (!editable) {
          if (selectedNodeIds.length > 0 && event.key.startsWith('Arrow')) {
            event.preventDefault();
            const step = event.shiftKey ? 20 : 5;
            const dx = event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0;
            const dy = event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0;
            if (dx === 0 && dy === 0) return;
            if (!canvas) return;
            const moves = selectedNodeIds
              .map(id => {
                const node = canvas.nodes.find(n => n.id === id);
                if (!node || node.locked) return null;
                return { id, position: { x: node.position.x + dx, y: node.position.y + dy } };
              })
              .filter((m): m is { id: string; position: { x: number; y: number } } => m !== null);
            if (moves.length > 0) dispatch(moveNodes(moves));
            return;
          }
          switch (event.key.toLowerCase()) {
            case 'd':
              if (selectedNodeIds.length === 0) return;
              event.preventDefault();
              for (const id of selectedNodeIds) dispatch(toggleBypass({ id }));
              return;
            case 'g':
              if (selectedNodeIds.length === 0) return;
              event.preventDefault();
              handleNodeGenerate(selectedNodeIds[0]);
              return;
            case 'h':
              event.preventDefault();
              setDepHighlightLocked((prev) => !prev);
              return;
          }
        }
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'a':
          if (editable || !canvas) return;
          event.preventDefault();
          dispatch(
            setSelection({
              nodeIds: canvas.nodes.map((node) => node.id),
              edgeIds: [],
            }),
          );
          return;
        case 'c': {
          const selection = window.getSelection();
          const hasTextSelection = selection && selection.toString().length > 0;
          if (hasTextSelection) return;
          if (editable || selectedNodeIds.length === 0) return;
          event.preventDefault();
          void handleCopy();
          return;
        }
        case 'd':
          if (editable || selectedNodeIds.length === 0) return;
          event.preventDefault();
          dispatch(duplicateNodes(selectedNodeIds));
          return;
        case 'f':
          if (editable) return;
          event.preventDefault();
          dispatch(setSearchPanelOpen(true));
          return;
        case 'l':
          if (editable || selectedNodeIds.length === 0) return;
          event.preventDefault();
          for (const id of selectedNodeIds) dispatch(toggleLock({ id }));
          return;
        case 's':
          event.preventDefault();
          flushPendingCanvasSave();
          dispatch(enqueueToast({ title: t('toast.saved'), variant: 'success' }));
          return;
        case 'v':
          if (editable) return;
          event.preventDefault();
          void handlePaste();
          return;
        case 'z':
          if (editable) return;
          event.preventDefault();
          if (event.shiftKey) handleRedo(); else handleUndo();
          return;
        case 'y':
          if (editable) return;
          event.preventDefault();
          handleRedo();
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canvas, dispatch, handleNodeGenerate, handlePaste, handleUndo, handleRedo, selectedEdgeIds, selectedNodeIds, setConnectingFromNodeId, setDepHighlightLocked, buildClipboardPayload]);
}
