import fs from 'node:fs';
import path from 'node:path';
import type {
  AIProviderAdapter,
  AdapterConfigureOptions,
  AdapterConditioningCapabilities,
  AdapterType,
  Capability,
  CostEstimate,
  GenerationRequest,
  GenerationResult,
  JobStatus,
} from '@lucid-fin/contracts';
import { ErrorCode, LucidError } from '@lucid-fin/contracts';
import { validateProviderUrl } from '../url-policy.js';

interface JsonImageSpec {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  endpoint: string;
  capabilities: Capability[];
  conditioningCapabilities?: AdapterConditioningCapabilities;
  buildBody: (request: GenerationRequest, model: string) => Promise<Record<string, unknown>>;
}

abstract class JsonImageAdapter implements AIProviderAdapter {
  readonly type: AdapterType = 'image';
  readonly maxConcurrent = 3;
  readonly executionCapabilities = {
    subscribe: false,
    queueUpdates: false,
    progressUpdates: false,
    webhook: false,
    cancellation: false,
  } as const;

  readonly id: string;
  readonly name: string;
  readonly capabilities: Capability[];
  readonly conditioningCapabilities?: AdapterConditioningCapabilities;

  protected apiKey = '';
  protected baseUrl: string;
  protected model: string;

  protected constructor(private readonly spec: JsonImageSpec) {
    this.id = spec.id;
    this.name = spec.name;
    this.baseUrl = spec.baseUrl;
    this.model = spec.model;
    this.capabilities = [...spec.capabilities];
    this.conditioningCapabilities = spec.conditioningCapabilities;
  }

  configure(apiKey: string, options?: AdapterConfigureOptions): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl);
      this.baseUrl = options.baseUrl.replace(/\/$/, '');
    }
    if (options?.model) this.model = options.model;
  }

  async validate(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return response.status !== 401 && response.status !== 403;
    } catch {
      return false;
    }
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const response = await fetch(`${this.baseUrl}${this.spec.endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(await this.spec.buildBody(request, this.model)),
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new LucidError(ErrorCode.AuthFailed, `${this.name} authentication failed`);
      }
      if (response.status === 429) {
        throw new LucidError(ErrorCode.RateLimited, `${this.name} rate limited`);
      }
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        `${this.name} image generation failed (${response.status}): ${message.slice(0, 300)}`,
      );
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const assetPath = extractImage(payload);
    if (!assetPath) {
      throw new LucidError(
        ErrorCode.ServiceUnavailable,
        `${this.name} returned no generated image`,
      );
    }

    return {
      assetHash: '',
      assetPath,
      provider: this.id,
      metadata: { model: this.model },
    };
  }

  estimateCost(_request: GenerationRequest): CostEstimate {
    return {
      provider: this.id,
      estimatedCost: 0,
      currency: 'USD',
      unit: 'provider pricing',
    };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    return 'completed' as JobStatus;
  }

  async cancel(_jobId: string): Promise<void> {}
}

export class StepFunImageAdapter extends JsonImageAdapter {
  constructor() {
    super({
      id: 'stepfun-image',
      name: 'StepFun Image',
      baseUrl: 'https://api.stepfun.com/v1',
      model: 'step-2x-large',
      endpoint: '/images/generations',
      capabilities: ['text-to-image'],
      buildBody: async (request, model) => ({
        model,
        prompt: request.prompt,
        n: 1,
        response_format: 'url',
        size: imageSize(request, '1024x1024'),
        ...(request.seed != null ? { seed: request.seed } : {}),
      }),
    });
  }
}

export class VolcengineImageAdapter extends JsonImageAdapter {
  constructor() {
    super({
      id: 'volcengine-image',
      name: 'Volcengine Seedream',
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      model: 'doubao-seedream-4-0-250828',
      endpoint: '/images/generations',
      capabilities: ['text-to-image', 'image-to-image'],
      conditioningCapabilities: {
        referenceImages: { maxImages: 4, preservesOrder: true },
      },
      buildBody: async (request, model) => {
        const images = await orderedImageInputs(request);
        return {
          model,
          prompt: request.prompt,
          ...(images.length === 1 ? { image: images[0] } : {}),
          ...(images.length > 1 ? { image: images } : {}),
          size: imageSize(request, '2K'),
          response_format: 'url',
          sequential_image_generation: 'disabled',
          stream: false,
          watermark: false,
          ...(request.seed != null ? { seed: request.seed } : {}),
        };
      },
    });
  }
}

export class AlibabaWanImageAdapter extends JsonImageAdapter {
  constructor() {
    super({
      id: 'alibaba-wan-image',
      name: 'Alibaba Wan Image',
      baseUrl: 'https://dashscope.aliyuncs.com/api/v1',
      model: 'wan2.7-image-pro',
      endpoint: '/services/aigc/multimodal-generation/generation',
      capabilities: ['text-to-image', 'image-to-image'],
      conditioningCapabilities: {
        referenceImages: { maxImages: 9, preservesOrder: true },
      },
      buildBody: async (request, model) => {
        const images = await orderedImageInputs(request);
        return {
          model,
          input: {
            messages: [
              {
                role: 'user',
                content: [...images.map((image) => ({ image })), { text: request.prompt }],
              },
            ],
          },
          parameters: {
            n: 1,
            size: imageSize(request, images.length > 0 ? '2K' : '2K'),
            watermark: false,
            ...(request.seed != null ? { seed: request.seed } : {}),
          },
        };
      },
    });
  }
}

function imageSize(request: GenerationRequest, fallback: string): string {
  return request.width && request.height ? `${request.width}x${request.height}` : fallback;
}

async function orderedImageInputs(request: GenerationRequest): Promise<string[]> {
  const inputs = [request.sourceImagePath, ...(request.referenceImages ?? [])];
  const unique = [...new Set(inputs.map((value) => value?.trim()).filter(Boolean) as string[])];
  return Promise.all(unique.map(toImageInput));
}

async function toImageInput(value: string): Promise<string> {
  if (value.startsWith('https://') || value.startsWith('http://') || value.startsWith('data:')) {
    return value;
  }
  if (!fs.existsSync(value)) throw new Error(`Reference image is missing: ${value}`);
  const extension = path.extname(value).toLowerCase();
  const mime =
    extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.webp'
        ? 'image/webp'
        : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(value).toString('base64')}`;
}

function extractImage(payload: Record<string, unknown>): string | undefined {
  const data = payload.data as Array<{ url?: string; b64_json?: string }> | undefined;
  if (data?.[0]?.url) return data[0].url;
  if (data?.[0]?.b64_json) return `data:image/png;base64,${data[0].b64_json}`;

  const images = payload.images as Array<{ url?: string }> | undefined;
  if (images?.[0]?.url) return images[0].url;

  const output = payload.output as
    | {
        choices?: Array<{
          message?: { content?: Array<{ image?: string; type?: string }> };
        }>;
      }
    | undefined;
  for (const choice of output?.choices ?? []) {
    const image = choice.message?.content?.find((entry) => entry.image)?.image;
    if (image) return image;
  }
  return undefined;
}
