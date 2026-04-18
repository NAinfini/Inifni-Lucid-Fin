/**
 * Canvas-domain table. Canvas body (nodes/edges/viewport/notes) is
 * stored as serialized JSON — repositories parse through the canvas DTO
 * schema before returning to callers.
 */
import type { CanvasId } from '@lucid-fin/contracts';
import { defineTable, col } from '../../tables.js';

export const CanvasesTable = defineTable('canvases', {
  id: col<CanvasId>('id'),
  name: col<string>('name'),
  nodes: col<string>('nodes'),
  edges: col<string>('edges'),
  viewport: col<string>('viewport'),
  notes: col<string>('notes'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
});
