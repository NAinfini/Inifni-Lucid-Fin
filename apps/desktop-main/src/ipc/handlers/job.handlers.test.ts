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
    handlers = new Map();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('logs job queue control actions and emits progress/completion via events', async () => {
    const send = vi.fn();
    const eventHandlers = new Map<string, (...args: unknown[]) => void>();
    const queue = {
      submit: vi.fn(() => 'job-1'),
      cancel: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        eventHandlers.set(event, handler);
      }),
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
    const jobsList = vi.fn((args?: { status?: string }) => {
      if (args?.status === 'completed') return { rows: [completedJob], degradedCount: 0 };
      return { rows: [completedJob], degradedCount: 0 };
    });
    const db = {
      repos: {
        jobs: {
          list: jobsList,
        },
      },
    };

    registerJobHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      () =>
        ({
          isDestroyed: () => false,
          webContents: { send },
        }) as never,
      db as never,
      queue as never,
    );

    // Verify IPC handlers were registered
    const submit = handlers.get('job:submit');
    const cancel = handlers.get('job:cancel');
    const pause = handlers.get('job:pause');
    const resume = handlers.get('job:resume');

    // Execute IPC calls
    await expect(
      submit?.(
        {},
        {
          providerId: 'mock-provider',
          type: 'image',
          prompt: 'hero shot',
        },
      ),
    ).resolves.toEqual({ jobId: 'job-1' });
    await cancel?.({}, { jobId: 'job-1' });
    await pause?.({}, { jobId: 'job-1' });
    await resume?.({}, { jobId: 'job-1' });

    // Verify logging
    expect(logger.info).toHaveBeenCalledWith(
      'Job submitted',
      expect.objectContaining({
        category: 'job',
        jobId: 'job-1',
        providerId: 'mock-provider',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Job cancel requested',
      expect.objectContaining({ category: 'job', jobId: 'job-1' }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Job pause requested',
      expect.objectContaining({ category: 'job', jobId: 'job-1' }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Job resume requested',
      expect.objectContaining({ category: 'job', jobId: 'job-1' }),
    );

    // Verify event handlers were registered
    expect(eventHandlers.has('job:progress')).toBe(true);
    expect(eventHandlers.has('job:completed')).toBe(true);
    expect(eventHandlers.has('job:failed')).toBe(true);

    // Simulate progress event
    const progressHandler = eventHandlers.get('job:progress')!;
    progressHandler({ jobId: 'job-1', progress: 45, currentStep: 'rendering' });

    expect(send).toHaveBeenCalledWith(
      'job:progress',
      expect.objectContaining({
        jobId: 'job-1',
        progress: 45,
        currentStep: 'rendering',
      }),
    );

    // Simulate completion event
    const completedHandler = eventHandlers.get('job:completed')!;
    completedHandler({ id: 'job-2', status: 'completed' });

    expect(send).toHaveBeenCalledWith(
      'job:complete',
      expect.objectContaining({
        jobId: 'job-2',
        success: true,
        result: { assetHash: 'hash-1' },
      }),
    );

    // Verify completion dedup: calling again should NOT send another event
    completedHandler({ id: 'job-2', status: 'completed' });
    const completeCalls = send.mock.calls.filter((call: unknown[]) => call[0] === 'job:complete');
    expect(completeCalls).toHaveLength(1);
  });
});
