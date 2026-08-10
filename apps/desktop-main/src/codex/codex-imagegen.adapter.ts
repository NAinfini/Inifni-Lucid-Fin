import type {
  AIProviderAdapter,
  AdapterType,
  Capability,
  CostEstimate,
  GenerationRequest,
  GenerationResult,
  JobStatus,
  SubscribeCallbacks,
} from '@lucid-fin/contracts';
import type { CodexRuntime } from './codex-runtime.js';

export class CodexImageGenAdapter implements AIProviderAdapter {
  readonly id = 'codex-imagegen';
  readonly name = 'ChatGPT Image Generation';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image', 'image-to-image'];
  readonly maxConcurrent = 1;
  readonly credentialMode = 'oauth' as const;
  readonly oauthTarget = { provider: 'chatgpt', capability: 'image' } as const;
  readonly conditioningCapabilities = {
    referenceImages: { maxImages: 4, preservesOrder: true },
  } as const;
  readonly executionCapabilities = {
    subscribe: true,
    queueUpdates: true,
    progressUpdates: true,
    webhook: false,
    cancellation: true,
  } as const;

  constructor(private readonly runtime: CodexRuntime) {}

  configure(_apiKey: string, _options?: Record<string, unknown>): void {}

  async validate(): Promise<boolean> {
    return this.runtime.getStatus().state === 'ready';
  }

  generate(request: GenerationRequest): Promise<GenerationResult> {
    return this.runtime.generateImage(request);
  }

  subscribe(request: GenerationRequest, callbacks: SubscribeCallbacks): Promise<GenerationResult> {
    return this.runtime.generateImage(request, callbacks);
  }

  estimateCost(_request: GenerationRequest): CostEstimate {
    return {
      provider: this.id,
      estimatedCost: 0,
      currency: 'USD',
      unit: 'ChatGPT subscription quota',
    };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    return this.runtime.isGenerationActive(jobId) ? 'running' : 'completed';
  }

  cancel(jobId: string): Promise<void> {
    return this.runtime.cancelGeneration(jobId);
  }
}
