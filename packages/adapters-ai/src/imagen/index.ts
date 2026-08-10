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
import { validateProviderUrl } from '../url-policy.js';

const SUPPORTED_ASPECT_RATIOS = [
  '1:1',
  '3:2',
  '2:3',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
] as const;

/** Gemini Interactions API image generation and editing adapter. */
export class GoogleImagen3Adapter implements AIProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image', 'image-to-image'];
  readonly maxConcurrent = 5;
  readonly credentialMode: 'api-key' | 'oauth';
  readonly oauthTarget?: OAuthProviderTarget;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 14, preservesOrder: true },
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
  private model = 'gemini-3.1-flash-image';
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
    this.id = options.id ?? 'google-imagen3';
    this.name = options.name ?? 'Google Gemini Image';
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
    const references = orderedUnique([req.sourceImagePath, ...(req.referenceImages ?? [])]);
    if (references.length > 14) {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        `Google Gemini Image supports at most 14 ordered reference images; received ${references.length}`,
      );
    }

    const input =
      references.length === 0
        ? req.prompt
        : [
            { type: 'text', text: req.prompt },
            ...references.map((reference) => toImageInput(reference)),
          ];
    const response = await fetchWithTimeout(`${this.baseUrl}/interactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.authHeaders()) },
      body: JSON.stringify({
        model: this.model,
        input,
        response_format: {
          type: 'image',
          mime_type: resolveOutputMimeType(req),
          aspect_ratio: resolveAspectRatio(req),
          image_size: resolveImageSize(req),
        },
      }),
      timeoutMs: 300_000,
    });

    if (!response.ok) throw await googleApiError(response, 'Gemini Image');
    const data = (await response.json()) as Record<string, unknown>;
    const output = extractMediaOutput(data, 'image');
    if (!output) {
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        'Google Gemini Image response did not include an output image',
      );
    }

    return {
      assetHash: '',
      assetPath: output.uri ?? `data:${output.mimeType ?? 'image/png'};base64,${output.data}`,
      provider: this.id,
      cost: this.estimateCost(req).estimatedCost,
      metadata: {
        interactionId: stringValue(data['id']),
        model: this.model,
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
    const size = resolveImageSize(req);
    return {
      provider: this.id,
      estimatedCost: size === '4K' ? 0.12 : size === '2K' ? 0.08 : 0.04,
      currency: 'USD',
      unit: 'per image estimate',
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

type MediaOutput = { data?: string; uri?: string; mimeType?: string };

export function extractMediaOutput(
  response: Record<string, unknown>,
  type: 'image' | 'video',
): MediaOutput | undefined {
  const direct = asRecord(response[`output_${type}`]);
  const directOutput = readOutput(direct);
  if (directOutput) return directOutput;

  const steps = Array.isArray(response['steps']) ? response['steps'] : [];
  const outputs: MediaOutput[] = [];
  for (const rawStep of steps) {
    const step = asRecord(rawStep);
    if (step?.['type'] !== 'model_output' || !Array.isArray(step['content'])) continue;
    for (const rawContent of step['content']) {
      const content = asRecord(rawContent);
      if (content?.['type'] !== type) continue;
      const output = readOutput(content);
      if (output) outputs.push(output);
    }
  }
  return outputs.at(-1);
}

function readOutput(value: Record<string, unknown> | undefined): MediaOutput | undefined {
  if (!value) return undefined;
  const data = stringValue(value['data']);
  const uri = stringValue(value['uri']);
  if (!data && !uri) return undefined;
  return {
    ...(data ? { data } : {}),
    ...(uri ? { uri } : {}),
    ...(stringValue(value['mime_type']) ? { mimeType: stringValue(value['mime_type']) } : {}),
  };
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

function imageMimeType(value: string): string {
  const extension = path.extname(new URL(value, 'file:///').pathname).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'image/png';
}

function resolveOutputMimeType(req: GenerationRequest): string {
  return req.params?.outputFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
}

function resolveImageSize(req: GenerationRequest): '1K' | '2K' | '4K' {
  const requested = stringValue(req.params?.imageSize)?.toUpperCase();
  if (requested === '1K' || requested === '2K' || requested === '4K') return requested;
  const maxDimension = Math.max(req.width ?? 1024, req.height ?? 1024);
  if (maxDimension >= 3000) return '4K';
  if (maxDimension >= 1500) return '2K';
  return '1K';
}

function resolveAspectRatio(req: GenerationRequest): string {
  const explicit = stringValue(req.params?.aspectRatio);
  if (
    explicit &&
    SUPPORTED_ASPECT_RATIOS.includes(explicit as (typeof SUPPORTED_ASPECT_RATIOS)[number])
  ) {
    return explicit;
  }
  const width = req.width ?? 1024;
  const height = req.height ?? 1024;
  return SUPPORTED_ASPECT_RATIOS.reduce((best, candidate) => {
    const [w, h] = candidate.split(':').map(Number);
    const [bestW, bestH] = best.split(':').map(Number);
    return Math.abs(w / h - width / height) < Math.abs(bestW / bestH - width / height)
      ? candidate
      : best;
  }, '1:1');
}

async function googleApiError(response: Response, label: string): Promise<LucidError> {
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const message =
    stringValue(asRecord(payload['error'])?.['message']) ?? `${label} error: ${response.status}`;
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
