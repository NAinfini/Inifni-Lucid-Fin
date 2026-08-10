import type {
  AIProviderAdapter,
  AdapterType,
  Capability,
  GenerationRequest,
  GenerationResult,
  CostEstimate,
  SubscribeCallbacks,
} from '@lucid-fin/contracts';
import {
  LucidError,
  ErrorCode,
  JobStatus,
  resolvePrimaryVideoConditioningImage,
} from '@lucid-fin/contracts';
import { fetchWithTimeout } from '../fetch-utils.js';
import { toKlingRequest, parseKlingResponse } from './mapper.js';
import { validateProviderUrl } from '../url-policy.js';

export class KlingAdapter implements AIProviderAdapter {
  readonly id = 'kling-v1';
  readonly name = 'Kling AI';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 2;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: true,
  } as const;

  private accessKeyId = '';
  private secretKey = '';
  private baseUrl = 'https://api.klingai.com/v1';
  private pollIntervalMs = 2_000;
  private maxPollAttempts = 180;

  configure(apiKey: string, options?: Record<string, unknown>): void {
    const [ak, sk] = apiKey.split(':');
    this.accessKeyId = ak ?? apiKey;
    this.secretKey = sk ?? '';
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
    }
    if (typeof options?.pollIntervalMs === 'number' && Number.isFinite(options.pollIntervalMs)) {
      this.pollIntervalMs = Math.max(0, Math.floor(options.pollIntervalMs));
    }
    if (typeof options?.maxPollAttempts === 'number' && Number.isFinite(options.maxPollAttempts)) {
      this.maxPollAttempts = Math.max(1, Math.floor(options.maxPollAttempts));
    }
  }

  private async authHeader(): Promise<string> {
    if (!this.secretKey) return `Bearer ${this.accessKeyId}`;
    const encoder = new TextEncoder();
    const now = Math.floor(Date.now() / 1000);
    const headerB64 = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const payloadB64 = btoa(
      JSON.stringify({ iss: this.accessKeyId, exp: now + 1800, nbf: now - 5 }),
    )
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const sigInput = `${headerB64}.${payloadB64}`;
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.secretKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(sigInput));
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    return `Bearer ${sigInput}.${sigB64}`;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/videos/text2video`, {
        method: 'GET',
        headers: { Authorization: await this.authHeader() },
      });
      return res.ok || res.status === 405;
    } catch {
      /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    return this.run(req);
  }

  async subscribe(
    req: GenerationRequest,
    callbacks: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    return this.run(req, callbacks);
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    const isImg2Vid = Boolean(resolvePrimaryVideoConditioningImage(req));
    const endpoint = isImg2Vid ? '/videos/image2video' : '/videos/text2video';
    const body = toKlingRequest(req);
    const auth = await this.authHeader();

    const res = await fetchWithTimeout(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 401) throw new LucidError(ErrorCode.AuthFailed, 'Invalid Kling API key');
      if (res.status === 429) throw new LucidError(ErrorCode.RateLimited, 'Kling rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Kling error: ${res.status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseKlingResponse(data);
    if (!parsed.taskId) {
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        'Kling response did not include a task ID',
      );
    }
    callbacks?.onQueueUpdate?.({
      status: 'queued',
      currentStep: parsed.status || 'submitted',
      jobId: parsed.taskId,
    });

    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const statusData = await this.fetchTask(endpoint, parsed.taskId);
      const current = parseKlingResponse(statusData);
      const status = mapKlingStatus(current.status);
      if (status === JobStatus.Completed) {
        const assetPath = extractKlingVideoUrl(statusData);
        if (!assetPath) {
          throw new LucidError(
            ErrorCode.ServiceUnavailable,
            'Kling completed without returning task_result.videos[0].url',
          );
        }
        callbacks?.onProgress?.({
          type: 'progress',
          percentage: 100,
          currentStep: 'completed',
          jobId: parsed.taskId,
        });
        callbacks?.onQueueUpdate?.({
          status: 'completed',
          currentStep: 'completed',
          jobId: parsed.taskId,
        });
        return {
          assetHash: '',
          assetPath,
          provider: this.id,
          cost: this.estimateCost(req).estimatedCost,
          metadata: { taskId: parsed.taskId, status: current.status, endpoint, url: assetPath },
        };
      }
      if (status === JobStatus.Failed || status === JobStatus.Cancelled) {
        throw new LucidError(
          status === JobStatus.Cancelled ? ErrorCode.Cancelled : ErrorCode.ServiceUnavailable,
          extractKlingFailure(statusData) ??
            `Kling task ${parsed.taskId} ${current.status || 'failed'}`,
        );
      }
      callbacks?.onQueueUpdate?.({
        status: status === JobStatus.Queued ? 'queued' : 'processing',
        currentStep: current.status || 'processing',
        jobId: parsed.taskId,
      });
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: Math.min(95, 5 + Math.round((attempt / this.maxPollAttempts) * 90)),
        currentStep: current.status || 'processing',
        jobId: parsed.taskId,
      });
      if (attempt + 1 < this.maxPollAttempts) await sleep(this.pollIntervalMs);
    }
    throw new LucidError(
      ErrorCode.Timeout,
      `Kling task ${parsed.taskId} did not finish after ${this.maxPollAttempts} checks`,
    );
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    return {
      provider: this.id,
      estimatedCost: (req.duration ?? 5) * 0.07,
      currency: 'USD',
      unit: 'per video',
    };
  }

  async checkStatus(jobId: string, metadata?: Record<string, unknown>): Promise<JobStatus> {
    const endpoint = String(metadata?.endpoint ?? '/videos/text2video');
    const data = await this.fetchTask(endpoint, jobId);
    return mapKlingStatus(parseKlingResponse(data).status);
  }

  async cancel(jobId: string): Promise<void> {
    const auth = await this.authHeader();
    const res = await fetchWithTimeout(`${this.baseUrl}/videos/text2video/${jobId}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `Kling cancel failed: ${res.status}`);
  }

  private async fetchTask(endpoint: string, jobId: string): Promise<Record<string, unknown>> {
    const auth = await this.authHeader();
    const res = await fetchWithTimeout(`${this.baseUrl}${endpoint}/${jobId}`, {
      headers: { Authorization: auth },
    });
    if (!res.ok) {
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        `Kling status check failed: ${res.status}`,
      );
    }
    return (await res.json()) as Record<string, unknown>;
  }
}

function mapKlingStatus(status: string): JobStatus {
  const normalized = status.trim().toLowerCase();
  if (['submitted', 'queued', 'pending'].includes(normalized)) return JobStatus.Queued;
  if (['succeed', 'succeeded', 'success', 'completed'].includes(normalized)) {
    return JobStatus.Completed;
  }
  if (['failed', 'error'].includes(normalized)) return JobStatus.Failed;
  if (['cancelled', 'canceled'].includes(normalized)) return JobStatus.Cancelled;
  return JobStatus.Running;
}

function extractKlingVideoUrl(data: Record<string, unknown>): string | undefined {
  const payload = asRecord(data['data']) ?? data;
  const taskResult = asRecord(payload['task_result']);
  const videos = Array.isArray(taskResult?.['videos']) ? taskResult['videos'] : [];
  const firstVideo = asRecord(videos[0]);
  return firstString(firstVideo?.['url'], payload['video_url'], payload['url']);
}

function extractKlingFailure(data: Record<string, unknown>): string | undefined {
  const payload = asRecord(data['data']) ?? data;
  return firstString(payload['task_status_msg'], payload['message'], data['message']);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
