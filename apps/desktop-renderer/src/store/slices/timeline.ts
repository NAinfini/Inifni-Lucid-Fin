import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface TimelineClip {
  id: string;
  trackId: string;
  assetHash: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  speed: number;
  transition?: { type: string; duration: number };
}

export interface TimelineTrack {
  id: string;
  type: 'video' | 'audio' | 'subtitle' | 'title';
  name: string;
  clips: TimelineClip[];
  muted: boolean;
  locked: boolean;
  volume: number;
}

export interface SubtitleEntry {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  fontSize: number;
  color: string;
  position: 'top' | 'center' | 'bottom';
  bgOpacity: number;
}

export interface TimelineState {
  tracks: TimelineTrack[];
  subtitles: SubtitleEntry[];
  totalDuration: number;
  fps: number;
  selectedClipId: string | null;
  selectedTrackId: string | null;
  playheadTime: number;
  zoom: number;
}

const initialState: TimelineState = {
  tracks: [],
  subtitles: [],
  totalDuration: 0,
  fps: 30,
  selectedClipId: null,
  selectedTrackId: null,
  playheadTime: 0,
  zoom: 1,
};

function recalcDuration(tracks: TimelineTrack[]): number {
  let max = 0;
  for (const t of tracks) {
    for (const c of t.clips) {
      const end = c.startTime + c.duration;
      if (end > max) max = end;
    }
  }
  return max;
}

export const timelineSlice = createSlice({
  name: 'timeline',
  initialState,
  reducers: {
    setTimeline(state, action: PayloadAction<{ tracks: TimelineTrack[]; fps?: number }>) {
      state.tracks = action.payload.tracks;
      if (action.payload.fps) state.fps = action.payload.fps;
      state.totalDuration = recalcDuration(state.tracks);
    },
    addTrack(state, action: PayloadAction<TimelineTrack>) {
      state.tracks.push(action.payload);
    },
    removeTrack(state, action: PayloadAction<string>) {
      state.tracks = state.tracks.filter((t) => t.id !== action.payload);
      state.totalDuration = recalcDuration(state.tracks);
    },
    updateTrack(
      state,
      action: PayloadAction<{
        id: string;
        data: Partial<Pick<TimelineTrack, 'name' | 'muted' | 'locked' | 'volume'>>;
      }>,
    ) {
      const t = state.tracks.find((t) => t.id === action.payload.id);
      if (!t) return;
      const { name, muted, locked, volume } = action.payload.data;
      if (name !== undefined) t.name = name;
      if (muted !== undefined) t.muted = muted;
      if (locked !== undefined) t.locked = locked;
      if (volume !== undefined) t.volume = volume;
    },
    addClip(state, action: PayloadAction<{ trackId: string; clip: TimelineClip }>) {
      const t = state.tracks.find((t) => t.id === action.payload.trackId);
      if (t) {
        t.clips.push(action.payload.clip);
        state.totalDuration = recalcDuration(state.tracks);
      }
    },
    updateClip(state, action: PayloadAction<{ clipId: string; data: Partial<TimelineClip> }>) {
      for (const t of state.tracks) {
        const c = t.clips.find((c) => c.id === action.payload.clipId);
        if (c) {
          Object.assign(c, action.payload.data);
          state.totalDuration = recalcDuration(state.tracks);
          return;
        }
      }
    },
    removeClip(state, action: PayloadAction<string>) {
      for (const t of state.tracks) {
        const idx = t.clips.findIndex((c) => c.id === action.payload);
        if (idx >= 0) {
          t.clips.splice(idx, 1);
          state.totalDuration = recalcDuration(state.tracks);
          if (state.selectedClipId === action.payload) state.selectedClipId = null;
          return;
        }
      }
    },
    moveClip(
      state,
      action: PayloadAction<{ clipId: string; newStartTime: number; newTrackId?: string }>,
    ) {
      const { clipId, newStartTime, newTrackId } = action.payload;
      for (const t of state.tracks) {
        const idx = t.clips.findIndex((c) => c.id === clipId);
        if (idx >= 0) {
          const clip = t.clips[idx];
          clip.startTime = Math.max(0, newStartTime);
          if (newTrackId && newTrackId !== t.id) {
            const target = state.tracks.find((tt) => tt.id === newTrackId);
            if (target && target.type === t.type) {
              t.clips.splice(idx, 1);
              target.clips.push(clip);
            }
          }
          state.totalDuration = recalcDuration(state.tracks);
          return;
        }
      }
    },
    splitClip(state, action: PayloadAction<{ clipId: string; splitTime: number }>) {
      const { clipId, splitTime } = action.payload;
      for (const t of state.tracks) {
        const idx = t.clips.findIndex((c) => c.id === clipId);
        if (idx >= 0) {
          const clip = t.clips[idx];
          const relSplit = splitTime - clip.startTime;
          if (relSplit <= 0 || relSplit >= clip.duration) return;
          const newClip: TimelineClip = {
            id: crypto.randomUUID(),
            trackId: t.id,
            assetHash: clip.assetHash,
            startTime: splitTime,
            duration: clip.duration - relSplit,
            inPoint: clip.inPoint + relSplit * clip.speed,
            outPoint: clip.outPoint,
            speed: clip.speed,
          };
          clip.duration = relSplit;
          clip.outPoint = clip.inPoint + relSplit * clip.speed;
          t.clips.splice(idx + 1, 0, newClip);
          state.totalDuration = recalcDuration(state.tracks);
          return;
        }
      }
    },
    selectClip(state, action: PayloadAction<string | null>) {
      state.selectedClipId = action.payload;
    },
    selectTrack(state, action: PayloadAction<string | null>) {
      state.selectedTrackId = action.payload;
    },
    setPlayhead(state, action: PayloadAction<number>) {
      state.playheadTime = Math.max(0, action.payload);
    },
    setZoom(state, action: PayloadAction<number>) {
      state.zoom = Math.max(0.1, Math.min(10, action.payload));
    },
    setSubtitles(state, action: PayloadAction<SubtitleEntry[]>) {
      state.subtitles = action.payload;
    },
    addSubtitle(state, action: PayloadAction<SubtitleEntry>) {
      state.subtitles.push(action.payload);
    },
    updateSubtitle(state, action: PayloadAction<{ id: string; data: Partial<SubtitleEntry> }>) {
      const entry = state.subtitles.find((s) => s.id === action.payload.id);
      if (entry) Object.assign(entry, action.payload.data);
    },
    removeSubtitle(state, action: PayloadAction<string>) {
      state.subtitles = state.subtitles.filter((s) => s.id !== action.payload);
    },
    restore(_, action: PayloadAction<TimelineState>) {
      return action.payload;
    },
  },
});

export const {
  setTimeline,
  addTrack,
  removeTrack,
  updateTrack,
  addClip,
  updateClip,
  removeClip,
  moveClip,
  splitClip,
  selectClip,
  selectTrack,
  setPlayhead,
  setZoom,
  setSubtitles,
  addSubtitle,
  updateSubtitle,
  removeSubtitle,
} = timelineSlice.actions;
