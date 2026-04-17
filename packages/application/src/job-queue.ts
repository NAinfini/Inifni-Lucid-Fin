import { EventEmitter } from 'node:events';
import type {
  Job,
  GenerationRequest,
  GenerationResult,
  ProgressUpdate,
  QueueUpdate,
} from '@lucid-fin/contracts';
import { JobStatus, LucidError, ErrorCode } from '@lucid-fin/contracts';
import { parseJobId } from '@lucid-fin/contracts-parse';
import type { JobRepository } from '@lucid-fin/storage';
import type { AdapterRegistry } from '@lucid-fin/adapters-ai';

const VALID_TRANSITIONS: Record<string, string[]> = {
  [JobStatus.Queued]: [JobStatus.Running, JobStatus.Cancelled],
  [JobStatus.Running]: [
    JobStatus.Completed,
    JobStatus.Failed,
    JobStatus.Paused,
    JobStatus.Cancelled,
  ],
  [JobStatus.Failed]: [JobStatus.Queued, JobStatus.Dead],
  [JobStatus.Paused]: [JobStatus.Queued, JobStatus.Cancelled],
  [JobStatus.Completed]: [],
  [JobStatus.Cancelled]: [],
  [JobStatus.Dead]: [],
};

export class JobQueue extends EventEmitter {
  private running = new Map<string, AbortController>();
  private asyncPollTimer: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private tickQueued = false;

  constructor(
    private readonly db: JobRepository,
    private readonly registry: AdapterRegistry,
    private readonly maxConcurrent = 3,
  ) {
    super();
  }

  start(asyncPollIntervalMs = 5000): void {
    // Only poll for async provider job status (Runway, Kling, etc.)
    // Local job scheduling is event-driven via requestTick()
    this.asyncPollTimer = setInterval(() => void this.pollAsyncJobs(), asyncPollIntervalMs);
  }

