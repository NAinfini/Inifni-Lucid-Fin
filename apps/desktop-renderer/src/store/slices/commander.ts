import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface CommanderToolCall {
  name: string;
  id: string;
  arguments: Record<string, unknown>;
  startedAt: number;
  completedAt?: number;
  result?: unknown;
  status: 'pending' | 'done' | 'error';
}

export type MessageSegment =
  | { type: 'text'; content: string }
  | { type: 'tool'; toolCall: CommanderToolCall };

export interface CommanderMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  segments?: MessageSegment[];
  toolCalls?: CommanderToolCall[];
  timestamp: number;
}

export type PermissionMode = 'auto' | 'normal' | 'strict';

export interface PendingConfirmation {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  tier: number;
}

export interface PendingQuestion {
  toolCallId: string;
  question: string;
  options: Array<{ label: string; description?: string }>;
}

export interface CommanderState {
  open: boolean;
  minimized: boolean;
  providerId: string | null;
  messages: CommanderMessage[];
  streaming: boolean;
  currentStreamContent: string;
  currentToolCalls: CommanderToolCall[];
  currentSegments: MessageSegment[];
  error: string | null;
  position: { x: number; y: number };
  size: { width: number; height: number };
  permissionMode: PermissionMode;
  pendingConfirmation: PendingConfirmation | null;
  pendingQuestion: PendingQuestion | null;
  messageQueue: string[];
}

const COMMANDER_PROVIDER_KEY = 'lucid-commander-provider-v1';

function loadPersistedProviderId(): string | null {
  try {
    return localStorage.getItem(COMMANDER_PROVIDER_KEY);
  } catch {
    return null;
  }
}

const initialState: CommanderState = {
  open: false,
  minimized: false,
  providerId: loadPersistedProviderId(),
  messages: [],
  streaming: false,
  currentStreamContent: '',
  currentToolCalls: [],
  currentSegments: [],
  error: null,
  position: { x: 24, y: 96 },
  size: { width: 400, height: 500 },
  permissionMode: 'normal',
  pendingConfirmation: null,
  pendingQuestion: null,
  messageQueue: [],
};

