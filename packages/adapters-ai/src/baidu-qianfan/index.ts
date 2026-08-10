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

type QianfanMediaType = 'image' | 'video';
type QianfanGenerationMode = 'text' | 'image';

type QianfanImageConfig = {
  baseUrl: string;
  textModel: string;
  editModel: string;
};

type QianfanVideoConfig = {
  baseUrl: string;
  textModel: string;
  imageModel: string;
};

type QianfanVideoJob = {
  taskId: string;
  baseUrl: string;
  model: string;
  mode: QianfanGenerationMode;
};

type QianfanTask = {
  taskId?: string;
  status?: string;
  statusMessage?: string;
  requestId?: string;
  videoUrl?: string;
};

type ImageSubmission = {
  mode: QianfanGenerationMode;
  model: string;
  endpoint: string;
  body: Record<string, unknown>;
};

type VideoSubmission = {
  mode: QianfanGenerationMode;
  model: string;
  body: Record<string, unknown>;
};

const DEFAULT_BASE_URL = 'https://qianfan.baidubce.com';
const DEFAULT_IMAGE_MODEL = 'qwen-image';
const DEFAULT_IMAGE_EDIT_MODEL = 'qwen-image-edit';
const DEFAULT_VIDEO_TEXT_MODEL = 'K3.0';
const DEFAULT_VIDEO_IMAGE_MODEL = 'VQ3-Turbo';
const VIDEO_TASK_PATH = '/beta/video/generations/qianfan-video';
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 180;
const TEXT_VIDEO_ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1']);
const IMAGE_VIDEO_RESOLUTIONS = new Set(['540p', '720p', '1080p']);
const IMAGE_EDIT_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/bmp',
  'image/x-icon',
]);
const IMAGE_VIDEO_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * Adapter for Qianfan's current V2 image APIs and beta qianfan-video APIs.
 * Image APIs return their final asset URL synchronously; video tasks are
 * submitted then polled through the documented task-status endpoint.
 */
