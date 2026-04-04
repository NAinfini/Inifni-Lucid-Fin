import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface ScriptState {
  id: string | null;
  content: string;
  format: 'fountain' | 'fdx' | 'plaintext';
  parsedScenes: Array<{ heading: string; body: string; index: number }>;
  dirty: boolean;
  loading: boolean;
}

const initialState: ScriptState = {
  id: null,
  content: '',
  format: 'fountain',
  parsedScenes: [],
  dirty: false,
  loading: false,
};

export const scriptSlice = createSlice({
  name: 'script',
  initialState,
  reducers: {
    setScript(
      state,
      action: PayloadAction<{
        id: string;
        content: string;
        format: string;
        parsedScenes: unknown[];
      }>,
    ) {
      state.id = action.payload.id;
      state.content = action.payload.content;
      state.format = action.payload.format as ScriptState['format'];
      state.parsedScenes = action.payload.parsedScenes as ScriptState['parsedScenes'];
      state.dirty = false;
    },
    updateContent(state, action: PayloadAction<string>) {
      state.content = action.payload;
      state.dirty = true;
    },
    setParsedScenes(state, action: PayloadAction<ScriptState['parsedScenes']>) {
      state.parsedScenes = action.payload;
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    clearScript() {
      return initialState;
    },
    restore(_, action: PayloadAction<ScriptState>) {
      return action.payload;
    },
  },
});

export const { setScript, updateContent, setParsedScenes, setLoading, clearScript } =
  scriptSlice.actions;
