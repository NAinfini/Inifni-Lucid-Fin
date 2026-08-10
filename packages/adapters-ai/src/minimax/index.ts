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
import { adapterErrorToLucidError } from '../error-utils.js';
import { fetchWithRetry as fetchWithTimeout } from '../fetch-utils.js';
import {
  assertSupportedMiniMaxModel,
  DEFAULT_MINIMAX_MODEL,
  hasMiniMaxProviderError,
  miniMaxApiVersionForModel,
  parseError,
  parseMiniMaxFile,
  parseMiniMaxH3Status,
  parseMiniMaxResponse,
  parseMiniMaxStatus,
  toMiniMaxRequest,
  type MiniMaxApiVersion,
} from './mapper.js';
import { validateProviderUrl } from '../url-policy.js';

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 90;

type SubmittedMiniMaxTask = {
  taskId: string;
  model: string;
  apiVersion: MiniMaxApiVersion;
};

type MiniMaxTask = {
  status: string;
  fileId?: string;
  downloadUrl?: string;
  errorMessage?: string;
};

export class MiniMaxAdapter implements AIProviderAdapter {
  readonly id = 'minimax-video01';
  readonly name = 'MiniMax H3';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 2;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 9, preservesOrder: true },
    firstFrame: true,
    lastFrame: true,
  } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: false,
    webhook: false,
    cancellation: true,
  } as const;

  getPromptLimits(_request: GenerationRequest) {
    return { maxPromptChars: 7_000, negativePrompt: 'unsupported' as const };
  }

  private apiKey = '';
  private baseUrl = 'https://api.minimax.io/v1';
  private model = DEFAULT_MINIMAX_MODEL;
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  private maxPollAttempts = DEFAULT_MAX_POLL_ATTEMPTS;
  private readonly taskVersions = new Map<string, MiniMaxApiVersion>();

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    if (typeof options?.baseUrl === 'string') {
      validateProviderUrl(options.baseUrl);
      this.baseUrl = options.baseUrl;
    }
    if (typeof options?.model === 'string') {
      this.model = assertSupportedMiniMaxModel(options.model);
    }
    if (typeof options?.pollIntervalMs === 'number' && Number.isFinite(options.pollIntervalMs)) {
      this.pollIntervalMs = Math.max(0, Math.floor(options.pollIntervalMs));
    }
    if (typeof options?.maxPollAttempts === 'number' && Number.isFinite(options.maxPollAttempts)) {
      this.maxPollAttempts = Math.max(1, Math.floor(options.maxPollAttempts));
    }
  }

  async validate(): Promise<boolean> {
    const apiVersion = miniMaxApiVersionForModel(this.model);
    const path =
      apiVersion === 'v2' ? '/query/video_generation/validation-probe' : '/query/video_generation';
    try {
      const res = await fetchWithTimeout(this.apiUrl(apiVersion, path), {
        headers: { Authorization: 'Bearer ' + this.apiKey },
      });
      // This safe request is invalid without a real task but still distinguishes invalid credentials.
      return res.status !== 401 && res.status !== 403;
    } catch {
      /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  normalizeError(error: unknown, status?: number): AdapterError {
    return parseError(error, status);
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
    const apiVersion = miniMaxApiVersionForModel(this.model);
    const defaultDuration = apiVersion === 'v2' ? 5 : 6;
    const duration = req.duration ?? defaultDuration;
    const requestedResolution =
      typeof req.params?.['resolution'] === 'string'
        ? req.params['resolution'].trim().toUpperCase()
        : req.height === 768
          ? '768P'
          : '2K';
    const referenceImageCount = req.referenceImages?.length ?? 0;
    const estimatedCost =
      apiVersion === 'v2'
        ? duration * (requestedResolution === '768P' ? 0.08 : 0.13) +
          Math.max(0, referenceImageCount - 5) * 0.04
        : duration * 0.05;
    return {
      provider: this.id,
      estimatedCost,
      currency: 'USD',
      unit: apiVersion === 'v2' ? 'per second plus billable reference inputs' : 'per video',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const apiVersion = this.taskVersions.get(jobId) ?? miniMaxApiVersionForModel(this.model);
    const task = await this.queryTask(jobId, apiVersion);
    return mapMiniMaxStatus(task.status, apiVersion);
  }

  async cancel(jobId: string): Promise<void> {
    const apiVersion = this.taskVersions.get(jobId) ?? miniMaxApiVersionForModel(this.model);
    if (apiVersion === 'v1') return;

    const res = await fetchWithTimeout(
      this.apiUrl('v2', '/video_generation/' + encodeURIComponent(jobId)),
      {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + this.apiKey },
      },
    );
    const data = await responseJson(res);
    if (!res.ok || hasMiniMaxProviderError(data)) {
      this.throwProviderError(data, res.status);
    }
    this.taskVersions.delete(jobId);
  }

  private async run(
    req: GenerationRequest,
    callbacks?: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    const submitted = await this.submitTask(req);
    const taskId = submitted.taskId;

    callbacks?.onQueueUpdate?.({
      status: 'queued',
      currentStep: 'queued',
      jobId: taskId,
    });

    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const task = await this.queryTask(taskId, submitted.apiVersion);
      const status = mapMiniMaxStatus(task.status, submitted.apiVersion);

      if (status === JobStatusEnum.Queued) {
        callbacks?.onQueueUpdate?.({
          status: 'queued',
          currentStep: task.status,
          jobId: taskId,
        });
      } else if (status === JobStatusEnum.Running) {
        callbacks?.onQueueUpdate?.({
          status: 'processing',
          currentStep: task.status,
          jobId: taskId,
        });
      } else if (status === JobStatusEnum.Completed) {
        const downloadUrl =
          submitted.apiVersion === 'v2'
            ? task.downloadUrl
            : task.fileId
              ? await this.retrieveFile(task.fileId)
              : undefined;
        if (!downloadUrl) {
          throw new LucidError(
            ErrorCode.ServiceUnavailable,
            submitted.apiVersion === 'v2'
              ? 'MiniMax-H3 completed without returning content.url'
              : 'MiniMax completed without returning a file_id',
          );
        }

        callbacks?.onQueueUpdate?.({
          status: 'completed',
          currentStep: 'completed',
          jobId: taskId,
        });
        return {
          assetHash: '',
          assetPath: downloadUrl,
          provider: this.id,
          metadata: {
            taskId,
            status: task.status,
            model: submitted.model,
            apiVersion: submitted.apiVersion,
            ...(task.fileId ? { fileId: task.fileId } : {}),
            url: downloadUrl,
            download_url: downloadUrl,
          },
        };
      } else if (status === JobStatusEnum.Failed || status === JobStatusEnum.Cancelled) {
        callbacks?.onQueueUpdate?.({
          status: status === JobStatusEnum.Cancelled ? 'cancelled' : 'failed',
          currentStep: task.status,
          jobId: taskId,
        });
        throw new LucidError(
          status === JobStatusEnum.Cancelled ? ErrorCode.Cancelled : ErrorCode.ServiceUnavailable,
          task.errorMessage ??
            'MiniMax video generation ' +
              (status === JobStatusEnum.Cancelled ? 'was cancelled' : 'failed') +
              ' for task ' +
              taskId,
        );
      }

      if (attempt + 1 < this.maxPollAttempts) {
        await this.sleep(this.pollIntervalMs);
      }
    }

    throw new LucidError(
      ErrorCode.Timeout,
      'MiniMax task ' +
        taskId +
        ' did not complete after ' +
        this.maxPollAttempts +
        ' status checks',
    );
  }

  private async submitTask(req: GenerationRequest): Promise<SubmittedMiniMaxTask> {
    const body = toMiniMaxRequest(req, this.model);
    const model = typeof body['model'] === 'string' ? body['model'] : this.model;
    const apiVersion = miniMaxApiVersionForModel(model);
    const res = await fetchWithTimeout(this.apiUrl(apiVersion, '/video_generation'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + this.apiKey,
      },
      body: JSON.stringify(body),
    });
    const data = await responseJson(res);
    if (!res.ok || hasMiniMaxProviderError(data)) {
      this.throwProviderError(data, res.status);
    }

    const parsed = parseMiniMaxResponse(data);
    if (!parsed.taskId) {
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        parsed.errorMessage ?? 'MiniMax did not return a task_id',
      );
    }
    this.taskVersions.set(parsed.taskId, apiVersion);
    return { taskId: parsed.taskId, model, apiVersion };
  }

  private async queryTask(jobId: string, apiVersion: MiniMaxApiVersion): Promise<MiniMaxTask> {
    if (apiVersion === 'v2') {
      const res = await fetchWithTimeout(
        this.apiUrl('v2', '/query/video_generation/' + encodeURIComponent(jobId)),
        { headers: { Authorization: 'Bearer ' + this.apiKey } },
      );
      const data = await responseJson(res);
      if (!res.ok || hasMiniMaxProviderError(data)) {
        this.throwProviderError(data, res.status);
      }

      const parsed = parseMiniMaxH3Status(data);
      if (!parsed.status) {
        throw new LucidError(
          ErrorCode.ServiceUnavailable,
          parsed.errorMessage ?? 'MiniMax-H3 did not return a task status',
        );
      }
      return parsed;
    }

    const res = await fetchWithTimeout(
      this.apiUrl('v1', '/query/video_generation?task_id=' + encodeURIComponent(jobId)),
      { headers: { Authorization: 'Bearer ' + this.apiKey } },
    );
    const data = await responseJson(res);
    if (!res.ok || hasMiniMaxProviderError(data)) {
      this.throwProviderError(data, res.status);
    }

    const parsed = parseMiniMaxStatus(data);
    if (!parsed.status) {
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        parsed.errorMessage ?? 'MiniMax did not return a task status',
      );
    }
    return parsed;
  }

  private async retrieveFile(fileId: string): Promise<string> {
    const res = await fetchWithTimeout(
      this.apiUrl('v1', '/files/retrieve?file_id=' + encodeURIComponent(fileId)),
      { headers: { Authorization: 'Bearer ' + this.apiKey } },
    );
    const data = await responseJson(res);
    if (!res.ok || hasMiniMaxProviderError(data)) {
      this.throwProviderError(data, res.status);
    }

    const parsed = parseMiniMaxFile(data);
    if (!parsed.downloadUrl) {
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        parsed.errorMessage ?? 'MiniMax file retrieval did not return a download_url',
      );
    }
    return parsed.downloadUrl;
  }

  private apiUrl(apiVersion: MiniMaxApiVersion, path: string): string {
    return versionedBaseUrl(this.baseUrl, apiVersion) + path;
  }

  private throwProviderError(data: unknown, status?: number): never {
    throw adapterErrorToLucidError(this.normalizeError(data, status));
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function mapMiniMaxStatus(status: string, apiVersion: MiniMaxApiVersion): JobStatus {
  const statusMap: Record<string, JobStatus> =
    apiVersion === 'v2'
      ? {
          queued: JobStatusEnum.Queued,
          running: JobStatusEnum.Running,
          succeeded: JobStatusEnum.Completed,
          failed: JobStatusEnum.Failed,
          cancelled: JobStatusEnum.Cancelled,
        }
      : {
          Queueing: JobStatusEnum.Queued,
          Preparing: JobStatusEnum.Queued,
          Processing: JobStatusEnum.Running,
          Success: JobStatusEnum.Completed,
          Fail: JobStatusEnum.Failed,
        };
  return statusMap[status] ?? JobStatusEnum.Running;
}

function versionedBaseUrl(baseUrl: string, apiVersion: MiniMaxApiVersion): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (/\/v[12]$/i.test(normalized)) {
    return normalized.replace(/\/v[12]$/i, '/' + apiVersion);
  }
  return normalized + '/' + apiVersion;
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  const data = await response.json().catch(() => ({}));
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}