export class BaiduQianfanAdapter implements AIProviderAdapter {
  readonly id = 'baidu-qianfan';
  readonly name = 'Baidu Qianfan';
  readonly type: AdapterType[] = ['image', 'video'];
  readonly capabilities: Capability[] = [
    'text-to-image',
    'image-to-image',
    'text-to-video',
    'image-to-video',
  ];
  readonly maxConcurrent = 2;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 1, preservesOrder: true },
    firstFrame: true,
  } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    // The current qianfan-video task API documents no compatible cancellation
    // endpoint. The older MuseSteamer cancellation API must not be applied to
    // qianfan-video task IDs.
    cancellation: false,
  } as const;

  private apiKey = '';
  private readonly imageConfig: QianfanImageConfig = {
    baseUrl: DEFAULT_BASE_URL,
    textModel: DEFAULT_IMAGE_MODEL,
    editModel: DEFAULT_IMAGE_EDIT_MODEL,
  };
  private readonly videoConfig: QianfanVideoConfig = {
    baseUrl: DEFAULT_BASE_URL,
    textModel: DEFAULT_VIDEO_TEXT_MODEL,
    imageModel: DEFAULT_VIDEO_IMAGE_MODEL,
  };
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  private maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS;
  private readonly jobs = new Map<string, QianfanVideoJob>();

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey.trim();
    const type: QianfanMediaType = options?.generationType === 'video' ? 'video' : 'image';
    if (type === 'image') {
      this.configureImage(options);
    } else {
      this.configureVideo(options);
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
      const response = await fetch(`${this.imageConfig.baseUrl}/v2/models`, {
        headers: this.authHeaders(),
      });
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

  estimateCost(req: GenerationRequest): CostEstimate {
    return {
      provider: this.id,
      estimatedCost: 0,
      currency: 'USD',
      unit:
        req.type === 'video'
          ? 'provider pricing varies by model and duration'
          : 'provider pricing varies by model and size',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    this.assertCredentials();
    const job =
      this.jobs.get(jobId) ??
      ({
        taskId: jobId,
        baseUrl: this.videoConfig.baseUrl,
        model: this.videoConfig.textModel,
        mode: 'text',
      } satisfies QianfanVideoJob);
    const task = await this.getVideoTask(job);
    return mapTaskStatus(task.status);
  }

  async cancel(_jobId: string): Promise<void> {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Baidu Qianfan does not document a cancellation endpoint for current qianfan-video or V2 image jobs',
    );
  }

  private configureImage(options: AdapterConfigureOptions | undefined): void {
    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      this.imageConfig.baseUrl = trimTrailingSlash(options.baseUrl);
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      const model = options.model.trim();
      if (configuredOperation(options) === 'image' || model.toLowerCase().includes('edit')) {
        this.imageConfig.editModel = model;
      } else {
        this.imageConfig.textModel = model;
      }
    }
  }

  private configureVideo(options: AdapterConfigureOptions | undefined): void {
    if (typeof options?.baseUrl === 'string' && options.baseUrl.trim()) {
      validateProviderUrl(options.baseUrl);
      this.videoConfig.baseUrl = trimTrailingSlash(options.baseUrl);
    }
    if (typeof options?.model === 'string' && options.model.trim()) {
      const model = options.model.trim();
      if (configuredOperation(options) === 'image' || /^vq/i.test(model)) {
        this.videoConfig.imageModel = model;
      } else {
        this.videoConfig.textModel = model;
      }
    }
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    this.assertCredentials();
    if (req.type === 'image') return this.runImage(req, callbacks);
    if (req.type === 'video') return this.runVideo(req, callbacks);
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `Baidu Qianfan does not support ${req.type} generation`,
    );
  }

  private async runImage(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    const submission = await buildImageSubmission(req, this.imageConfig);
    callbacks?.onQueueUpdate?.({ status: 'processing', currentStep: 'submitting' });
    callbacks?.onProgress?.({ type: 'progress', percentage: 10, currentStep: 'submitting' });
    const payload = await this.requestJson(`${this.imageConfig.baseUrl}${submission.endpoint}`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(submission.body),
    });
    const assetPath = extractImageUrl(payload);
    if (!assetPath) {
      throw this.invalidResponse('Baidu Qianfan image response did not include data[0].url');
    }
    callbacks?.onProgress?.({ type: 'progress', percentage: 100, currentStep: 'completed' });
    callbacks?.onQueueUpdate?.({ status: 'completed', currentStep: 'completed' });
    return {
      assetHash: '',
      assetPath,
      provider: this.id,
      cost: this.estimateCost(req).estimatedCost,
      metadata: {
        model: submission.model,
        mode: submission.mode,
        requestId: readString(payload, 'request_id', 'id'),
        status: 'succeeded',
      },
    };
  }

  private async runVideo(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    const submission = await buildVideoSubmission(req, this.videoConfig);
    callbacks?.onQueueUpdate?.({ status: 'processing', currentStep: 'submitting' });
    callbacks?.onProgress?.({ type: 'progress', percentage: 5, currentStep: 'submitting' });
    const payload = await this.requestJson(`${this.videoConfig.baseUrl}${VIDEO_TASK_PATH}`, {
      method: 'POST',
      headers: this.jsonHeaders(),
      body: JSON.stringify(submission.body),
    });
    const task = readTask(payload);
    if (!task.taskId) {
      throw this.invalidResponse('Baidu Qianfan video submission did not include task_id');
    }
    const job: QianfanVideoJob = {
      taskId: task.taskId,
      baseUrl: this.videoConfig.baseUrl,
      model: submission.model,
      mode: submission.mode,
    };
    this.jobs.set(job.taskId, job);
    callbacks?.onQueueUpdate?.({
      status: 'queued',
      currentStep: task.status ?? 'submitted',
      jobId: job.taskId,
    });

    if (mapTaskStatus(task.status) === JobStatusValue.Completed && task.videoUrl) {
      return this.completedVideoResult(task, job, req, callbacks);
    }
    if (mapTaskStatus(task.status) === JobStatusValue.Failed) {
      throw this.taskFailure(task, job.taskId);
    }
    return this.pollVideo(job, req, callbacks);
  }

  private async pollVideo(
    job: QianfanVideoJob,
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const task = await this.getVideoTask(job);
      const status = mapTaskStatus(task.status);
      if (status === JobStatusValue.Completed) {
        if (!task.videoUrl) {
          throw this.invalidResponse(
            'Baidu Qianfan video task succeeded without task_result.videos[0].url',
          );
        }
        return this.completedVideoResult(task, job, req, callbacks);
      }
      if (status === JobStatusValue.Failed || status === JobStatusValue.Cancelled) {
        throw this.taskFailure(task, job.taskId);
      }

      const currentStep = task.status ?? 'processing';
      callbacks?.onQueueUpdate?.({
        status: status === JobStatusValue.Queued ? 'queued' : 'processing',
        currentStep,
        jobId: job.taskId,
      });
      callbacks?.onProgress?.({
        type: 'progress',
        percentage: Math.min(95, 10 + attempt),
        currentStep,
        jobId: job.taskId,
      });
      if (attempt + 1 < this.maxPollAttempts) await sleep(this.pollIntervalMs);
    }

    throw new LucidError(
      ErrorCode.Timeout,
      `Baidu Qianfan video task ${job.taskId} did not finish after ${this.maxPollAttempts} polling attempts`,
    );
  }

  private completedVideoResult(
    task: QianfanTask,
    job: QianfanVideoJob,
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): GenerationResult {
    if (!task.videoUrl) {
      throw this.invalidResponse('Baidu Qianfan video task completed without a media URL');
    }
    callbacks?.onProgress?.({
      type: 'progress',
      percentage: 100,
      currentStep: 'completed',
      jobId: job.taskId,
    });
    callbacks?.onQueueUpdate?.({
      status: 'completed',
      currentStep: 'completed',
      jobId: job.taskId,
    });
    return {
      assetHash: '',
      assetPath: task.videoUrl,
      provider: this.id,
      cost: this.estimateCost(req).estimatedCost,
      metadata: {
        taskId: job.taskId,
        requestId: task.requestId,
        model: job.model,
        mode: job.mode,
        status: task.status ?? 'succeed',
      },
    };
  }

  private async getVideoTask(job: QianfanVideoJob): Promise<QianfanTask> {
    const query = new URLSearchParams({ task_id: job.taskId, model: job.model });
    const payload = await this.requestJson(`${job.baseUrl}${VIDEO_TASK_PATH}?${query.toString()}`, {
      headers: this.authHeaders(),
    });
    return readTask(payload);
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
      throw adapterErrorToLucidError(
        this.normalizeError(withProviderMessage(payload), response.status),
      );
    }
    if (!isRecord(payload)) {
      throw this.invalidResponse('Baidu Qianfan returned a non-object response');
    }
    if (isQianfanProviderError(payload)) {
      throw adapterErrorToLucidError(this.normalizeError(withProviderMessage(payload), 502));
    }
    return payload;
  }

  private taskFailure(task: QianfanTask, taskId: string): LucidError {
    const message = task.statusMessage ?? `Baidu Qianfan task ${taskId} ${task.status ?? 'failed'}`;
    if (mapTaskStatus(task.status) === JobStatusValue.Cancelled) {
      return new LucidError(ErrorCode.Cancelled, message);
    }
    return adapterErrorToLucidError(this.normalizeError({ message, code: 'task_failed' }, 502));
  }

  private invalidResponse(message: string): LucidError {
    return adapterErrorToLucidError(this.normalizeError({ message }, 502));
  }

  private assertCredentials(): void {
    if (!this.apiKey) {
      throw new LucidError(ErrorCode.InvalidRequest, 'Baidu Qianfan API key is required');
    }
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private jsonHeaders(): Record<string, string> {
    return { ...this.authHeaders(), 'Content-Type': 'application/json' };
  }
}

