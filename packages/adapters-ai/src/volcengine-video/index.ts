import fs from 'node:fs';
import path from 'node:path';
import type {
  AIProviderAdapter,
  AdapterConfigureOptions,
  AdapterType,
  Capability,
  CostEstimate,
  GenerationRequest,
  GenerationResult,
  SubscribeCallbacks,
} from '@lucid-fin/contracts';
import {
  ErrorCode,
  JobStatus,
  LucidError,
  resolveLastVideoConditioningImage,
  resolvePrimaryVideoConditioningImage,
} from '@lucid-fin/contracts';
import { validateProviderUrl } from '../url-policy.js';

interface VolcengineTask {
  id?: string;
  status?: string;
  content?: { video_url?: string };
  error?: { code?: string; message?: string };
}

export class VolcengineVideoAdapter implements AIProviderAdapter {
  readonly id = 'volcengine-video';
  readonly name = 'Volcengine Seedance';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 2;
  readonly conditioningCapabilities = { firstFrame: true, lastFrame: true } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: true,
  } as const;

  private apiKey = '';
  private baseUrl = 'https://ark.cn-beijing.volces.com/api/v3';
  private model = 'seedance-2.0';
  private pollIntervalMs = 5_000;
  private maxPollAttempts = 180;

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl);
      this.baseUrl = options.baseUrl.replace(/\/$/, '');
    }
    if (options?.model) this.model = options.model;
    if (typeof options?.pollIntervalMs === 'number') this.pollIntervalMs = options.pollIntervalMs;
    if (typeof options?.maxPollAttempts === 'number') {
      this.maxPollAttempts = options.maxPollAttempts;
    }
  }

  async validate(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/contents/generations/tasks`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return response.status !== 401 && response.status !== 403;
    } catch {
      return false;
    }
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    return this.run(request, {});
  }

  async subscribe(
    request: GenerationRequest,
    callbacks: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    return this.run(request, callbacks);
  }

  private async run(
    request: GenerationRequest,
    callbacks: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    const content: Record<string, unknown>[] = [{ type: 'text', text: request.prompt }];
    const first = resolvePrimaryVideoConditioningImage(request);
    const last = resolveLastVideoConditioningImage(request);
    if (first) {
      content.push({
        type: 'image_url',
        image_url: { url: toImageInput(first) },
        role: 'first_frame',
      });
    }
    if (last) {
      content.push({
        type: 'image_url',
        image_url: { url: toImageInput(last) },
        role: 'last_frame',
      });
    }

    const response = await fetch(`${this.baseUrl}/contents/generations/tasks`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        content,
        duration: request.duration ?? 5,
        resolution: resolutionTier(request),
        ratio: aspectRatio(request),
        generate_audio: request.audio === true,
        watermark: false,
        ...(request.seed != null ? { seed: request.seed } : {}),
      }),
    });
    const submitted = await parseResponse(response, this.name);
    if (!submitted.id) throw new Error('Volcengine returned no task id');

    callbacks.onQueueUpdate?.({ status: 'queued', jobId: submitted.id });
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      if (attempt > 0 && this.pollIntervalMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      }
      const task = await this.getTask(submitted.id);
      const status = task.status?.toLowerCase() ?? 'queued';
      if (status === 'succeeded') {
        const assetPath = task.content?.video_url;
        if (!assetPath) throw new Error('Volcengine completed without a video URL');
        callbacks.onProgress?.({
          type: 'progress',
          percentage: 100,
          currentStep: 'completed',
          jobId: submitted.id,
        });
        callbacks.onQueueUpdate?.({ status: 'completed', jobId: submitted.id });
        return {
          assetHash: '',
          assetPath,
          provider: this.id,
          metadata: { taskId: submitted.id, model: this.model },
        };
      }
      if (status === 'failed' || status === 'cancelled' || status === 'expired') {
        throw new Error(task.error?.message ?? `Volcengine video task ${submitted.id} ${status}`);
      }
      callbacks.onQueueUpdate?.({
        status: status === 'queued' ? 'queued' : 'processing',
        currentStep: status,
        jobId: submitted.id,
      });
    }
    throw new Error(`Volcengine video task ${submitted.id} timed out`);
  }

  estimateCost(_request: GenerationRequest): CostEstimate {
    return { provider: this.id, estimatedCost: 0, currency: 'USD', unit: 'provider pricing' };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const status = (await this.getTask(jobId)).status?.toLowerCase();
    if (status === 'queued') return JobStatus.Queued;
    if (status === 'running') return JobStatus.Running;
    if (status === 'succeeded') return JobStatus.Completed;
    if (status === 'failed' || status === 'cancelled' || status === 'expired') {
      return JobStatus.Failed;
    }
    return JobStatus.Running;
  }

  async cancel(jobId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/contents/generations/tasks/${jobId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Volcengine cancellation failed (${response.status})`);
    }
  }

  private async getTask(jobId: string): Promise<VolcengineTask> {
    const response = await fetch(`${this.baseUrl}/contents/generations/tasks/${jobId}`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    return parseResponse(response, this.name);
  }
}

async function parseResponse(response: Response, name: string): Promise<VolcengineTask> {
  const payload = (await response.json().catch(() => ({}))) as VolcengineTask;
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new LucidError(ErrorCode.AuthFailed, `${name} authentication failed`);
    }
    if (response.status === 429) {
      throw new LucidError(ErrorCode.RateLimited, `${name} rate limited`);
    }
    throw new LucidError(
      ErrorCode.ServiceUnavailable,
      payload.error?.message ?? `${name} request failed (${response.status})`,
    );
  }
  return payload;
}

function toImageInput(value: string): string {
  if (/^(https?:|data:)/i.test(value)) return value;
  if (!fs.existsSync(value)) throw new Error(`Video reference image is missing: ${value}`);
  const extension = path.extname(value).toLowerCase();
  const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(value).toString('base64')}`;
}

function resolutionTier(request: GenerationRequest): string {
  const longest = Math.max(request.width ?? 0, request.height ?? 0);
  if (longest >= 1920) return '1080p';
  if (longest > 0 && longest < 1000) return '480p';
  return '720p';
}

function aspectRatio(request: GenerationRequest): string {
  const width = request.width ?? 16;
  const height = request.height ?? 9;
  const ratio = width / height;
  if (ratio > 1.6) return '16:9';
  if (ratio < 0.7) return '9:16';
  if (ratio > 1.2) return '4:3';
  if (ratio < 0.85) return '3:4';
  return '1:1';
}
