import { createContext, useContext } from 'react';
import { useStore } from '@xyflow/react';

/**
 * LOD (Level of Detail) thresholds inspired by ComfyUI/LiteGraph.js:
 * - full:    zoom >= 0.5  — render everything (widgets, variants, presets, media)
 * - medium:  zoom 0.25–0.5 — skip variants, preset badges, progress bars
 * - minimal: zoom < 0.25  — title bar + colored rectangle only
 */
export type LodLevel = 'full' | 'medium' | 'minimal';

const LOD_FULL_THRESHOLD = 0.5;
const LOD_MEDIUM_THRESHOLD = 0.25;

function zoomToLod(zoom: number): LodLevel {
  if (zoom >= LOD_FULL_THRESHOLD) return 'full';
  if (zoom >= LOD_MEDIUM_THRESHOLD) return 'medium';
  return 'minimal';
}

/** Subscribe to ReactFlow's internal zoom store and derive an LOD level. */
export function useCanvasLod(): LodLevel {
  return useStore((s) => zoomToLod(s.transform[2]));
}

// Context for components that can't use useStore (outside ReactFlow tree)
export const CanvasLodContext = createContext<LodLevel>('full');
export function useCanvasLodFromContext(): LodLevel {
  return useContext(CanvasLodContext);
}
