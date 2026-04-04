import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
  detail?: string;
}

const MAX_ENTRIES = 500;

export interface LoggerState {
  entries: LogEntry[];
}

const initialState: LoggerState = { entries: [] };

export const loggerSlice = createSlice({
  name: 'logger',
  initialState,
  reducers: {
    addLog(state, action: PayloadAction<Omit<LogEntry, 'id' | 'timestamp'>>) {
      const entry: LogEntry = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        ...action.payload,
      };
      state.entries.push(entry);
      if (state.entries.length > MAX_ENTRIES) {
        state.entries = state.entries.slice(-MAX_ENTRIES);
      }
    },
    clearLogs(state) {
      state.entries = [];
    },
  },
});

export const { addLog, clearLogs } = loggerSlice.actions;