async function buildImageSubmission(
  req: GenerationRequest,
  config: QianfanImageConfig,
): Promise<ImageSubmission> {
  const source = resolveImageSource(req);
  const common = buildImageParameters(req);
  if (source) {
    return {
      mode: 'image',
      model: config.editModel,
      endpoint: '/v2/images/edits',
      body: {
        model: config.editModel,
        image: await materializeImage(source, IMAGE_EDIT_MIME_TYPES, 'image edit'),
        ...common,
      },
    };
  }
  return {
    mode: 'text',
    model: config.textModel,
    endpoint: '/v2/images/generations',
    body: { model: config.textModel, ...common },
  };
}

async function buildVideoSubmission(
  req: GenerationRequest,
  config: QianfanVideoConfig,
): Promise<VideoSubmission> {
  const source = resolveVideoSource(req);
  if (source) {
    return {
      mode: 'image',
      model: config.imageModel,
      body: {
        model: config.imageModel,
        type: 'img2video',
        model_parameters: {
          images: [await materializeImage(source, IMAGE_VIDEO_MIME_TYPES, 'image-to-video')],
          prompt: assertPrompt(req.prompt),
          ...(req.audio != null ? { audio: req.audio } : {}),
          ...(req.duration != null
            ? { duration: resolveImageVideoDuration(req.duration, config.imageModel) }
            : {}),
          ...(resolveImageVideoResolution(req)
            ? { resolution: resolveImageVideoResolution(req) }
            : {}),
          ...(req.seed != null ? { seed: assertSeed(req.seed) } : {}),
          ...(booleanParam(req, 'is_rec', 'isRec') != null
            ? { is_rec: booleanParam(req, 'is_rec', 'isRec') }
            : {}),
          ...(booleanParam(req, 'bgm') != null ? { bgm: booleanParam(req, 'bgm') } : {}),
        },
      },
    };
  }

  const duration = resolveTextVideoDuration(req.duration);
  return {
    mode: 'text',
    model: config.textModel,
    body: {
      model: config.textModel,
      type: 'text2video',
      model_parameters: {
        prompt: assertPrompt(req.prompt),
        ...(req.negativePrompt?.trim() ? { negative_prompt: req.negativePrompt.trim() } : {}),
        mode: resolveTextVideoMode(req),
        aspect_ratio: resolveTextVideoAspectRatio(req),
        duration: String(duration),
        sound: req.audio ? 'on' : 'off',
      },
    },
  };
}

