import fs from 'node:fs/promises';
import path from 'node:path';
import { File } from 'node:buffer';
import Replicate from 'replicate';
import type {
  AIProviderAdapter,
  AdapterType,
  AdapterConfigureOptions,
  Capability,
  GenerationRequest,
  GenerationResult,
  CostEstimate,
  SubscribeCallbacks,
} from '@lucid-fin/contracts';
import { JobStatus } from '@lucid-fin/contracts';
import { getPrediction, cancelPrediction, toJobStatus } from '../replicate/client.js';
import { toSeedanceInput } from './mapper.js';

const DEFAULT_MODEL = 'bytedance/seedance-2.0';
const MAX_GENERATION_WAIT_MS = 15 * 60 * 1_000;

export class SeedanceAdapter implements AIProviderAdapter {
  readonly id = 'seedance-2';
  readonly name = 'Seedance 2';
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

  private apiKey = '';
  private model = DEFAULT_MODEL;

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    if (options?.model) this.model = normalizeModel(String(options.model));
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch('https://api.replicate.com/v1/models', {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
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
    const input = await materializeLocalInputs(toSeedanceInput(req));
    const client = new Replicate({
      auth: this.apiKey,
      fileEncodingStrategy: 'upload',
      useFileOutput: false,
    });
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error('Seedance generation timed out')),
      MAX_GENERATION_WAIT_MS,
    );
    let predictionId: string | undefined;
    let predictionStatus: string | undefined;
    let output: object;
    try {
      output = await client.run(
        normalizeModel(this.model) as `${string}/${string}` | `${string}/${string}:${string}`,
        { input, wait: { mode: 'poll', interval: 1_000 }, signal: controller.signal },
        (prediction) => {
          predictionId = prediction.id;
          predictionStatus = prediction.status;
          callbacks?.onQueueUpdate?.({
            status: mapQueueStatus(prediction.status),
            jobId: prediction.id,
            currentStep: `Seedance ${prediction.status}`,
          });
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    const assetPath = extractOutputUrl(output);
    if (!assetPath) throw new Error('Seedance completed without a video output URL');

    return {
      assetHash: '',
      assetPath,
      provider: this.id,
      cost: this.estimateCost(req).estimatedCost,
      metadata: {
        predictionId,
        status: predictionStatus ?? 'succeeded',
        model: normalizeModel(this.model),
      },
    };
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    const resolution = String(toSeedanceInput(req).resolution ?? '720p').toLowerCase();
    const ratePerSecond =
      resolution === '4k' ? 1 : resolution === '1080p' ? 0.45 : resolution === '480p' ? 0.08 : 0.18;
    const billedDuration = req.duration === -1 ? 15 : (req.duration ?? 5);
    return {
      provider: this.id,
      estimatedCost: billedDuration * ratePerSecond,
      currency: 'USD',
      unit: 'per second of output video',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const prediction = await getPrediction(this.apiKey, jobId, this.name);
    return toJobStatus(prediction.status);
  }

  async cancel(jobId: string): Promise<void> {
    await cancelPrediction(this.apiKey, jobId);
  }
}

function normalizeModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed || trimmed === 'seedance-2' || trimmed === 'seedance-2.0') return DEFAULT_MODEL;
  return trimmed.endsWith(':latest') ? trimmed.slice(0, -':latest'.length) : trimmed;
}

async function materializeLocalInputs(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const output = { ...input };
  if (typeof output.image === 'string') output.image = await materializeFile(output.image);
  if (typeof output.last_frame_image === 'string') {
    output.last_frame_image = await materializeFile(output.last_frame_image);
  }
  if (Array.isArray(output.reference_images)) {
    output.reference_images = await Promise.all(
      output.reference_images.map((value) =>
        typeof value === 'string' ? materializeFile(value) : value,
      ),
    );
  }
  return output;
}

async function materializeFile(value: string): Promise<string | File> {
  if (/^(?:https?:|data:)/i.test(value)) return value;
  const bytes = await fs.readFile(value);
  return new File([bytes], path.basename(value), { type: imageMimeType(value) });
}

function imageMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.avif':
      return 'image/avif';
    default:
      return 'image/png';
  }
}

function extractOutputUrl(output: object): string | undefined {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    const first = output[0];
    return typeof first === 'string' ? first : undefined;
  }
  const record = output as Record<string, unknown>;
  return typeof record.url === 'string' ? record.url : undefined;
}

function mapQueueStatus(
  status: string,
): 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled' {
  if (status === 'starting') return 'queued';
  if (status === 'processing') return 'processing';
  if (status === 'succeeded') return 'completed';
  if (status === 'canceled') return 'cancelled';
  return 'failed';
}
