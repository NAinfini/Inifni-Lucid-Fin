import { describe, expect, it } from 'vitest';
import {
  cancelJob,
  jobsSlice,
  pauseJob,
  resumeJob,
  setActiveCount,
  setJobs,
  submitJob,
  updateJob,
} from './jobs.js';

describe('jobs slice', () => {
  it('has the expected initial state', () => {
    expect(jobsSlice.reducer(undefined, { type: '@@INIT' })).toEqual({
      items: [],
      activeCount: 0,
    });
  });

  it('exports action creators with the expected payloads', () => {
    expect(setJobs([{ id: 'job-1', status: 'pending' }])).toMatchObject({
      type: 'jobs/setJobs',
      payload: [{ id: 'job-1', status: 'pending' }],
    });
    expect(updateJob({ id: 'job-1', status: 'running', progress: 50 })).toMatchObject({
      type: 'jobs/updateJob',
      payload: { id: 'job-1', status: 'running', progress: 50 },
    });
    expect(setActiveCount(2)).toMatchObject({
      type: 'jobs/setActiveCount',
      payload: 2,
    });
    expect(submitJob({ kind: 'image-generation' })).toMatchObject({
      type: 'jobs/submitJob',
      payload: { kind: 'image-generation' },
    });
    expect(cancelJob('job-1')).toMatchObject({
      type: 'jobs/cancelJob',
      payload: 'job-1',
    });
    expect(pauseJob('job-1')).toMatchObject({
      type: 'jobs/pauseJob',
      payload: 'job-1',
    });
    expect(resumeJob('job-1')).toMatchObject({
      type: 'jobs/resumeJob',
      payload: 'job-1',
    });
  });

  it('sets jobs, updates existing jobs, inserts missing jobs, and stores active count', () => {
    let state = jobsSlice.reducer(
      undefined,
      setJobs([
        { id: 'job-1', status: 'pending', provider: 'openai', progress: 0 },
        { id: 'job-2', status: 'running', provider: 'gemini', progress: 25 },
      ]),
    );

    state = jobsSlice.reducer(
      state,
      updateJob({ id: 'job-2', status: 'completed', progress: 100, error: undefined }),
    );
    state = jobsSlice.reducer(
      state,
      updateJob({ id: 'job-3', status: 'queued', batchId: 'batch-1', type: 'video' }),
    );
    state = jobsSlice.reducer(state, setActiveCount(3));

    expect(state.items).toEqual([
      expect.objectContaining({ id: 'job-1', status: 'pending', provider: 'openai' }),
      expect.objectContaining({ id: 'job-2', status: 'completed', progress: 100 }),
      expect.objectContaining({ id: 'job-3', status: 'queued', batchId: 'batch-1' }),
    ]);
    expect(state.activeCount).toBe(3);
  });

  it('keeps reducer state unchanged for middleware-only actions', () => {
    const state = jobsSlice.reducer(
      undefined,
      setJobs([{ id: 'job-1', status: 'pending', progress: 0 }]),
    );

    expect(jobsSlice.reducer(state, submitJob({ foo: 'bar' }))).toEqual(state);
    expect(jobsSlice.reducer(state, cancelJob('job-1'))).toEqual(state);
    expect(jobsSlice.reducer(state, pauseJob('job-1'))).toEqual(state);
    expect(jobsSlice.reducer(state, resumeJob('job-1'))).toEqual(state);
  });
});
