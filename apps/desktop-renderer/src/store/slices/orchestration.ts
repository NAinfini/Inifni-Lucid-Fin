import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// Presets
export const MOTION_PRESETS = [
  'static',
  'walk',
  'run',
  'fight',
  'dance',
  'sit',
  'gesture',
  'custom',
] as const;
export const CAMERA_PRESETS = [
  'static',
  'pan',
  'tilt',
  'push',
  'crane',
  'handheld',
  'tracking',
  'orbit',
] as const;
export const EMOTION_PRESETS = [
  'neutral',
  'joy',
  'anger',
  'sadness',
  'fear',
  'surprise',
  'disgust',
] as const;

export interface SegmentState {
  id: string;
  sceneId: string;
  startKeyframeId: string;
  endKeyframeId: string;
  motion: string;
  camera: string;
  mood: string;
  moodIntensity: number;
  negativePrompt: string;
  seed: number | null;
  duration: number;
  videoAssetHash: string | null;
  cameraPreset: string;
  splitLayout: string;
  focalLength: number;
  depthOfField: number;
  lipSync: boolean;
}

export interface OrchestrationState {
  segments: SegmentState[];
  selectedId: string | null;
  previewSceneId: string | null;
}

const initialState: OrchestrationState = {
  segments: [],
  selectedId: null,
  previewSceneId: null,
};

export const orchestrationSlice = createSlice({
  name: 'orchestration',
  initialState,
  reducers: {
    setSegments(state, action: PayloadAction<SegmentState[]>) {
      state.segments = action.payload;
    },
    addSegment(state, action: PayloadAction<SegmentState>) {
      state.segments.push(action.payload);
    },
    updateSegment(state, action: PayloadAction<{ id: string; data: Partial<SegmentState> }>) {
      const seg = state.segments.find((s) => s.id === action.payload.id);
      if (seg) Object.assign(seg, action.payload.data);
    },
    removeSegment(state, action: PayloadAction<string>) {
      state.segments = state.segments.filter((s) => s.id !== action.payload);
      if (state.selectedId === action.payload) state.selectedId = null;
    },
    selectSegment(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload;
    },
    setPreviewScene(state, action: PayloadAction<string | null>) {
      state.previewSceneId = action.payload;
    },
    updateCamera(
      state,
      action: PayloadAction<{
        segmentId: string;
        camera: Partial<
          Pick<SegmentState, 'cameraPreset' | 'splitLayout' | 'focalLength' | 'depthOfField'>
        >;
      }>,
    ) {
      const seg = state.segments.find((s) => s.id === action.payload.segmentId);
      if (seg) Object.assign(seg, action.payload.camera);
    },
    restore(_, action: PayloadAction<OrchestrationState>) {
      return action.payload;
    },
  },
});

export const {
  setSegments,
  addSegment,
  updateSegment,
  removeSegment,
  selectSegment,
  setPreviewScene,
  updateCamera,
} = orchestrationSlice.actions;