function buildImageParameters(req: GenerationRequest): Record<string, unknown> {
  const size = resolveImageSize(req);
  const promptExtend = booleanParam(req, 'prompt_extend', 'promptExtend');
  const watermark = booleanParam(req, 'watermark');
  return {
    prompt: assertPrompt(req.prompt),
    ...(req.negativePrompt?.trim() ? { negative_prompt: req.negativePrompt.trim() } : {}),
    ...(size ? { size } : {}),
    ...(req.steps != null ? { steps: assertPositiveInteger(req.steps, 'steps') } : {}),
    ...(req.seed != null ? { seed: assertSeed(req.seed) } : {}),
    ...(req.cfgScale != null
      ? { guidance: assertNonNegativeNumber(req.cfgScale, 'guidance') }
      : {}),
    ...(promptExtend != null ? { prompt_extend: promptExtend } : {}),
    ...(watermark != null ? { watermark } : {}),
  };
}

function resolveImageSource(req: GenerationRequest): string | undefined {
  if (req.frameReferenceImages?.first || req.frameReferenceImages?.last) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Baidu Qianfan image editing accepts sourceImagePath or one generic reference image, not video frame constraints',
    );
  }
  return resolveSingleSource(req, 'Baidu Qianfan image editing');
}

function resolveVideoSource(req: GenerationRequest): string | undefined {
  if (req.frameReferenceImages?.last) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Baidu Qianfan qianfan-video image-to-video supports one first image and no last-frame input',
    );
  }
  const source = nonEmptyString(req.sourceImagePath);
  const firstFrame = nonEmptyString(req.frameReferenceImages?.first);
  const references = nonEmptyStrings(req.referenceImages);
  if (source && firstFrame) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Baidu Qianfan cannot combine sourceImagePath with an explicit first frame',
    );
  }
  if ((source || firstFrame) && references.length > 0) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Baidu Qianfan image-to-video accepts one source image and cannot combine it with generic references',
    );
  }
  if (references.length > 1) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Baidu Qianfan image-to-video supports one input image per request',
    );
  }
  return source ?? firstFrame ?? references[0];
}

