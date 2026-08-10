import fs from 'node:fs';
import path from 'node:path';
import type {
  AIProviderAdapter,
  AdapterType,
  Capability,
  CostEstimate,
  GenerationRequest,
  GenerationResult,
  JobStatus,
  SubscribeCallbacks,
  OAuthProviderTarget,
} from '@lucid-fin/contracts';
import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import { fetchWithTimeout } from '../fetch-utils.js';
import { extractMediaOutput } from '../imagen/index.js';
import { validateProviderUrl } from '../url-policy.js';

/** Gemini Omni Flash video generation adapter using the Interactions API. */
export class VeoAdapter implements AIProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 2;
  readonly credentialMode: 'api-key' | 'oauth';
  readonly oauthTarget?: OAuthProviderTarget;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 4, preservesOrder: true, canCombineWithFrameImages: true },
    firstFrame: true,
  } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: false,
  } as const;

  private apiKey = '';
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  private model = 'gemini-omni-flash-preview';
  private readonly authorizationHeaders?: () => Promise<Record<string, string>>;

  constructor(
    options: {
      id?: string;
      name?: string;
      credentialMode?: 'api-key' | 'oauth';
      oauthTarget?: OAuthProviderTarget;
      authorizationHeaders?: () => Promise<Record<string, string>>;
    } = {},
  ) {
    this.id = options.id ?? 'google-veo-2';
    this.name = options.name ?? 'Google Gemini Omni Flash';
    this.credentialMode = options.credentialMode ?? 'api-key';
    this.oauthTarget = options.oauthTarget;
    this.authorizationHeaders = options.authorizationHeaders;
  }

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      this.model = options.model.trim();
    }
  }

  async validate(): Promise<boolean> {
    try {
      const response = await fetchWithTimeout(`${this.baseUrl}/models`, {
        headers: await this.authHeaders(),
        timeoutMs: 30_000,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    if (req.frameReferenceImages?.last) {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        'Gemini Omni Flash does not support first/last-frame interpolation',
      );
    }

    const references = orderedUnique([
      req.frameReferenceImages?.first,
      req.sourceImagePath,
      ...(req.referenceImages ?? []),
    ]);
    if (references.length > 4) {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        `Gemini Omni Flash supports at most 4 application-managed image references; received ${references.length}`,
      );
    }

    const prompt = req.negativePrompt ? `${req.prompt}\nAvoid: ${req.negativePrompt}` : req.prompt;
    const input =
      references.length === 0
        ? prompt
        : [
            ...references.map((reference) => toImageInput(reference)),
            { type: 'text', text: prompt },
          ];
    const task =
      references.length === 0
        ? 'text_to_video'
        : req.referenceImages?.length
          ? 'reference_to_video'
          : 'image_to_video';
    const response = await fetchWithTimeout(`${this.baseUrl}/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()) },
      body: JSON.stringify({
        model: this.model,
        input,
        response_format: { type: 'video', aspect_ratio: resolveAspectRatio(req) },
        generation_config: { video_config: { task } },
      }),
      // The endpoint is unary; keep it bounded while allowing generation time.
      timeoutMs: 600_000,
    });

    if (!response.ok) throw await googleApiError(response);
    const data = (await response.json()) as Record<string, unknown>;
    const output = extractMediaOutput(data, 'video');
    if (!output) {
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        'Google Gemini Omni Flash response did not include an output video',
      );
    }

    return {
      assetHash: '',
      assetPath: output.uri ?? `data:${output.mimeType ?? 'video/mp4'};base64,${output.data}`,
      provider: this.id,
      cost: this.estimateCost(req).estimatedCost,
      metadata: {
        interactionId: stringValue(data['id']),
        model: this.model,
        task,
        referenceImageCount: references.length,
      },
    };
  }

  async subscribe(
    req: GenerationRequest,
    callbacks: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    callbacks.onQueueUpdate?.({ status: 'processing', currentStep: 'generating' });
    callbacks.onProgress?.({ type: 'progress', percentage: 5, currentStep: 'generating' });
    const result = await this.generate(req);
    callbacks.onProgress?.({ type: 'progress', percentage: 100, currentStep: 'completed' });
    callbacks.onQueueUpdate?.({ status: 'completed', currentStep: 'completed' });
    return result;
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    return {
      provider: this.id,
      estimatedCost: (req.duration ?? 5) * 0.1,
      currency: 'USD',
      unit: 'per second of 720p video estimate',
    };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    return 'completed' as JobStatus;
  }

  async cancel(_jobId: string): Promise<void> {
    // The unary Interactions request cannot be cancelled after submission.
  }

  private authHeaders(): Promise<Record<string, string>> {
    if (this.authorizationHeaders) return this.authorizationHeaders();
    return Promise.resolve({ 'x-goog-api-key': this.apiKey });
  }
}

function toImageInput(reference: string): Record<string, string> {
  const dataUrl = reference.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (dataUrl) return { type: 'image', mime_type: dataUrl[1], data: dataUrl[2] };
  if (/^https?:\/\//i.test(reference)) {
    return { type: 'image', uri: reference, mime_type: imageMimeType(reference) };
  }
  if (!fs.existsSync(reference)) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `Google reference image is missing: ${reference}`,
    );
  }
  return {
    type: 'image',
    mime_type: imageMimeType(reference),
    data: fs.readFileSync(reference).toString('base64'),
  };
}

function resolveAspectRatio(req: GenerationRequest): '16:9' | '9:16' {
  const explicit = stringValue(req.params?.aspectRatio);
  if (explicit === '9:16') return explicit;
  if (explicit === '16:9') return explicit;
  return (req.height ?? 720) > (req.width ?? 1280) ? '9:16' : '16:9';
}

function imageMimeType(value: string): string {
  const extension = path.extname(new URL(value, 'file:///').pathname).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'image/png';
}

async function googleApiError(response: Response): Promise<LucidError> {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const error = asRecord(payload['error']);
  const message = stringValue(error?.['message']) ?? `Gemini Omni Flash error: ${response.status}`;
  const code =
    response.status === 401 || response.status === 403
      ? ErrorCode.AuthFailed
      : response.status === 429
        ? ErrorCode.RateLimited
        : ErrorCode.ServiceUnavailable;
  return new LucidError(code, message);
}

function orderedUnique(values: Array<string | undefined>): string[] {
  return [
    ...new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
    ),
  ];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
