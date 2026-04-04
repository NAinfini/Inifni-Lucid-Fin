import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type AudioTrackType = 'voice' | 'music' | 'sfx';

export interface AudioTrack {
  id: string;
  sceneId: string;
  type: AudioTrackType;
  provider: string;
  text: string;
  assetHash: string | null;
  duration: number;
  volume: number;
  startTime: number;
  status: 'draft' | 'generating' | 'completed' | 'failed';
  jobId: string | null;
}

export interface AudioState {
  tracks: AudioTrack[];
  selectedId: string | null;
  playingId: string | null;
}

const initialState: AudioState = {
  tracks: [],
  selectedId: null,
  playingId: null,
};

export const audioSlice = createSlice({
  name: 'audio',
  initialState,
  reducers: {
    setAudioTracks(state, action: PayloadAction<AudioTrack[]>) {
      state.tracks = action.payload;
    },
    addAudioTrack(state, action: PayloadAction<AudioTrack>) {
      state.tracks.push(action.payload);
    },
    updateAudioTrack(state, action: PayloadAction<{ id: string; data: Partial<AudioTrack> }>) {
      const track = state.tracks.find((t) => t.id === action.payload.id);
      if (track) Object.assign(track, action.payload.data);
    },
    removeAudioTrack(state, action: PayloadAction<string>) {
      state.tracks = state.tracks.filter((t) => t.id !== action.payload);
      if (state.selectedId === action.payload) state.selectedId = null;
      if (state.playingId === action.payload) state.playingId = null;
    },
    selectAudioTrack(state, action: PayloadAction<string | null>) {
      state.selectedId = action.payload;
    },
    setPlayingTrack(state, action: PayloadAction<string | null>) {
      state.playingId = action.payload;
    },
    restore(_, action: PayloadAction<AudioState>) {
      return action.payload;
    },
  },
});

export const {
  setAudioTracks,
  addAudioTrack,
  updateAudioTrack,
  removeAudioTrack,
  selectAudioTrack,
  setPlayingTrack,
} = audioSlice.actions;