  stop(): void {
    if (this.asyncPollTimer) {
      clearInterval(this.asyncPollTimer);
      this.asyncPollTimer = null;
    }
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** Schedule a tick on next microtask. Coalesces rapid-fire submits. */
  private requestTick(): void {
    if (this.tickQueued) return;
    this.tickQueued = true;
    queueMicrotask(() => {
      this.tickQueued = false;
      void this.tick();
    });
  }

  submit(request: GenerationRequest & { segmentId?: string }): string {
    const id = crypto.randomUUID();
    const job: Job = {
      id,
      segmentId: request.segmentId,
      type: request.type,
      provider: request.providerId,
      status: JobStatus.Queued,
      priority: 0,
      prompt: request.prompt,
      params: request.params,
      attempts: 0,
      maxRetries: 3,
      createdAt: Date.now(),
    };
    this.db.insert(job);
    this.emit('job:submitted', { id, status: 'queued' });
    this.requestTick();
    return id;
  }

  cancel(jobId: string): void {
    const job = this.getJobOrThrow(jobId);
    this.assertTransition(job.status, JobStatus.Cancelled);

    // Attempt to cancel at provider level
    const adapter = this.registry.get(job.provider);
    if (adapter && job.status === JobStatus.Running) {
      const providerTaskId = (job.result?.metadata?.taskId as string) ?? jobId;
      adapter.cancel(providerTaskId).catch((err) => {
        // Log cancellation failure — non-critical but useful for debugging
        void err;
      });
    }

    // Abort local tracking
    this.running.get(jobId)?.abort();
    this.running.delete(jobId);

    this.db.update(parseJobId(jobId), { status: JobStatus.Cancelled, completedAt: Date.now() });
    this.emit('job:cancelled', { id: jobId, status: 'cancelled' });
  }

  pause(jobId: string): void {
    const job = this.getJobOrThrow(jobId);
    this.assertTransition(job.status, JobStatus.Paused);

    // Abort in-flight execution and free concurrency slot
    this.running.get(jobId)?.abort();
    this.running.delete(jobId);

    this.db.update(parseJobId(jobId), { status: JobStatus.Paused });
    this.emit('job:paused', { id: jobId, status: 'paused' });
  }

  resume(jobId: string): void {
    const job = this.getJobOrThrow(jobId);
    this.assertTransition(job.status, JobStatus.Queued);
    this.db.update(parseJobId(jobId), { status: JobStatus.Queued });
    this.emit('job:resumed', { id: jobId, status: 'queued' });
    this.requestTick();
  }

  async recover(): Promise<void> {
    const runningJobs = this.db.list({ status: JobStatus.Running }).rows;

    for (const job of runningJobs) {
      // Skip jobs already tracked locally — they are actively executing
      if (this.running.has(job.id)) continue;

      const adapter = this.registry.get(job.provider);
      if (!adapter) {
        this.markFailedOrDead(job);
        continue;
      }

      try {
        // Query provider for actual status to avoid duplicate billing
        // Use provider's task ID if available, fall back to our job ID
        const providerTaskId = (job.result?.metadata?.taskId as string) ?? job.id;
        const providerStatus = await adapter.checkStatus(providerTaskId);

        if (providerStatus === JobStatus.Completed) {
          this.db.update(parseJobId(job.id), {
            status: JobStatus.Completed,
            progress: 100,
            totalSteps: job.totalSteps ?? 1,
            completedSteps: job.totalSteps ?? 1,
            currentStep: 'Completed',
            completedAt: Date.now(),
          });
        } else if (providerStatus === JobStatus.Failed) {
          this.markFailedOrDead(job);
        } else if (providerStatus === JobStatus.Cancelled) {
          this.db.update(parseJobId(job.id), {
            status: JobStatus.Cancelled,
            completedAt: Date.now(),
          });
        } else if (providerStatus === JobStatus.Running) {
          // Still running at provider — leave as running, tick() will poll
        } else {
          // Unknown state — re-queue if retries remain
          this.markFailedOrDead(job);
        }
      } catch { /* provider unreachable — re-queue if retries remain */
        // Provider unreachable — re-queue if retries remain
        this.markFailedOrDead(job);
      }
    }

    // Also recover queued jobs that were never started
    // (no action needed — tick() will pick them up)
  }

  private async tick(): Promise<void> {
    if (this.running.size >= this.maxConcurrent) return;

    const slots = this.maxConcurrent - this.running.size;
    const queued = this.db.list({ status: JobStatus.Queued }).rows;
    const toRun = queued.filter((j) => !this.running.has(j.id)).slice(0, slots);

    for (const job of toRun) {
      this.executeJob(job);
    }
  }

  private async pollAsyncJobs(): Promise<void> {
    const runningJobs = this.db.list({ status: JobStatus.Running }).rows;
    for (const job of runningJobs) {
      const taskId = job.result?.metadata?.taskId as string;
      if (!taskId) continue; // Not an async job

      const adapter = this.registry.get(job.provider);
      if (!adapter) continue;

      try {
        const status = await adapter.checkStatus(taskId);
        if (status === JobStatus.Completed) {
          this.db.update(parseJobId(job.id), {
            status: JobStatus.Completed,
            progress: 100,
            completedSteps: job.totalSteps ?? 1,
            totalSteps: job.totalSteps ?? 1,
            currentStep: 'Completed',
            completedAt: Date.now(),
          });
          this.running.delete(job.id);
          this.emit('job:completed', { id: job.id, status: 'completed' });
        } else if (status === JobStatus.Failed) {
          this.markFailedOrDead({ ...job, error: 'Provider reported failure' });
          this.running.delete(job.id);
          this.emit('job:failed', { id: job.id, status: 'failed' });
        } else if (status === JobStatus.Cancelled) {
          this.db.update(parseJobId(job.id), {
            status: JobStatus.Cancelled,
            completedAt: Date.now(),
          });
          this.running.delete(job.id);
          this.emit('job:cancelled', { id: job.id, status: 'cancelled' });
        }
        // If still running/queued, do nothing — next tick will poll again
      } catch { /* provider unreachable — leave as running, retry next tick */
        // Provider unreachable — leave as running, retry next tick
      }
    }
  }

  private async executeJob(job: Job): Promise<void> {
    const adapter = this.registry.get(job.provider);
    if (!adapter) {
      this.db.update(parseJobId(job.id), {
        status: JobStatus.Failed,
        error: `Adapter ${job.provider} not found`,
      });
      return;
    }

    this.assertTransition(job.status, JobStatus.Running);
    this.db.update(parseJobId(job.id), {
      status: JobStatus.Running,
      startedAt: Date.now(),
      attempts: job.attempts + 1,
      progress: 0,
      totalSteps: 1,
      completedSteps: 0,
      currentStep: 'Generating...',
    });

    const controller = new AbortController();
    this.running.set(job.id, controller);
    let keepInRunning = false;

    try {
      const request: GenerationRequest = {
        type: job.type,
        providerId: job.provider,
        prompt: job.prompt,
        params: job.params,
      };
      const result = adapter.subscribe
        ? await adapter.subscribe(request, {
            onQueueUpdate: (update) => {
              const current = this.db.get(parseJobId(job.id)) ?? job;
              this.db.update(parseJobId(job.id), buildQueueUpdatePatch(current, update));
            },
            onProgress: (update) => {
              const current = this.db.get(parseJobId(job.id)) ?? job;
              this.db.update(parseJobId(job.id), buildProgressUpdatePatch(current, update));
              const updated = this.db.get(parseJobId(job.id)) ?? current;
              this.emit('job:progress', {
                jobId: job.id,
                progress: Math.max(0, Math.min(100, Math.round(update.percentage))),
                completedSteps: updated.completedSteps,
                totalSteps: updated.totalSteps,
                currentStep: update.currentStep,
                message: update.currentStep ?? `Running on ${job.provider}`,
              });
            },
            onLog: (log) => {
              this.db.update(parseJobId(job.id), { currentStep: log });
            },
          })
        : await adapter.generate(request);

      if (controller.signal.aborted) return;

      // Async providers (e.g. Runway) return a taskId but no asset yet
      // Keep job as Running — tick() will poll via checkStatus
      const isAsync = !result.assetPath && result.metadata?.taskId;
      if (isAsync) {
        this.db.update(parseJobId(job.id), { result });
        keepInRunning = true;
        return;
      }

      this.db.update(parseJobId(job.id), {
        status: JobStatus.Completed,
        result: mergeGenerationResult(this.db.get(parseJobId(job.id))?.result, result),
        cost: result.cost,
        progress: 100,
        completedSteps: 1,
        totalSteps: 1,
        currentStep: 'Completed',
        completedAt: Date.now(),
      });
      this.emit('job:completed', { id: job.id, status: 'completed' });
      this.requestTick();
    } catch (err) {
      if (controller.signal.aborted) return;

      const message = err instanceof Error ? err.message : String(err);
      const updatedJob = this.db.get(parseJobId(job.id));
      if (updatedJob) {
        this.markFailedOrDead({ ...updatedJob, error: message });
      }
      this.emit('job:failed', { id: job.id, status: 'failed', error: message });
      this.requestTick();
    } finally {
      if (!keepInRunning) {
        this.running.delete(job.id);
      }
    }
  }

  private markFailedOrDead(job: Job): void {
    const currentAttempts = job.attempts;

    if (currentAttempts >= job.maxRetries) {
      this.db.update(parseJobId(job.id), {
        status: JobStatus.Dead,
        error: job.error ?? 'Max retries exceeded',
        completedAt: Date.now(),
      });
    } else {
      // Transition to Queued for auto-retry (attempts already incremented in executeJob)
      // SQLite ops are synchronous so no race between these two writes
      this.db.update(parseJobId(job.id), {
        status: JobStatus.Failed,
        error: job.error ?? 'Unknown failure',
        attempts: currentAttempts,
      });
      this.db.update(parseJobId(job.id), { status: JobStatus.Queued });
    }
  }

  private getJobOrThrow(jobId: string): Job {
    const job = this.db.get(parseJobId(jobId));
    if (!job) throw new LucidError(ErrorCode.NotFound, `Job ${jobId} not found`);
    return job;
  }

  private assertTransition(from: string, to: string): void {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw new LucidError(ErrorCode.InvalidRequest, `Invalid job transition: ${from} → ${to}`);
    }
  }
}

