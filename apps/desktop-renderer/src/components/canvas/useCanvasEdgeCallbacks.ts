/**
 * useCanvasEdgeCallbacks — all edge-level action callbacks.
 *
 * Extracted from CanvasWorkspace to keep the god-component slim.
 * Returns the `EdgeCallbacks` object consumed by `EdgeCallbacksContext`.
 */

import { useCallback, useMemo } from 'react';
import { useDispatch } from 'react-redux';

import type { AppDispatch } from '../../store/index.js';
import { removeEdges, swapEdgeDirection, insertNodeIntoEdge } from '../../store/slices/canvas.js';
import type { NodeKind } from '@lucid-fin/contracts';
import type { EdgeCallbacks } from './edge-callbacks-context.js';

export function useCanvasEdgeCallbacks(): EdgeCallbacks {
  const dispatch = useDispatch<AppDispatch>();

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
    (edgeId: string, type: NodeKind, position: { x: number; y: number }) => {
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

  return useMemo<EdgeCallbacks>(
    () => ({
      onDelete: handleEdgeDelete,
      onSwapDirection: handleEdgeSwap,
      onInsertNode: handleInsertNodeIntoEdge,
    }),
    [handleEdgeDelete, handleEdgeSwap, handleInsertNodeIntoEdge],
  );
}
