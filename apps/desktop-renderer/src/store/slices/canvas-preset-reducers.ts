import type { PayloadAction } from '@reduxjs/toolkit';
import {
  PRESET_CATEGORIES,
  type PresetCategory,
  type PresetTrackEntry,
  type ShotTemplate,
} from '@lucid-fin/contracts';
import type { CanvasSliceState } from './canvas.js';
import {
  findActiveCanvas,
  ensureNodePresetTracks,
  normalizeTrackEntries,
  type TrackMap,
} from './canvas-helpers.js';

// ---------------------------------------------------------------------------
// Track AI decide
// ---------------------------------------------------------------------------

export function setNodeTrackAiDecide(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; category: PresetCategory; aiDecide: boolean }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = ensureNodePresetTracks(node);
  if (!data.presetTracks[action.payload.category]) {
    data.presetTracks[action.payload.category] = {
      category: action.payload.category,
      aiDecide: false,
      entries: [],
    };
  }
  const track = data.presetTracks[action.payload.category];
  track.aiDecide = action.payload.aiDecide;
  track.entries.forEach((entry) => {
    entry.aiDecide = action.payload.aiDecide;
  });
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function setAllTracksAiDecide(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; aiDecide: boolean }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = ensureNodePresetTracks(node);
  Object.values(data.presetTracks).forEach((track) => {
    track.aiDecide = action.payload.aiDecide;
    track.entries.forEach((entry) => {
      entry.aiDecide = action.payload.aiDecide;
    });
  });
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

// ---------------------------------------------------------------------------
// Shot template
// ---------------------------------------------------------------------------

export function applyNodeShotTemplate(
  state: CanvasSliceState,
  action: PayloadAction<{ nodeId: string; template: ShotTemplate }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.nodeId);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = ensureNodePresetTracks(node);
  const { template } = action.payload;
  for (const cat of PRESET_CATEGORIES) {
    const tmplTrack = template.tracks[cat];
    if (tmplTrack) {
      (data.presetTracks as TrackMap)[cat] = {
        category: cat,
        aiDecide: false,
        intensity: tmplTrack.intensity,
        entries: tmplTrack.entries.map((e, i) => ({
          ...e,
          id: `tmpl-${cat}-${Date.now()}-${i}`,
          order: i,
        })),
      };
    }
  }
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

// ---------------------------------------------------------------------------
// Track entry CRUD
// ---------------------------------------------------------------------------

export function addNodePresetTrackEntry(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; category: PresetCategory; entry: PresetTrackEntry }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = ensureNodePresetTracks(node);
  if (!data.presetTracks[action.payload.category]) {
    data.presetTracks[action.payload.category] = {
      category: action.payload.category,
      aiDecide: false,
      entries: [],
    };
  }
  const track = data.presetTracks[action.payload.category];
  track.entries.push({
    ...action.payload.entry,
    category: action.payload.category,
    order: track.entries.length,
  });
  normalizeTrackEntries(track, action.payload.category);
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function updateNodePresetTrackEntry(
  state: CanvasSliceState,
  action: PayloadAction<{
    id: string;
    category: PresetCategory;
    entryId: string;
    changes: Partial<PresetTrackEntry>;
  }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = ensureNodePresetTracks(node);
  if (!data.presetTracks[action.payload.category]) {
    data.presetTracks[action.payload.category] = {
      category: action.payload.category,
      aiDecide: false,
      entries: [],
    };
  }
  const track = data.presetTracks[action.payload.category];
  const entry = track.entries.find((item) => item.id === action.payload.entryId);
  if (!entry) return;
  Object.assign(entry, action.payload.changes);
  normalizeTrackEntries(track, action.payload.category);
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function removeNodePresetTrackEntry(
  state: CanvasSliceState,
  action: PayloadAction<{ id: string; category: PresetCategory; entryId: string }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = ensureNodePresetTracks(node);
  if (!data.presetTracks[action.payload.category]) {
    data.presetTracks[action.payload.category] = {
      category: action.payload.category,
      aiDecide: false,
      entries: [],
    };
  }
  const track = data.presetTracks[action.payload.category];
  track.entries = track.entries.filter((item) => item.id !== action.payload.entryId);
  normalizeTrackEntries(track, action.payload.category);
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}

export function moveNodePresetTrackEntry(
  state: CanvasSliceState,
  action: PayloadAction<{
    id: string;
    category: PresetCategory;
    entryId: string;
    direction: 'up' | 'down';
  }>,
): void {
  const canvas = findActiveCanvas(state);
  if (!canvas) return;
  const node = canvas.nodes.find((n) => n.id === action.payload.id);
  if (!node || (node.type !== 'image' && node.type !== 'video')) return;
  const data = ensureNodePresetTracks(node);
  if (!data.presetTracks[action.payload.category]) {
    data.presetTracks[action.payload.category] = {
      category: action.payload.category,
      aiDecide: false,
      entries: [],
    };
  }
  const track = data.presetTracks[action.payload.category];
  const currentIndex = track.entries.findIndex((item) => item.id === action.payload.entryId);
  if (currentIndex === -1) return;
  const targetIndex =
    action.payload.direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (targetIndex < 0 || targetIndex >= track.entries.length) return;
  const [moved] = track.entries.splice(currentIndex, 1);
  track.entries.splice(targetIndex, 0, moved);
  normalizeTrackEntries(track, action.payload.category);
  node.updatedAt = Date.now();
  canvas.updatedAt = node.updatedAt;
}
