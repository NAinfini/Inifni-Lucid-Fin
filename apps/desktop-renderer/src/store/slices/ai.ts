import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface AiMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface AiSuggestion {
  id: string;
  type: 'fix' | 'enhance' | 'warning' | 'info';
  title: string;
  description: string;
  targetId?: string;
  targetType?: string;
  action?: { type: string; payload: unknown };
  dismissed: boolean;
  createdAt: number;
}

export interface BatchOperation {
  id: string;
  label: string;
  targetIds: string[];
  actionType: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  total: number;
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: 'calling' | 'success' | 'error';
  result?: unknown;
  error?: string;
  timestamp: number;
}

export interface AiState {
  messages: AiMessage[];
  loading: boolean;
  streamBuffer: string;
  contextPage: string | null;
  contextSceneId: string | null;
  contextSegmentId: string | null;
  contextCharacterId: string | null;
  /** Inline context popup */
  popupOpen: boolean;
  popupAnchor: { x: number; y: number } | null;
  popupTargetId: string | null;
  /** Proactive suggestions */
  suggestions: AiSuggestion[];
  /** Batch operations */
  batchOps: BatchOperation[];
  /** Tool calls from agent */
  toolCalls: AiToolCall[];
}

const initialState: AiState = {
  messages: [],
  loading: false,
  streamBuffer: '',
  contextPage: null,
  contextSceneId: null,
  contextSegmentId: null,
  contextCharacterId: null,
  popupOpen: false,
  popupAnchor: null,
  popupTargetId: null,
  suggestions: [],
  batchOps: [],
  toolCalls: [],
};

export const aiSlice = createSlice({
  name: 'ai',
  initialState,
  reducers: {
    addMessage(state, action: PayloadAction<AiMessage>) {
      state.messages.push(action.payload);
    },
    appendStream(state, action: PayloadAction<string>) {
      state.streamBuffer += action.payload;
    },
    flushStream(state) {
      if (state.streamBuffer) {
        state.messages.push({
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: state.streamBuffer,
          timestamp: Date.now(),
        });
        state.streamBuffer = '';
      }
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    setContext(
      state,
      action: PayloadAction<{
        page?: string;
        sceneId?: string;
        segmentId?: string;
        characterId?: string;
      }>,
    ) {
      if (action.payload.page !== undefined) {
        // Clear stale context when switching pages
        if (action.payload.page !== state.contextPage) {
          state.contextSceneId = null;
          state.contextSegmentId = null;
          state.contextCharacterId = null;
        }
        state.contextPage = action.payload.page;
      }
      if (action.payload.sceneId !== undefined) state.contextSceneId = action.payload.sceneId;
      if (action.payload.segmentId !== undefined) state.contextSegmentId = action.payload.segmentId;
      if (action.payload.characterId !== undefined)
        state.contextCharacterId = action.payload.characterId;
    },
    clearMessages(state) {
      state.messages = [];
      state.streamBuffer = '';
    },

    // --- Inline context popup ---
    openPopup(state, action: PayloadAction<{ x: number; y: number; targetId: string }>) {
      state.popupOpen = true;
      state.popupAnchor = { x: action.payload.x, y: action.payload.y };
      state.popupTargetId = action.payload.targetId;
    },
    closePopup(state) {
      state.popupOpen = false;
      state.popupAnchor = null;
      state.popupTargetId = null;
    },

    // --- Proactive suggestions ---
    addSuggestion(state, action: PayloadAction<Omit<AiSuggestion, 'dismissed' | 'createdAt'>>) {
      if (state.suggestions.some((s) => s.id === action.payload.id)) return;
      state.suggestions.push({ ...action.payload, dismissed: false, createdAt: Date.now() });
    },
    dismissSuggestion(state, action: PayloadAction<string>) {
      const s = state.suggestions.find((s) => s.id === action.payload);
      if (s) s.dismissed = true;
    },
    clearSuggestions(state) {
      state.suggestions = [];
    },

    // --- Batch operations ---
    addBatchOp(state, action: PayloadAction<Omit<BatchOperation, 'status' | 'progress'>>) {
      state.batchOps.push({ ...action.payload, status: 'pending', progress: 0 });
    },
    updateBatchOp(
      state,
      action: PayloadAction<{ id: string; status?: BatchOperation['status']; progress?: number }>,
    ) {
      const op = state.batchOps.find((o) => o.id === action.payload.id);
      if (!op) return;
      if (action.payload.status !== undefined) op.status = action.payload.status;
      if (action.payload.progress !== undefined) op.progress = action.payload.progress;
    },
    removeBatchOp(state, action: PayloadAction<string>) {
      state.batchOps = state.batchOps.filter((o) => o.id !== action.payload);
    },

    // --- Tool calls ---
    addToolCall(
      state,
      action: PayloadAction<{ id: string; name: string; arguments: Record<string, unknown> }>,
    ) {
      state.toolCalls.push({ ...action.payload, status: 'calling', timestamp: Date.now() });
    },
    updateToolCall(
      state,
      action: PayloadAction<{
        id: string;
        status: 'success' | 'error';
        result?: unknown;
        error?: string;
      }>,
    ) {
      const tc = state.toolCalls.find((t) => t.id === action.payload.id);
      if (tc) {
        tc.status = action.payload.status;
        tc.result = action.payload.result;
        tc.error = action.payload.error;
      }
    },
    clearToolCalls(state) {
      state.toolCalls = [];
    },
  },
});

export const {
  addMessage,
  appendStream,
  flushStream,
  setLoading,
  setContext,
  clearMessages,
  openPopup,
  closePopup,
  addSuggestion,
  dismissSuggestion,
  clearSuggestions,
  addBatchOp,
  updateBatchOp,
  removeBatchOp,
  addToolCall,
  updateToolCall,
  clearToolCalls,
} = aiSlice.actions;
