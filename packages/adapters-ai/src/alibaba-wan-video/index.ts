import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AdapterConfigureOptions,
  AdapterError,
  AdapterType,
  AIProviderAdapter,
  Capability,
  CostEstimate,
  GenerationRequest,
  GenerationResult,
  JobStatus,
  SubscribeCallbacks,
} from '@lucid-fin/contracts';
import { ErrorCode, JobStatus as JobStatusValue, LucidError } from '@lucid-fin/contracts';
import { adapterErrorToLucidError, parseAdapterError } from '../error-utils.js';
import { validateProviderUrl } from '../url-policy.js';

type WanMode = 'text' | 'image' | 'reference';

type WanTaskOutput = {
  task_id?: string;
  task_status?: string;
  video_url?: string;
  code?: string;
  message?: string;
};

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1';
const DEFAULT_TEXT_MODEL = 'wan2.7-t2v';
const DEFAULT_IMAGE_MODEL = 'wan2.7-i2v';
const DEFAULT_REFERENCE_MODEL = 'wan2.7-r2v';
const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 120;
const VALID_RESOLUTIONS = new Set(['720P', '1080P']);
const VALID_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);

/** Official Alibaba Cloud Model Studio Wan 2.7 asynchronous video API. */
export class AlibabaWanVideoAdapter implements AIProviderAdapter {
  readonly id = 'alibaba-wan-video';
  readonly name = 'Alibaba Wan 2.7';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 2;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 5, preservesOrder: true },
    firstFrame: true,
    lastFrame: true,
  } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: true,
  } as const;

  getPromptLimits(_request: GenerationRequest) {
    return {
      maxPromptChars: 5_000,
      maxNegativePromptChars: 500,
      negativePrompt: 'native' as const,
    };
  }

  private apiKey = '';
  private baseUrl = DEFAULT_BASE_URL;
  private readonly models: Record<WanMode, string> = {
    text: DEFAULT_TEXT_MODEL,
    image: DEFAULT_IMAGE_MODEL,
    reference: DEFAULT_REFERENCE_MODEL,
  };
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  private maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS;

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey.trim();
    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      this.baseUrl = normalizeBaseUrl(options.baseUrl);
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      const model = options.model.trim();
      const mode: WanMode = model.includes('r2v')
        ? 'reference'
        : model.includes('i2v')
          ? 'image'
          : 'text';
      this.models[mode] = model;
    }
    this.pollIntervalMs = boundedNumber(
      options?.['pollIntervalMs'],
      DEFAULT_POLL_INTERVAL_MS,
      0,
      60_000,
    );
    this.maxPollAttempts = boundedNumber(
      options?.['maxPollAttempts'],
      DEFAULT_MAX_POLL_ATTEMPTS,
      1,
      DEFAULT_MAX_POLL_ATTEMPTS,
    );
  }

  async validate(): Promise<boolean> {
    if (!this.apiKey) return false;
    try {
      const response = await fetch(`${this.baseUrl}/tasks/lucid-credential-probe`, {
        headers: this.authHeaders(),
      });
      // A nonexistent task normally produces 404. It still proves that the
      // configured key reached the official task endpoint.
      return response.status !== 401 && response.status !== 403;
    } catch {
      return false;
    }
  }

  normalizeError(error: unknown, status?: number): AdapterError {
    return parseAdapterError({ provider: this.name, status, error });
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
    return {
      provider: this.id,
      estimatedCost: 0,
      currency: 'USD',
      unit: 'provider pricing varies by Model Studio region and model',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const output = await this.getTask(jobId);
    return mapTaskStatus(output.task_status);
  }

  async cancel(jobId: string): Promise<void> {
    await this.requestJson(`${this.baseUrl}/tasks/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      headers: this.authHeaders(),
    });
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    if (req.type !== 'video') {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        `Alibaba Wan does not support ${req.type} generation`,
      );
    }
    if (!this.apiKey) {
      throw new LucidError(ErrorCode.InvalidRequest, 'Alibaba Model Studio API key is required');
    }

    const submission = await buildWanRequest(req, this.models);
    callbacks?.onQueueUpdate?.({ status: 'processing', currentStep: 'submitting' });
    callbacks?.onProgress?.({ type: 'progress', percentage: 5, currentStep: 'submitting' });
    const payload = await this.requestJson(
      `${this.baseUrl}/services/aigc/video-generation/video-synthesis`,
      {
        method: 'POST',
        headers: this.jsonHeaders(),
        body: JSON.stringify(submission.body),
      },
    );
    const output = asOutput(payload['output']);
    const taskId = output.task_id;
    if (!taskId)
      throw this.invalidResponse('Alibaba Wan submission did not include output.task_id');

    callbacks?.onQueueUpdate?.({ status: 'queued', currentStep: 'pending', jobId: taskId });
    return this.poll(taskId, submission.mode, submission.model, req, callbacks);
  }

  private async poll(
    taskId: string,
    mode: WanMode,
    model: string,
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const output = await this.getTask(taskId);
      const status = mapTaskStatus(output.task_status);
      if (status === JobStatusValue.Completed) {
        if (!output.video_url) {
          throw this.invalidResponse('Alibaba Wan task succeeded without output.video_url');
        }
        callbacks?.onProgress?.({
          type: 'progress',
          percentage: 100,
          currentStep: 'completed',
          jobId: taskId,
        });
        callbacks?.onQueueUpdate?.({
          status: 'completed',
          currentStep: 'completed',
          jobId: taskId,
        });
        return {
          assetHash: '',
          assetPath: output.video_url,
          provider: this.id,
          cost: this.estimateCost(req).estimatedCost,
          metadata: { taskId, status: output.task_status, model, mode },
        };
      }
      if (status === JobStatusValue.Failed || status === JobStatusValue.Cancelled) {
        throw this.taskFailure(output, taskId);
      }

      const currentStep = output.task_status?.toLowerCase() ?? 'pending';
      callbacks?.onQueueUpdate?.({
        status: status === JobStatusValue.Queued ? 'queued' : 'processing',
        currentStep,
        jobId: taskId,
      });
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: Math.min(95, 10 + attempt),
        currentStep,
        jobId: taskId,
      });
      if (attempt + 1 < this.maxPollAttempts) await sleep(this.pollIntervalMs);
    }

    throw new LucidError(
      ErrorCode.Timeout,
      `Alibaba Wan task ${taskId} did not finish after ${this.maxPollAttempts} polling attempts`,
    );
  }

  private async getTask(jobId: string): Promise<WanTaskOutput> {
    const payload = await this.requestJson(`${this.baseUrl}/tasks/${encodeURIComponent(jobId)}`, {
      headers: this.authHeaders(),
    });
    return asOutput(payload['output']);
  }

  private async requestJson(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw adapterErrorToLucidError(this.normalizeError(error));
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw adapterErrorToLucidError(this.normalizeError(payload, response.status));
    }
    if (!isRecord(payload))
      throw this.invalidResponse('Alibaba Wan returned a non-object response');
    if (typeof payload['code'] === 'string' && payload['code'].trim()) {
      throw adapterErrorToLucidError(this.normalizeError(payload, 502));
    }
    return payload;
  }

  private taskFailure(output: WanTaskOutput, taskId: string): LucidError {
    const message =
      output.message ?? `Alibaba Wan task ${taskId} ${output.task_status ?? 'failed'}`;
    if (output.task_status?.toUpperCase() === 'CANCELED') {
      return new LucidError(ErrorCode.Cancelled, message);
    }
    return adapterErrorToLucidError(
      this.normalizeError({ code: output.code ?? 'task_failed', message }, 502),
    );
  }

  private invalidResponse(message: string): LucidError {
    return adapterErrorToLucidError(this.normalizeError({ message }, 502));
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private jsonHeaders(): Record<string, string> {
    return {
      ...this.authHeaders(),
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    };
  }
}

async function buildWanRequest(
  req: GenerationRequest,
  models: Record<WanMode, string>,
): Promise<{ mode: WanMode; model: string; body: Record<string, unknown> }> {
  const conditioning = await resolveMedia(req);
  const { media, mode } = conditioning;
  const prompt = assertPrompt(req.prompt);
  const input: Record<string, unknown> = {
    prompt,
    ...(req.negativePrompt?.trim()
      ? { negative_prompt: assertNegativePrompt(req.negativePrompt) }
      : {}),
    ...(media.length > 0 ? { media } : {}),
  };
  const drivingAudio = stringParam(req, 'driving_audio_url', 'drivingAudioUrl');
  if (drivingAudio) {
    if (mode === 'reference') {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        'Alibaba Wan reference-to-video requires per-reference voice inputs, which GenerationRequest does not currently represent',
      );
    }
    if (mode === 'image') {
      (input['media'] as Array<Record<string, string>>).push({
        type: 'driving_audio',
        url: drivingAudio,
      });
    } else {
      input['audio_url'] = drivingAudio;
    }
  }

  const parameters: Record<string, unknown> = {
    resolution: resolveResolution(req),
    duration: resolveDuration(req),
    prompt_extend: booleanParam(req, 'prompt_extend', 'promptExtend') ?? true,
    watermark: booleanParam(req, 'watermark') ?? false,
  };
  // Wan 2.7 t2v accepts ratio. For i2v, Model Studio derives output ratio
  // from the first frame and does not list ratio among accepted parameters.
  if (mode !== 'image') parameters['ratio'] = resolveRatio(req);
  const seed = req.seed ?? numberParam(req, 'seed');
  if (seed != null) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 2_147_483_647) {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        'Alibaba Wan seed must be an integer from 0 to 2147483647',
      );
    }
    parameters['seed'] = seed;
  }
  const model = models[mode];
  return { mode, model, body: { model, input, parameters } };
}

async function resolveMedia(
  req: GenerationRequest,
): Promise<{ mode: WanMode; media: Array<Record<string, string>> }> {
  const source = nonEmptyString(req.sourceImagePath);
  const firstFrame = nonEmptyString(req.frameReferenceImages?.first);
  const lastFrame = nonEmptyString(req.frameReferenceImages?.last);
  const references = nonEmptyStrings(req.referenceImages);
  if (source && firstFrame) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Alibaba Wan cannot combine sourceImagePath with an explicit first frame',
    );
  }
  if (references.length > 5) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Alibaba Wan reference-to-video supports at most five ordered reference images',
    );
  }

  let first = source ?? firstFrame;
  if (lastFrame && references.length > 0) {
    if (first || references.length !== 1) {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        'Alibaba Wan reference-to-video cannot be combined with a last-frame constraint',
      );
    }
    // A single generic image plus an explicit last frame is unambiguously a
    // first/last-frame i2v request and preserves the legacy request shape.
    first = references[0];
  }
  if (lastFrame && !first) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Alibaba Wan requires a first frame when a last frame is provided',
    );
  }
  const media: Array<Record<string, string>> = [];
  if (first) media.push({ type: 'first_frame', url: await materializeImage(first) });
  if (lastFrame) {
    media.push({ type: 'last_frame', url: await materializeImage(lastFrame) });
    return { mode: 'image', media };
  }
  if (references.length > 0) {
    for (const reference of references) {
      media.push({ type: 'reference_image', url: await materializeImage(reference) });
    }
    return { mode: 'reference', media };
  }
  return { mode: first ? 'image' : 'text', media };
}

async function materializeImage(value: string): Promise<string> {
  if (/^(?:https?:|data:|oss:)/i.test(value)) return value;
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(value);
  } catch (error) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `Alibaba Wan source image could not be read: ${error instanceof Error ? error.message : value}`,
    );
  }
  return `data:${imageMimeType(value)};base64,${bytes.toString('base64')}`;
}

function mapTaskStatus(status: string | undefined): JobStatus {
  switch (status?.toUpperCase()) {
    case 'PENDING':
      return JobStatusValue.Queued;
    case 'RUNNING':
      return JobStatusValue.Running;
    case 'SUCCEEDED':
      return JobStatusValue.Completed;
    case 'CANCELED':
    case 'CANCELLED':
      return JobStatusValue.Cancelled;
    case 'FAILED':
    case 'UNKNOWN':
    default:
      return JobStatusValue.Failed;
  }
}

function asOutput(value: unknown): WanTaskOutput {
  const record = asRecord(value);
  return {
    task_id: readString(record, 'task_id'),
    task_status: readString(record, 'task_status'),
    video_url: readString(record, 'video_url'),
    code: readString(record, 'code'),
    message: readString(record, 'message'),
  };
}

function assertPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) throw new LucidError(ErrorCode.InvalidRequest, 'Alibaba Wan prompt is required');
  if (trimmed.length > 5_000) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Alibaba Wan prompt must not exceed 5000 characters',
    );
  }
  return trimmed;
}

function assertNegativePrompt(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 500) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Alibaba Wan negative_prompt must not exceed 500 characters',
    );
  }
  return trimmed;
}

function resolveResolution(req: GenerationRequest): string {
  const value = (stringParam(req, 'resolution') ?? req.quality ?? '1080P').toUpperCase();
  if (!VALID_RESOLUTIONS.has(value)) {
    throw new LucidError(ErrorCode.InvalidRequest, 'Alibaba Wan resolution must be 720P or 1080P');
  }
  return value;
}

function resolveDuration(req: GenerationRequest): number {
  const value = req.duration ?? numberParam(req, 'duration') ?? 5;
  if (!Number.isInteger(value) || value < 2 || value > 15) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Alibaba Wan duration must be an integer from 2 to 15 seconds',
    );
  }
  return value;
}

function resolveRatio(req: GenerationRequest): string {
  const value =
    stringParam(req, 'ratio', 'aspect_ratio', 'aspectRatio') ?? aspectRatio(req.width, req.height);
  if (!VALID_RATIOS.has(value)) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Alibaba Wan ratio must be one of 16:9, 9:16, 1:1, 4:3, or 3:4',
    );
  }
  return value;
}

function aspectRatio(width: number | undefined, height: number | undefined): string {
  if (!width || !height) return '16:9';
  const ratio = width / height;
  const candidates = [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['1:1', 1],
    ['4:3', 4 / 3],
    ['3:4', 3 / 4],
  ] as const;
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best,
  )[0];
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
}

function stringParam(req: GenerationRequest, ...keys: string[]): string | undefined {
  return readString(req.params, ...keys);
}

function booleanParam(req: GenerationRequest, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = req.params?.[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

function numberParam(req: GenerationRequest, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = req.params?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function nonEmptyStrings(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function readString(
  record: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function imageMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    default:
      return 'image/png';
  }
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
