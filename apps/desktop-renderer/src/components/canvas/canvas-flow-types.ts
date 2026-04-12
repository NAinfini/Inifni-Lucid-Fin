/**
 * Shared type definitions for the Canvas ↔ React Flow data mapping layer.
 *
 * These types are consumed by canvas-utils.ts, useFlowData.ts, and
 * CanvasWorkspace.tsx. Centralising them here eliminates `unknown as` casts
 * in node/edge components and provides a single source of truth for the
 * visual-state shape that flows through the React Flow pipeline.
 */

import type { PresetTrack, PresetTrackSet } from '@lucid-fin/contracts';

/** Subset of node.data relevant to preset track display. */
export interface PresetTrackNodeData {
  presetTracks?: Partial<PresetTrackSet> | Record<string, PresetTrack>;
}

/**
 * Visual overlay state injected into each React Flow node/edge by the
 * mapping layer. Controls dependency highlighting and search dimming.
 */
export interface FlowVisualState {
  dependencyRole: 'upstream' | 'downstream' | 'focus' | null;
  dimmed: boolean;
}
