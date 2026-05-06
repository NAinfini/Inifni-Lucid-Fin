/**
 * Canvas-node table definition. Each row represents a single ReactFlow
 * node belonging to a canvas.
 */
import { defineTable, col } from '../../tables.js';

export const CanvasNodesTable = defineTable('canvas_nodes', {
  id: col<string>('id'),
  canvasId: col<string>('canvas_id'),
  type: col<string>('type'),
  positionX: col<number>('position_x'),
  positionY: col<number>('position_y'),
  width: col<number | null>('width'),
  height: col<number | null>('height'),
  dataJson: col<string>('data_json'),
  zIndex: col<number>('z_index'),
  createdAt: col<string>('created_at'),
  updatedAt: col<string>('updated_at'),
});
