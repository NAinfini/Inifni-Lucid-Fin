import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { getUndoLabel, getRedoLabel, canUndo, canRedo } from '../store/middleware/undo.js';

// Simple subscription for external store
let listeners: Array<() => void> = [];
function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

export function useUndoRedo() {
  const dispatch = useDispatch();

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        dispatch({ type: 'undo/undo' });
      } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
        e.preventDefault();
        dispatch({ type: 'undo/redo' });
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [dispatch]);
}

export { canUndo, canRedo, getUndoLabel, getRedoLabel };
