/**
 * Canvas-domain table. Canvas body (nodes/edges/viewport/notes) is
 * stored as serialized JSON — repositories parse through the canvas DTO
 * schema before returning to callers.
 *
 * Per-canvas settings columns (stylePlate / aspectRatio / providerIds)
 * are nullable and override nothing at the program level — they are the
 * authoritative per-canvas value when set, and "unset" simply means the
 * downstream consumer handles the absence.
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
  stylePlate:         col<string | null>('style_plate'),
  negativePrompt:     col<string | null>('negative_prompt'),
  // refWidth/refHeight back `CanvasSettings.refResolution` (ref-image default).
  // SQL column names stay as `default_width` / `default_height` so existing
  // installs don't need a RENAME COLUMN migration — the legacy column meaning
  // (ref-image default) is preserved.
  refWidth:           col<number | null>('default_width'),
  refHeight:          col<number | null>('default_height'),
  publishImageWidth:  col<number | null>('publish_width'),
  publishImageHeight: col<number | null>('publish_height'),
  publishVideoWidth:  col<number | null>('publish_video_width'),
  publishVideoHeight: col<number | null>('publish_video_height'),
  aspectRatio:        col<string | null>('aspect_ratio'),
  llmProviderId:      col<string | null>('llm_provider_id'),
  imageProviderId:    col<string | null>('image_provider_id'),
  videoProviderId:    col<string | null>('video_provider_id'),
  audioProviderId:    col<string | null>('audio_provider_id'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
});