function resolveSingleSource(req: GenerationRequest, label: string): string | undefined {
  const source = nonEmptyString(req.sourceImagePath);
  const references = nonEmptyStrings(req.referenceImages);
  if (source && references.length > 0) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `${label} cannot combine sourceImagePath with generic references`,
    );
  }
  if (references.length > 1) {
    throw new LucidError(ErrorCode.InvalidRequest, `${label} supports one input image per request`);
  }
  return source ?? references[0];
}

async function materializeImage(
  value: string,
  allowedMimeTypes: ReadonlySet<string>,
  operation: string,
): Promise<string> {
  if (/^https?:/i.test(value)) return value;
  if (/^data:/i.test(value)) {
    const match = /^data:(image\/[^;,]+);base64,[\s\S]+$/i.exec(value);
    const mimeType = match?.[1]?.toLowerCase();
    if (!mimeType || !allowedMimeTypes.has(normalizeMimeType(mimeType))) {
      throw new LucidError(
        ErrorCode.InvalidRequest,
        `Baidu Qianfan ${operation} requires an officially supported image data URI`,
      );
    }
    return value;
  }

  const mimeType = imageMimeType(value);
  if (!allowedMimeTypes.has(mimeType)) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `Baidu Qianfan ${operation} does not support ${path.extname(value) || 'this'} local image format`,
    );
  }
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(value);
  } catch (error) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `Baidu Qianfan source image could not be read: ${error instanceof Error ? error.message : value}`,
    );
  }
  return `data:${mimeType};base64,${bytes.toString('base64')}`;
}

function readTask(payload: Record<string, unknown>): QianfanTask {
  const data = asRecord(payload['data']);
  const taskResult = asRecord(data?.['task_result']) ?? asRecord(payload['task_result']);
  const videos = Array.isArray(taskResult?.['videos']) ? taskResult['videos'] : [];
  const firstVideo = asRecord(videos[0]);
  return {
    taskId: readString(data, 'task_id') ?? readString(payload, 'task_id'),
    status:
      readString(data, 'task_status', 'status') ?? readString(payload, 'task_status', 'status'),
    statusMessage:
      readString(data, 'task_status_msg', 'message') ??
      readString(payload, 'task_status_msg', 'message', 'error_msg'),
    requestId: readString(payload, 'request_id', 'log_id', 'id'),
    videoUrl:
      readString(firstVideo, 'url') ??
      readString(asRecord(data?.['content']), 'video_url') ??
      readString(asRecord(payload['content']), 'video_url'),
  };
}

function extractImageUrl(payload: Record<string, unknown>): string | undefined {
  const images = Array.isArray(payload['data']) ? payload['data'] : [];
  return readString(asRecord(images[0]), 'url');
}

function mapTaskStatus(status: string | undefined): JobStatus {
  switch (status?.toLowerCase()) {
    case 'submitted':
    case 'created':
    case 'queueing':
    case 'queued':
      return JobStatusValue.Queued;
    case 'processing':
    case 'running':
      return JobStatusValue.Running;
    case 'succeed':
    case 'success':
    case 'completed':
      return JobStatusValue.Completed;
    case 'cancelled':
    case 'canceled':
    case 'terminated':
      return JobStatusValue.Cancelled;
    case 'failed':
    case 'failure':
      return JobStatusValue.Failed;
    default:
      return JobStatusValue.Running;
  }
}

function isQianfanProviderError(payload: Record<string, unknown>): boolean {
  const code = payload['code'] ?? payload['error_code'];
  if (typeof code === 'number') return code !== 0;
  if (typeof code === 'string' && code.trim()) return code.trim() !== '0';
  return false;
}

function withProviderMessage(value: unknown): unknown {
  const payload = asRecord(value);
  if (!payload) return value;
  return {
    ...payload,
    message: readString(payload, 'message', 'error_msg', 'msg') ?? 'Baidu Qianfan request failed',
  };
}

