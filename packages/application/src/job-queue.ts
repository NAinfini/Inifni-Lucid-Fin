import { randomUUID } from 'node:crypto';
import type {
  Job,
  GenerationRequest,
  GenerationResult,
  AIProviderAdapter,
  ProgressUpdate,
  QueueUpdate,
} from '@lucid-fin/contracts';
import { JobStatus, LucidError, ErrorCode } from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';
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

export class JobQueue {
  private running = new Map<string, AbortController>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly db: SqliteIndex,
    private readonly registry: AdapterRegistry,
    private readonly maxConcurrent = 3,
  ) {}

  start(intervalMs = 2000): void {
    this.tickTimer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  submit(request: GenerationRequest & { projectId: string; segmentId?: string }): string {
    const id = randomUUID();
    const job: Job = {
      id,
      projectId: request.projectId,
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
    this.db.insertJob(job);
    return id;
  }

  cancel(jobId: string): void {
    const job = this.getJobOrThrow(jobId);
    this.assertTransition(job.status, JobStatus.Cancelled);

    // Attempt to cancel at provider level
    const adapter = this.registry.get(job.provider);
    if (adapter && job.status === JobStatus.Running) {
      const providerTaskId = (job.result?.metadata?.taskId as string) ?? jobId;
      adapter.cancel(providerTaskId).catch(() => {});
    }

    // Abort local tracking
    this.running.get(jobId)?.abort();
    this.running.delete(jobId);

    this.db.updateJob(jobId, { status: JobStatus.Cancelled, completedAt: Date.now() });
  }

  pause(jobId: string): void {
    const job = this.getJobOrThrow(jobId);
    this.assertTransition(job.status, JobStatus.Paused);

    // Abort in-flight execution and free concurrency slot
    this.running.get(jobId)?.abort();
    this.running.delete(jobId);

    this.db.updateJob(jobId, { status: JobStatus.Paused });
  }

  resume(jobId: string): void {
    const job = this.getJobOrThrow(jobId);
    this.assertTransition(job.status, JobStatus.Queued);
    this.db.updateJob(jobId, { status: JobStatus.Queued });
  }

  async recover(): Promise<void> {
    const runningJobs = this.db.listJobs({ status: JobStatus.Running });

    for (const job of runningJobs) {
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
          this.db.updateJob(job.id, {
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
          this.db.updateJob(job.id, {
            status: JobStatus.Cancelled,
            completedAt: Date.now(),
          });
        } else if (providerStatus === JobStatus.Running) {
          // Still running at provider — leave as running, tick() will poll
        } else {
          // Unknown state — re-queue if retries remain
          this.markFailedOrDead(job);
        }
      } catch {
        // Provider unreachable — re-queue if retries remain
        this.markFailedOrDead(job);
      }
    }

    // Also recover queued jobs that were never started
    // (no action needed — tick() will pick them up)
  }

  private async tick(): Promise<void> {
    // Poll async running jobs for completion
    await this.pollAsyncJobs();

    if (this.running.size >= this.maxConcurrent) return;

    const slots = this.maxConcurrent - this.running.size;
    const queued = this.db.listJobs({ status: JobStatus.Queued });
    const toRun = queued.slice(0, slots);

    for (const job of toRun) {
      this.executeJob(job);
    }
  }

  private async pollAsyncJobs(): Promise<void> {
    const runningJobs = this.db.listJobs({ status: JobStatus.Running });
    for (const job of runningJobs) {
      const taskId = job.result?.metadata?.taskId as string;
      if (!taskId) continue; // Not an async job

      const adapter = this.registry.get(job.provider);
      if (!adapter) continue;

      try {
        const status = await adapter.checkStatus(taskId);
        if (status === JobStatus.Completed) {
          this.db.updateJob(job.id, {
            status: JobStatus.Completed,
            progress: 100,
            completedSteps: job.totalSteps ?? 1,
            totalSteps: job.totalSteps ?? 1,
            currentStep: 'Completed',
            completedAt: Date.now(),
          });
          this.running.delete(job.id);
        } else if (status === JobStatus.Failed) {
          this.markFailedOrDead({ ...job, error: 'Provider reported failure' });
          this.running.delete(job.id);
        } else if (status === JobStatus.Cancelled) {
          this.db.updateJob(job.id, {
            status: JobStatus.Cancelled,
            completedAt: Date.now(),
          });
          this.running.delete(job.id);
        }
        // If still running/queued, do nothing — next tick will poll again
      } catch {
        // Provider unreachable — leave as running, retry next tick
      }
    }
  }

  private async executeJob(job: Job): Promise<void> {
    const adapter = this.registry.get(job.provider);
    if (!adapter) {
      this.db.updateJob(job.id, {
        status: JobStatus.Failed,
        error: `Adapter ${job.provider} not found`,
      });
      return;
    }

    this.assertTransition(job.status, JobStatus.Running);
    this.db.updateJob(job.id, {
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
              const current = this.db.getJob(job.id) ?? job;
              this.db.updateJob(job.id, buildQueueUpdatePatch(current, update));
            },
            onProgress: (update) => {
              const current = this.db.getJob(job.id) ?? job;
              this.db.updateJob(job.id, buildProgressUpdatePatch(current, update));
            },
            onLog: (log) => {
              this.db.updateJob(job.id, { currentStep: log });
            },
          })
        : await adapter.generate(request);

      if (controller.signal.aborted) return;

      // Async providers (e.g. Runway) return a taskId but no asset yet
      // Keep job as Running — tick() will poll via checkStatus
      const isAsync = !result.assetPath && result.metadata?.taskId;
      if (isAsync) {
        this.db.updateJob(job.id, { result });
        keepInRunning = true;
        return;
      }

      this.db.updateJob(job.id, {
        status: JobStatus.Completed,
        result: mergeGenerationResult(this.db.getJob(job.id)?.result, result),
        cost: result.cost,
        progress: 100,
        completedSteps: 1,
        totalSteps: 1,
        currentStep: 'Completed',
        completedAt: Date.now(),
      });
    } catch (err) {
      if (controller.signal.aborted) return;

      const message = err instanceof Error ? err.message : String(err);
      const updatedJob = this.db.getJob(job.id);
      if (updatedJob) {
        this.markFailedOrDead({ ...updatedJob, error: message });
      }
    } finally {
      if (!keepInRunning) {
        this.running.delete(job.id);
      }
    }
  }

  private markFailedOrDead(job: Job): void {
    const currentAttempts = job.attempts;

    if (currentAttempts >= job.maxRetries) {
      this.db.updateJob(job.id, {
        status: JobStatus.Dead,
        error: job.error ?? 'Max retries exceeded',
        completedAt: Date.now(),
      });
    } else {
      // Transition to Queued for auto-retry (attempts already incremented in executeJob)
      // SQLite ops are synchronous so no race between these two writes
      this.db.updateJob(job.id, {
        status: JobStatus.Failed,
        error: job.error ?? 'Unknown failure',
        attempts: currentAttempts,
      });
      this.db.updateJob(job.id, { status: JobStatus.Queued });
    }
  }

  private getJobOrThrow(jobId: string): Job {
    const job = this.db.getJob(jobId);
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
