import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type KeyframeStatus = 'draft' | 'generating' | 'review' | 'approved' | 'rejected';

export interface KeyframeState {
  id: string;
  sceneId: string;
  index: number;
  prompt: string;
  negativePrompt: string;
  assetHash: string | null;
  status: KeyframeStatus;
  variants: string[];
  seed: number | null;
}

export interface StoryboardState {
  keyframes: KeyframeState[];
  selectedId: string | null;
  /** Keyframe IDs that may need regeneration due to upstream changes (e.g. character edits) */
  staleKeyframeIds: string[];
}

const initialState: StoryboardState = {
  keyframes: [],
  selectedId: null,
  staleKeyframeIds: [],
};

export const storyboardSlice = createSlice({
  name: 'storyboard',
  initialState,
  reducers: {
    setKeyframes(state, action: PayloadAction<KeyframeState[]>) {
      state.keyframes = action.payload;
    },
    addKeyframe(state, action: PayloadAction<KeyframeState>) {
      state.keyframes.push(action.payload);
    },
    updateKeyframe(state, action: PayloadAction<{ id: string; data: Partial<KeyframeState> }>) {
      const kf = state.keyframes.find((k) => k.id === action.payload.id);
      if (kf) Object.assign(kf, action.payload.data);
    },
    removeKeyframe(state, action: PayloadAction<string>) {
      state.keyframes = state.keyframes.filter((k) => k.id !== action.payload);
    },
    selectKeyframe(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload;
    },
    approveKeyframe(state, action: PayloadAction<{ id: string; variantIndex: number }>) {
      const kf = state.keyframes.find((k) => k.id === action.payload.id);
      if (kf && kf.variants[action.payload.variantIndex]) {
        kf.assetHash = kf.variants[action.payload.variantIndex];
        kf.status = 'approved';
      }
    },
    rejectKeyframe(state, action: PayloadAction<string>) {
      const kf = state.keyframes.find((k) => k.id === action.payload);
      if (kf) kf.status = 'rejected';
    },
    reorderKeyframes(state, action: PayloadAction<{ activeId: string; overId: string }>) {
      const oldIndex = state.keyframes.findIndex((k) => k.id === action.payload.activeId);
      const newIndex = state.keyframes.findIndex((k) => k.id === action.payload.overId);
      if (oldIndex === -1 || newIndex === -1) return;
      const [moved] = state.keyframes.splice(oldIndex, 1);
      state.keyframes.splice(newIndex, 0, moved);
      // Update index values
      state.keyframes.forEach((k, i) => {
        k.index = i;
      });
    },
    markKeyframesStale(state, action: PayloadAction<string[]>) {
      const newIds = action.payload.filter((id) => !state.staleKeyframeIds.includes(id));
      state.staleKeyframeIds.push(...newIds);
    },
    clearStaleKeyframe(state, action: PayloadAction<string>) {
      state.staleKeyframeIds = state.staleKeyframeIds.filter((id) => id !== action.payload);
    },
    clearAllStaleKeyframes(state) {
      state.staleKeyframeIds = [];
    },
    restore(_, action: PayloadAction<StoryboardState>) {
      return action.payload;
    },
  },
});

export const {
  setKeyframes,
  addKeyframe,
  updateKeyframe,
  removeKeyframe,
  selectKeyframe,
  approveKeyframe,
  rejectKeyframe,
  reorderKeyframes,
  markKeyframesStale,
  clearStaleKeyframe,
  clearAllStaleKeyframes,
} = storyboardSlice.actions;