function configuredOperation(
  options: AdapterConfigureOptions | undefined,
): QianfanGenerationMode | undefined {
  const value = options?.['operation'];
  if (value === 'image-to-image' || value === 'image-to-video') return 'image';
  if (value === 'text-to-image' || value === 'text-to-video') return 'text';
  return undefined;
}

function resolveImageSize(req: GenerationRequest): string | undefined {
  const explicit = stringParam(req, 'size');
  if (explicit) return assertImageSize(explicit);
  if (req.width == null && req.height == null) return undefined;
  if (req.width == null || req.height == null) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Baidu Qianfan image size requires both width and height',
    );
  }
  return assertImageSize(`${req.width}x${req.height}`);
}

function assertImageSize(value: string): string {
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(value.trim());
  if (!match) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Baidu Qianfan image size must use WIDTHxHEIGHT',
    );
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 512 || width > 2048 || height < 512 || height > 2048) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Baidu Qianfan image dimensions must be between 512 and 2048 pixels',
    );
  }
  return `${width}x${height}`;
}

function resolveTextVideoMode(req: GenerationRequest): string {
  const mode = (stringParam(req, 'mode', 'video_mode', 'videoMode') ?? 'std').toLowerCase();
  if (mode !== 'std' && mode !== 'pro') {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Baidu Qianfan text-to-video mode must be std or pro',
    );
  }
  return mode;
}

function resolveTextVideoAspectRatio(req: GenerationRequest): string {
  const ratio =
    stringParam(req, 'aspect_ratio', 'aspectRatio') ?? aspectRatioFromSize(req.width, req.height);
  if (!TEXT_VIDEO_ASPECT_RATIOS.has(ratio)) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Baidu Qianfan text-to-video aspect ratio must be 16:9, 9:16, or 1:1',
    );
  }
  return ratio;
}

function resolveTextVideoDuration(value: number | undefined): number {
  const duration = value ?? 5;
  if (!Number.isInteger(duration) || duration < 3 || duration > 15) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Baidu Qianfan text-to-video duration must be an integer from 3 to 15 seconds',
    );
  }
  return duration;
}

function resolveImageVideoDuration(value: number, model: string): number {
  const maximum = /^vq2/i.test(model) ? 10 : 16;
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `Baidu Qianfan ${model} image-to-video duration must be an integer from 1 to ${maximum} seconds`,
    );
  }
  return value;
}

function resolveImageVideoResolution(req: GenerationRequest): string | undefined {
  const resolution = (stringParam(req, 'resolution') ?? req.quality)?.toLowerCase();
  if (!resolution) return undefined;
  if (!IMAGE_VIDEO_RESOLUTIONS.has(resolution)) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Baidu Qianfan image-to-video resolution must be 540p, 720p, or 1080p',
    );
  }
  return resolution;
}

function assertPrompt(value: string): string {
  const prompt = value.trim();
  if (!prompt) throw new LucidError(ErrorCode.InvalidRequest, 'Baidu Qianfan prompt is required');
  return prompt;
}

function assertSeed(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 4_294_967_295) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      'Baidu Qianfan seed must be an integer from 0 to 4294967295',
    );
  }
  return value;
}

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      `Baidu Qianfan ${name} must be a positive integer`,
    );
  }
  return value;
}

function assertNonNegativeNumber(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new LucidError(ErrorCode.InvalidRequest, `Baidu Qianfan ${name} must be non-negative`);
  }
  return value;
}

function aspectRatioFromSize(width: number | undefined, height: number | undefined): string {
  if (!width || !height) return '16:9';
  const ratio = width / height;
  const candidates = [
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['1:1', 1],
  ] as const;
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best,
  )[0];
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

function trimTrailingSlash(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function normalizeMimeType(value: string): string {
  return value === 'image/jpg' ? 'image/jpeg' : value;
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
    case '.ico':
      return 'image/x-icon';
    default:
      return 'image/png';
  }
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise<void>((resolve) => setTimeout(resolve, ms));
}
