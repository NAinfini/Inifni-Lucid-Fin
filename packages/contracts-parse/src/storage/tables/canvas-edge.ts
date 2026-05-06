/**
 * Canvas-edge table definition. Each row represents one ReactFlow edge
 * belonging to a canvas.
 */
import { defineTable, col } from '../../tables.js';

export const CanvasEdgesTable = defineTable('canvas_edges', {
  id: col<string>('id'),
  canvasId: col<string>('canvas_id'),
  source: col<string>('source'),
  target: col<string>('target'),
  sourceHandle: col<string | null>('source_handle'),
  targetHandle: col<string | null>('target_handle'),
  label: col<string | null>('label'),
  status: col<string>('status'),
  autoLabel: col<number>('auto_label'),
  zIndex: col<number>('z_index'),
  createdAt: col<string>('created_at'),
  updatedAt: col<string>('updated_at'),
});
