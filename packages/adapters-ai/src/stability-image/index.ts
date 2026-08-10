import type {
  AIProviderAdapter,
  AdapterConfigureOptions,
  AdapterError,
  AdapterType,
  Capability,
  CostEstimate,
  GenerationRequest,
  GenerationResult,
  JobStatus,
  SubscribeCallbacks,
} from '@lucid-fin/contracts';
import { ErrorCode, JobStatus as JobStatusEnum, LucidError } from '@lucid-fin/contracts';
import { adapterErrorToLucidError, parseAdapterError } from '../error-utils.js';
import { validateProviderUrl } from '../url-policy.js';

const DEFAULT_BASE_URL = 'https://api.stability.ai/v2beta';

export class StabilityImageAdapter implements AIProviderAdapter {
  readonly id = 'stability-image';
  readonly name = 'Stability AI Stable Image Core';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image'];
  readonly maxConcurrent = 5;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: false,
  } as const;

  private apiKey = '';
  private baseUrl = DEFAULT_BASE_URL;

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      this.baseUrl = trimTrailingSlash(options.baseUrl);
    }
  }

  async validate(): Promise<boolean> {
    try {
      const origin = new URL(this.baseUrl).origin;
      const res = await fetch(`${origin}/v1/user/account`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  normalizeError(error: unknown, status?: number): AdapterError {
    return parseAdapterError({ provider: 'Stability AI', status, error });
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

  estimateCost(_req: GenerationRequest): CostEstimate {
    return { provider: this.id, estimatedCost: 0.03, currency: 'USD', unit: 'per image' };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    return JobStatusEnum.Completed;
  }

  async cancel(_jobId: string): Promise<void> {
    // Stable Image Core returns the completed image synchronously.
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    if (req.type !== 'image') {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        `Stability Image does not support ${req.type} generation`,
      );
    }
    callbacks?.onQueueUpdate?.({ status: 'processing', currentStep: 'submitting' });
    callbacks?.onProgress?.({ type: 'progress', percentage: 5, currentStep: 'submitting' });

    const outputFormat = outputFormatFor(req);
    const form = new FormData();
    form.append('prompt', req.prompt);
    form.append('aspect_ratio', aspectRatioFor(req));
    form.append('output_format', outputFormat);
    if (req.negativePrompt?.trim()) form.append('negative_prompt', req.negativePrompt.trim());
    if (req.seed != null) form.append('seed', String(req.seed));
    const stylePreset = stringParam(req, 'style_preset');
    if (stylePreset) form.append('style_preset', stylePreset);

    const res = await fetch(`${this.baseUrl}/stable-image/generate/core`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
      body: form,
    });
    if (!res.ok) throw await this.toRequestError(res);

    const data = asRecord(await res.json());
    const base64 = firstString(data['image']);
    if (!base64) throw new Error('Stability Image Core completed without image base64 data');
    const assetPath = base64.startsWith('data:')
      ? base64
      : `data:${mimeTypeFor(outputFormat)};base64,${base64}`;
    const result: GenerationResult = {
      assetHash: '',
      assetPath,
      provider: this.id,
      cost: this.estimateCost(req).estimatedCost,
      metadata: { endpoint: 'stable-image/generate/core', outputFormat },
    };
    callbacks?.onProgress?.({ type: 'progress', percentage: 100, currentStep: 'completed' });
    callbacks?.onQueueUpdate?.({ status: 'completed', currentStep: 'completed' });
    return result;
  }

  private async toRequestError(res: Response): Promise<LucidError> {
    const body = await res.json().catch(() => ({}));
    return adapterErrorToLucidError(this.normalizeError(body, res.status));
  }
}

function aspectRatioFor(req: GenerationRequest): string {
  const configured = stringParam(req, 'aspect_ratio');
  if (configured) return configured;
  const width = req.width ?? 1;
  const height = req.height ?? 1;
  const ratio = width / Math.max(1, height);
  const supported = [
    ['1:1', 1],
    ['16:9', 16 / 9],
    ['21:9', 21 / 9],
    ['2:3', 2 / 3],
    ['3:2', 3 / 2],
    ['4:5', 4 / 5],
    ['5:4', 5 / 4],
    ['9:16', 9 / 16],
    ['9:21', 9 / 21],
  ] as const;
  return supported.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best,
  )[0];
}

function outputFormatFor(req: GenerationRequest): 'jpeg' | 'png' | 'webp' {
  const configured = stringParam(req, 'output_format');
  return configured === 'jpeg' || configured === 'webp' ? configured : 'png';
}

function mimeTypeFor(outputFormat: 'jpeg' | 'png' | 'webp'): string {
  return outputFormat === 'jpeg' ? 'image/jpeg' : `image/${outputFormat}`;
}

function stringParam(req: GenerationRequest, key: string): string | undefined {
  const value = req.params?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}
