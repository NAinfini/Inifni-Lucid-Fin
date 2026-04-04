import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

interface JobItem {
  id: string;
  status: string;
  provider?: string;
  type?: string;
  progress?: number;
  completedSteps?: number;
  totalSteps?: number;
  currentStep?: string;
  batchId?: string;
  error?: string;
}

export interface JobsState {
  items: JobItem[];
  activeCount: number;
}

export const jobsSlice = createSlice({
  name: 'jobs',
  initialState: { items: [], activeCount: 0 } as JobsState,
  reducers: {
    setJobs(state, action: PayloadAction<JobItem[]>) {
      state.items = action.payload;
    },
    updateJob(state, action: PayloadAction<Partial<JobItem> & { id: string }>) {
      const idx = state.items.findIndex((j) => j.id === action.payload.id);
      if (idx >= 0) Object.assign(state.items[idx], action.payload);
      else state.items.push(action.payload as JobItem);
    },
    setActiveCount(state, action: PayloadAction<number>) {
      state.activeCount = action.payload;
    },
    submitJob(_state, _action: PayloadAction<Record<string, unknown>>) {
      /* handled by ipc middleware */
    },
    cancelJob(_state, _action: PayloadAction<string>) {},
    pauseJob(_state, _action: PayloadAction<string>) {},
    resumeJob(_state, _action: PayloadAction<string>) {},
  },
});

export const { setJobs, updateJob, setActiveCount, submitJob, cancelJob, pauseJob, resumeJob } =
  jobsSlice.actions;