function createMessageId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export const commanderSlice = createSlice({
  name: 'commander',
  initialState,
  reducers: {
    toggleCommander(state) {
      if (!state.open) {
        state.open = true;
        state.minimized = false;
        return;
      }
      state.open = false;
      state.minimized = false;
    },
    setCommanderOpen(state, action: PayloadAction<boolean>) {
      state.open = action.payload;
      state.minimized = false;
    },
    minimizeCommander(state) {
      if (state.open) state.minimized = true;
    },
    setProviderId(state, action: PayloadAction<string | null>) {
      state.providerId = action.payload;
      try {
        if (action.payload) {
          localStorage.setItem(COMMANDER_PROVIDER_KEY, action.payload);
        } else {
          localStorage.removeItem(COMMANDER_PROVIDER_KEY);
        }
      } catch {
        // localStorage unavailable
      }
    },
    addUserMessage(state, action: PayloadAction<string>) {
      state.messages.push({
        id: createMessageId('user'),
        role: 'user',
        content: action.payload,
        timestamp: Date.now(),
      });
      state.error = null;
      state.open = true;
      state.minimized = false;
    },
    startStreaming(state) {
      state.streaming = true;
      state.currentStreamContent = '';
      state.currentToolCalls = [];
      state.currentSegments = [];
      state.error = null;
      state.open = true;
      state.minimized = false;
    },
    appendStreamChunk(state, action: PayloadAction<string>) {
      state.currentStreamContent += action.payload;
      // Append to last text segment or create new one
      const last = state.currentSegments[state.currentSegments.length - 1];
      if (last && last.type === 'text') {
        last.content += action.payload;
      } else {
        state.currentSegments.push({ type: 'text', content: action.payload });
      }
    },
    addToolCall(
      state,
      action: PayloadAction<{
        name: string;
        id: string;
        arguments: Record<string, unknown>;
        startedAt?: number;
      }>,
    ) {
      const tc: CommanderToolCall = {
        name: action.payload.name,
        id: action.payload.id,
        arguments: action.payload.arguments,
        startedAt: action.payload.startedAt ?? Date.now(),
        status: 'pending',
      };
      state.currentToolCalls.push(tc);
      state.currentSegments.push({ type: 'tool', toolCall: tc });
    },
    resolveToolCall(
      state,
      action: PayloadAction<{
        id: string;
        result?: unknown;
        error?: string;
        completedAt?: number;
      }>,
    ) {
      const toolCall = state.currentToolCalls.find((entry) => entry.id === action.payload.id);
      if (!toolCall) {
        return;
      }
      toolCall.result = action.payload.error ?? action.payload.result;
      toolCall.status = action.payload.error ? 'error' : 'done';
      toolCall.completedAt = action.payload.completedAt ?? Date.now();
      // Also update in segments
      const seg = state.currentSegments.find(
        (s) => s.type === 'tool' && s.toolCall.id === action.payload.id,
      );
      if (seg && seg.type === 'tool') {
        seg.toolCall.result = toolCall.result;
        seg.toolCall.status = toolCall.status;
        seg.toolCall.completedAt = toolCall.completedAt;
      }
    },
    finishStreaming(state, action: PayloadAction<string | undefined>) {
      const content = state.currentStreamContent || action.payload || '';
      if (content || state.currentToolCalls.length > 0) {
        state.messages.push({
          id: createMessageId('assistant'),
          role: 'assistant',
          content,
          segments: state.currentSegments.length > 0 ? [...state.currentSegments] : undefined,
          toolCalls: state.currentToolCalls.length > 0 ? [...state.currentToolCalls] : undefined,
          timestamp: Date.now(),
        });
      }
      state.streaming = false;
      state.currentStreamContent = '';
      state.currentToolCalls = [];
      state.currentSegments = [];
    },
    streamError(state, action: PayloadAction<string>) {
      state.error = action.payload;
      state.streaming = false;
      state.currentStreamContent = '';
      state.currentToolCalls = [];
      state.currentSegments = [];
    },
    clearHistory(state) {
      state.messages = [];
      state.currentStreamContent = '';
      state.currentToolCalls = [];
      state.currentSegments = [];
      state.error = null;
      state.streaming = false;
    },
    setPosition(state, action: PayloadAction<{ x: number; y: number }>) {
      state.position = action.payload;
    },
    setSize(state, action: PayloadAction<{ width: number; height: number }>) {
      state.size = action.payload;
    },
    setPermissionMode(state, action: PayloadAction<PermissionMode>) {
      state.permissionMode = action.payload;
    },
    setPendingConfirmation(state, action: PayloadAction<PendingConfirmation>) {
      state.pendingConfirmation = action.payload;
    },
    clearPendingConfirmation(state) {
      state.pendingConfirmation = null;
    },
    setPendingQuestion(state, action: PayloadAction<PendingQuestion>) {
      state.pendingQuestion = action.payload;
    },
    clearPendingQuestion(state) {
      state.pendingQuestion = null;
    },
    enqueueMessage(state, action: PayloadAction<string>) {
      state.messageQueue.push(action.payload);
    },
    dequeueMessage(state) {
      state.messageQueue.shift();
    },
    removeQueuedMessage(state, action: PayloadAction<number>) {
      state.messageQueue.splice(action.payload, 1);
    },
    editQueuedMessage(state, action: PayloadAction<{ index: number; content: string }>) {
      state.messageQueue[action.payload.index] = action.payload.content;
    },
    clearQueue(state) {
      state.messageQueue = [];
    },
    restore(_state, action: PayloadAction<CommanderState>) {
      return {
        ...initialState,
        ...action.payload,
        permissionMode: action.payload.permissionMode ?? 'normal',
        pendingConfirmation: null,
        pendingQuestion: null,
        messageQueue: [],
      };
    },
  },
});

export const {
  toggleCommander,
  setCommanderOpen,
  minimizeCommander,
  setProviderId,
  addUserMessage,
  startStreaming,
  appendStreamChunk,
  addToolCall,
  resolveToolCall,
  finishStreaming,
  streamError,
  clearHistory,
  setPosition,
  setSize,
  setPermissionMode,
  setPendingConfirmation,
  clearPendingConfirmation,
  setPendingQuestion,
  clearPendingQuestion,
  enqueueMessage,
  dequeueMessage,
  removeQueuedMessage,
  editQueuedMessage,
  clearQueue,
} = commanderSlice.actions;
