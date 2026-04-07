import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { JobQueue } from '../src/job-queue.js';
import { JobStatus } from '@lucid-fin/contracts';
import type { Job, GenerationResult, AIProviderAdapter } from '@lucid-fin/contracts';
import { SqliteIndex } from '@lucid-fin/storage';
import { AdapterRegistry } from '@lucid-fin/adapters-ai';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-jq-'));
}

function mockAdapter(overrides?: Partial<AIProviderAdapter>): AIProviderAdapter {
  return {
    id: 'mock',
    name: 'Mock',
    type: 'image',
    capabilities: ['image'],
    configure: vi.fn(),
    validate: vi.fn().mockResolvedValue(true),
    generate: vi.fn().mockResolvedValue({
      assetHash: 'abc123',
      assetPath: '/tmp/abc.png',
      provider: 'mock',
      cost: 0.01,
    } satisfies GenerationResult),
    checkStatus: vi.fn().mockResolvedValue(JobStatus.Completed),
    cancel: vi.fn().mockResolvedValue(undefined),
    estimateCost: vi
      .fn()
      .mockResolvedValue({ provider: 'mock', estimatedCost: 0.01, currency: 'USD', unit: 'image' }),
    ...overrides,
  };
}

describe('JobQueue', () => {
  let db: SqliteIndex;
  let registry: AdapterRegistry;
  let queue: JobQueue;
  let base: string;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
    registry = new AdapterRegistry();
    registry.register(mockAdapter());
    queue = new JobQueue(db, registry, 3);
  });

  afterEach(() => {
    queue.stop();
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  describe('submit', () => {
    it('creates a queued job', () => {
      const id = queue.submit({
        projectId: 'p1',
        type: 'image',
        providerId: 'mock',
        prompt: 'a cat',
      });
      expect(id).toMatch(/^[\w-]{36}$/);
      const job = db.getJob(id);
      expect(job).toBeDefined();
      expect(job!.status).toBe(JobStatus.Queued);
      expect(job!.prompt).toBe('a cat');
    });

    it('stores provider from providerId', () => {
      const id = queue.submit({
        projectId: 'p1',
        type: 'image',
        providerId: 'mock',
        prompt: 'provider mapping',
      });
      const job = db.getJob(id);
      expect(job!.provider).toBe('mock');
    });
  });

  describe('cancel', () => {
    it('cancels a queued job', () => {
      const id = queue.submit({
        projectId: 'p1',
        type: 'image',
        providerId: 'mock',
        prompt: 'test',
      });
      queue.cancel(id);
      const job = db.getJob(id);
      expect(job!.status).toBe(JobStatus.Cancelled);
    });

    it('throws on invalid transition', () => {
      const id = queue.submit({
        projectId: 'p1',
        type: 'image',
        providerId: 'mock',
        prompt: 'test',
      });
      queue.cancel(id);
      expect(() => queue.cancel(id)).toThrow('Invalid job transition');
    });
  });

  describe('pause / resume', () => {
    it('pauses a running job and resumes it', () => {
      const id = queue.submit({
        projectId: 'p1',
        type: 'image',
        providerId: 'mock',
        prompt: 'test',
      });
      // Manually set to running to test pause
      db.updateJob(id, { status: JobStatus.Running, startedAt: Date.now() });

      queue.pause(id);
      expect(db.getJob(id)!.status).toBe(JobStatus.Paused);

      queue.resume(id);
      expect(db.getJob(id)!.status).toBe(JobStatus.Queued);
    });
  });

  describe('recover', () => {
    it('recovers completed jobs from provider', async () => {
      const id = queue.submit({
        projectId: 'p1',
        type: 'image',
        providerId: 'mock',
        prompt: 'test',
      });
      db.updateJob(id, { status: JobStatus.Running, startedAt: Date.now() });

      await queue.recover();
      const job = db.getJob(id);
      expect(job!.status).toBe(JobStatus.Completed);
    });

    it('marks jobs as dead when adapter not found', async () => {
      const id = queue.submit({
        projectId: 'p1',
        type: 'image',
        providerId: 'unknown',
        prompt: 'test',
      });
      db.updateJob(id, { status: JobStatus.Running, startedAt: Date.now(), attempts: 3 });

      await queue.recover();
      const job = db.getJob(id);
      expect(job!.status).toBe(JobStatus.Dead);
    });
  });

  describe('state machine transitions', () => {
    it('rejects invalid transitions', () => {
      const id = queue.submit({
        projectId: 'p1',
        type: 'image',
        providerId: 'mock',
        prompt: 'test',
      });
      // Queued → Paused is not valid
      expect(() => queue.pause(id)).toThrow('Invalid job transition');
    });
  });

  describe('subscribe support', () => {
    it('prefers adapter.subscribe and persists callback progress before completion', async () => {
      const id = queue.submit({
        projectId: 'p1',
        type: 'image',
        providerId: 'mock',
        prompt: 'subscribe flow',
      });

      const subscribe = vi.fn(async (_request, callbacks) => {
        callbacks.onQueueUpdate?.({
          status: 'queued',
          queuePosition: 2,
          estimatedWaitTime: 9,
          jobId: 'provider-job-1',
        });
        expect(db.getJob(id)?.currentStep).toContain('Queued');

        callbacks.onProgress?.({
          type: 'progress',
          percentage: 65,
          currentStep: 'rendering',
          jobId: 'provider-job-1',
        });
        expect(db.getJob(id)?.progress).toBe(65);
        expect(db.getJob(id)?.currentStep).toBe('rendering');

        return {
          assetHash: 'abc123',
          assetPath: '/tmp/abc.png',
          provider: 'mock',
          cost: 0.01,
          metadata: {
            taskId: 'provider-job-1',
          },
        } satisfies GenerationResult;
      });

      registry.unregister('mock');
      registry.register(
        mockAdapter({
          subscribe,
          generate: vi.fn(async () => {
            throw new Error('generate should not be called when subscribe exists');
          }),
        }),
      );

      await (queue as unknown as { tick(): Promise<void> }).tick();

      expect(subscribe).toHaveBeenCalledOnce();
      const job = db.getJob(id);
      expect(job).toEqual(
        expect.objectContaining({
          status: JobStatus.Completed,
          progress: 100,
          currentStep: 'Completed',
          result: expect.objectContaining({
            metadata: expect.objectContaining({
              taskId: 'provider-job-1',
            }),
          }),
        }),
      );
    });
  });
});
