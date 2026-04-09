import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerJobHandlers } from './job.handlers.js';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

describe('registerJobHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.useFakeTimers();
    handlers = new Map();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('logs job queue control actions and emits progress/completion only once per completed job', async () => {
    const send = vi.fn();
    const queue = {
      submit: vi.fn(() => 'job-1'),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    };
    const runningJob = {
      id: 'job-1',
      progress: 45,
      completedSteps: 2,
      totalSteps: 5,
      currentStep: 'rendering',
      provider: 'mock-provider',
      completedAt: undefined,
      result: undefined,
      error: undefined,
    };
    const completedJob = {
      id: 'job-2',
      progress: 100,
      completedSteps: 5,
      totalSteps: 5,
      currentStep: 'done',
      provider: 'mock-provider',
      completedAt: Date.now(),
      result: { assetHash: 'hash-1' },
      error: undefined,
    };
    const db = {
      listJobs: vi.fn((args?: { status?: string }) => {
        if (args?.status === 'running') return [runningJob];
        if (args?.status === 'completed') return [completedJob];
        if (args?.status === 'failed') return [];
        return [runningJob, completedJob];
      }),
    };

    registerJobHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      () => ({
        isDestroyed: () => false,
        webContents: { send },
      }) as never,
      db as never,
      queue as never,
    );

    const submit = handlers.get('job:submit');
    const cancel = handlers.get('job:cancel');
    const pause = handlers.get('job:pause');
    const resume = handlers.get('job:resume');

    await expect(
      submit?.({}, {
        projectId: 'project-1',
        providerId: 'mock-provider',
        type: 'image',
        prompt: 'hero shot',
      }),
    ).resolves.toEqual({ jobId: 'job-1' });
    await cancel?.({}, { jobId: 'job-1' });
    await pause?.({}, { jobId: 'job-1' });
    await resume?.({}, { jobId: 'job-1' });

    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(2000);

    expect(logger.info).toHaveBeenCalledWith(
      'Job submitted',
      expect.objectContaining({
        category: 'job',
        jobId: 'job-1',
        projectId: 'project-1',
        providerId: 'mock-provider',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Job cancel requested',
      expect.objectContaining({
        category: 'job',
        jobId: 'job-1',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Job pause requested',
      expect.objectContaining({
        category: 'job',
        jobId: 'job-1',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Job resume requested',
      expect.objectContaining({
        category: 'job',
        jobId: 'job-1',
      }),
    );
    expect(send).toHaveBeenCalledWith(
      'job:progress',
      expect.objectContaining({
        jobId: 'job-1',
        progress: 45,
        currentStep: 'rendering',
      }),
    );
    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenCalledWith(
      'job:complete',
      expect.objectContaining({
        jobId: 'job-2',
        success: true,
        result: { assetHash: 'hash-1' },
      }),
    );
  });
});
