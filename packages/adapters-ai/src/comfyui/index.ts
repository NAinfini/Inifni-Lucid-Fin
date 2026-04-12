import type {
  AIProviderAdapter,
  AdapterType,
  Capability,
  GenerationRequest,
  GenerationResult,
  CostEstimate,
} from '@lucid-fin/contracts';
import { LucidError, ErrorCode, JobStatus } from '@lucid-fin/contracts';
import { fetchWithTimeout } from '../fetch-utils.js';

export class ComfyUIAdapter implements AIProviderAdapter {
  readonly id = 'comfyui-local';
  readonly name = 'ComfyUI (Local)';
  readonly type: AdapterType = 'image';
  readonly capabilities: Capability[] = ['text-to-image', 'image-to-image'];
  readonly maxConcurrent = 1;

  private baseUrl = 'http://127.0.0.1:8188';
  private clientId = `lucid-${Date.now()}`;

  configure(_apiKey: string, options?: Record<string, unknown>): void {
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/system_stats`, { timeoutMs: 5000 });
      return res.ok;
    } catch { /* network error — ComfyUI server unreachable, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const workflow = buildComfyWorkflow(req);
    const res = await fetchWithTimeout(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
    });

    if (!res.ok) throw new LucidError(ErrorCode.ServiceUnavailable, `ComfyUI error: ${res.status}`);
    const data = (await res.json()) as { prompt_id: string };

    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { promptId: data.prompt_id },
    };
  }

  estimateCost(_req: GenerationRequest): CostEstimate {
    return { provider: this.id, estimatedCost: 0, currency: 'USD', unit: 'local' };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const res = await fetchWithTimeout(`${this.baseUrl}/history/${jobId}`);
    if (!res.ok) return JobStatus.Running;
    const data = (await res.json()) as Record<string, unknown>;
    return data[jobId] ? JobStatus.Completed : JobStatus.Running;
  }

  async cancel(_jobId: string): Promise<void> {
    const res = await fetchWithTimeout(`${this.baseUrl}/interrupt`, { method: 'POST' });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `ComfyUI cancel failed: ${res.status}`);
  }
}

function buildComfyWorkflow(req: GenerationRequest): Record<string, unknown> {
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: (req.params?.model as string) ?? 'sd_xl_base_1.0.safetensors' },
    },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: req.prompt, clip: ['1', 1] } },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: req.negativePrompt ?? '', clip: ['1', 1] },
    },
    '4': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        seed: req.seed ?? Math.floor(Math.random() * 2 ** 32),
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        latent_image: ['5', 0],
      },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: req.width ?? 1024, height: req.height ?? 1024, batch_size: 1 },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['4', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'lucid' } },
  };
}