function buildQueueUpdatePatch(job: Job, update: QueueUpdate): Partial<Job> {
  const metadata = update.jobId ? { taskId: update.jobId } : undefined;
  const step =
    update.currentStep
    ?? (update.status === 'queued' && update.queuePosition != null
      ? `Queued (${update.queuePosition})`
      : capitalizeStatus(update.status));

  return {
    currentStep: step,
    progress: job.progress ?? (update.status === 'queued' ? 0 : undefined),
    result: metadata ? mergeGenerationResult(job.result, { assetHash: '', assetPath: '', provider: job.provider, metadata }) : job.result,
  };
}

function buildProgressUpdatePatch(job: Job, update: ProgressUpdate): Partial<Job> {
  const metadata = update.jobId ? { taskId: update.jobId } : undefined;
  return {
    progress: Math.max(0, Math.min(100, Math.round(update.percentage))),
    currentStep: update.currentStep ?? job.currentStep,
    result: metadata ? mergeGenerationResult(job.result, { assetHash: '', assetPath: '', provider: job.provider, metadata }) : job.result,
  };
}

function mergeGenerationResult(
  existing: GenerationResult | undefined,
  incoming: GenerationResult,
): GenerationResult {
  return {
    assetHash: incoming.assetHash || existing?.assetHash || '',
    assetPath: incoming.assetPath || existing?.assetPath || '',
    provider: incoming.provider || existing?.provider || '',
    ...(typeof incoming.cost === 'number' || typeof existing?.cost === 'number'
      ? { cost: incoming.cost ?? existing?.cost }
      : {}),
    metadata: {
      ...(existing?.metadata ?? {}),
      ...(incoming.metadata ?? {}),
    },
  };
}

function capitalizeStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
