import { createContext, useContext } from 'react';
import type { CanvasNodeType } from '@lucid-fin/contracts';

export interface EdgeCallbacks {
  onDelete: (id: string) => void;
  onSwapDirection: (id: string) => void;
  onInsertNode: (id: string, type: CanvasNodeType, position: { x: number; y: number }) => void;
}

const NOOP = () => {};
const DEFAULT_CALLBACKS: EdgeCallbacks = {
  onDelete: NOOP,
  onSwapDirection: NOOP,
  onInsertNode: NOOP,
};

export const EdgeCallbacksContext = createContext<EdgeCallbacks>(DEFAULT_CALLBACKS);

export function useEdgeCallbacks(): EdgeCallbacks {
  return useContext(EdgeCallbacksContext);
}
