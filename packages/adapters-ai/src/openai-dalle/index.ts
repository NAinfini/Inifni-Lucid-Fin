import fs from 'node:fs';
import path from 'node:path';
import type {
  AIProviderAdapter,
  AdapterError,
  AdapterType,
  Capability,
  CostEstimate,
  GenerationRequest,
  GenerationResult,
  JobStatus,
  SubscribeCallbacks,
} from '@lucid-fin/contracts';
import { adapterErrorToLucidError } from '../error-utils.js';
import { parseError, parseOpenAIResponse, toOpenAIRequest } from './mapper.js';
import { validateProviderUrl } from '../url-policy.js';

export class OpenAIDalleAdapter implements AIProviderAdapter {
  readonly id = 'openai-dalle';
  readonly name = 'OpenAI GPT Image';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image', 'image-to-image'];
  readonly maxConcurrent = 5;
  readonly conditioningCapabilities = {
    // Four inputs are deliberately conservative and match the current official
    // multi-reference Image API example. Callers fail before submission above
    // this application limit instead of silently discarding references.
    referenceImages: { maxImages: 4, preservesOrder: true },
  } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: false,
  } as const;

  private apiKey = '';
  private baseUrl = 'https://api.openai.com/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
    }
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  normalizeError(error: unknown, status?: number): AdapterError {
    return parseError(error, status);
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const body = toOpenAIRequest(req);
    const referenceImages = orderedUnique([req.sourceImagePath, ...(req.referenceImages ?? [])]);
    const res =
      referenceImages.length > 0
        ? await fetch(`${this.baseUrl}/images/edits`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.apiKey}` },
            body: buildEditForm(body, referenceImages),
          })
        : await fetch(`${this.baseUrl}/images/generations`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
          });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      throw adapterErrorToLucidError(this.normalizeError(err, res.status));
    }

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseOpenAIResponse(data);

    return {
      assetHash: '',
      assetPath: parsed.url,
      provider: this.id,
      cost: this.estimateCost(req).estimatedCost,
      metadata: { model: 'gpt-image-2', referenceImageCount: referenceImages.length },
    };
  }

  async subscribe(
    req: GenerationRequest,
    callbacks: SubscribeCallbacks,
  ): Promise<GenerationResult> {
    callbacks.onQueueUpdate?.({
      status: 'processing',
      currentStep: 'submitting',
    });
    callbacks.onProgress?.({
      type: 'progress',
      percentage: 5,
      currentStep: 'submitting',
    });

    const result = await this.generate(req);

    callbacks.onProgress?.({
      type: 'progress',
      percentage: 100,
      currentStep: 'completed',
    });
    callbacks.onQueueUpdate?.({
      status: 'completed',
      currentStep: 'completed',
    });

    return result;
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    const width = req.width ?? 1024;
    const height = req.height ?? 1024;
    const quality = normalizeEstimateQuality(req.quality);
    const size = `${width}x${height}`;
    const publishedOutputCost: Record<string, Record<'low' | 'medium' | 'high', number>> = {
      '1024x1024': { low: 0.006, medium: 0.053, high: 0.211 },
      '1024x1536': { low: 0.005, medium: 0.041, high: 0.165 },
      '1536x1024': { low: 0.005, medium: 0.041, high: 0.165 },
    };
    const squareOutputCost = publishedOutputCost['1024x1024'][quality];
    const pixelRatio = (width * height) / (1024 * 1024);
    const outputCost =
      publishedOutputCost[size]?.[quality] ??
      // GPT Image 2 accepts many resolutions. Scale the published square
      // price by pixels with a 25% reserve so approval budgets fail safely
      // when a requested size is not in OpenAI's fixed comparison table.
      squareOutputCost * Math.max(1, pixelRatio) * 1.25;
    const referenceCount = orderedUnique([
      req.sourceImagePath,
      req.sourceImageHash,
      ...(req.referenceImages ?? []),
    ]).length;
    // Edit requests also bill high-fidelity image inputs. The API does not
    // expose those tokens before submission, so reserve a conservative input
    // allowance per reference plus a small prompt allowance.
    const estimatedCost = outputCost + referenceCount * 0.1 + 0.005;
    return {
      provider: this.id,
      estimatedCost: Number(estimatedCost.toFixed(3)),
      currency: 'USD',
      unit: 'per image',
    };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    return 'completed' as JobStatus;
  }

  async cancel(_jobId: string): Promise<void> {}
}

function orderedUnique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function buildEditForm(body: Record<string, unknown>, referenceImages: string[]): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined && value !== null) form.append(key, String(value));
  }
  for (const imagePath of referenceImages) {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`OpenAI reference image is missing: ${imagePath}`);
    }
    const bytes = new Uint8Array(fs.readFileSync(imagePath));
    form.append(
      'image[]',
      new Blob([bytes], { type: imageMimeType(imagePath) }),
      path.basename(imagePath),
    );
  }
  return form;
}

function imageMimeType(imagePath: string): string {
  const extension = path.extname(imagePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'image/png';
}

function normalizeEstimateQuality(quality: string | undefined): 'low' | 'medium' | 'high' {
  return quality === 'low' || quality === 'medium' ? quality : 'high';
}
