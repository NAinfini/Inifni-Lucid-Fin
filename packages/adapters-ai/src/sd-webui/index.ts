import type {
  AIProviderAdapter,
  AdapterType,
  Capability,
  GenerationRequest,
  GenerationResult,
  CostEstimate,
} from '@lucid-fin/contracts';
import { LucidError, ErrorCode, JobStatus } from '@lucid-fin/contracts';
import { fetchWithRetry as fetchWithTimeout } from '../fetch-utils.js';
import { validateProviderUrl } from '../url-policy.js';

export class SDWebUIAdapter implements AIProviderAdapter {
  readonly id = 'sd-webui-local';
  readonly name = 'Stable Diffusion WebUI (Local)';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image', 'image-to-image'];
  readonly maxConcurrent = 1;

  private baseUrl = 'http://127.0.0.1:7860';

  configure(_apiKey: string, options?: Record<string, unknown>): void {
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string, { allowLocalhost: true });
      this.baseUrl = options.baseUrl as string;
    }
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/sdapi/v1/sd-models`, { timeoutMs: 5000 });
      return res.ok;
    } catch {
      /* network error — SD WebUI server unreachable, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const body = {
      prompt: req.prompt,
      negative_prompt: req.negativePrompt ?? '',
      width: req.width ?? 512,
      height: req.height ?? 512,
      steps: (req.params?.steps as number) ?? 20,
      cfg_scale: (req.params?.cfgScale as number) ?? 7,
      seed: req.seed ?? -1,
      sampler_name: (req.params?.sampler as string) ?? 'Euler a',
    };

    const res = await fetchWithTimeout(`${this.baseUrl}/sdapi/v1/txt2img`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      timeoutMs: 120_000,
    });

    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `SD WebUI error: ${res.status}`);
    const data = (await res.json()) as { images: string[]; parameters: Record<string, unknown> };

    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { imageCount: data.images.length, parameters: data.parameters },
    };
  }

  estimateCost(_req: GenerationRequest): CostEstimate {
    return { provider: this.id, estimatedCost: 0, currency: 'USD', unit: 'local' };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    return JobStatus.Completed;
  }

  async cancel(_jobId: string): Promise<void> {
    const res = await fetchWithTimeout(`${this.baseUrl}/sdapi/v1/interrupt`, { method: 'POST' });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `SD WebUI cancel failed: ${res.status}`);
  }
}
