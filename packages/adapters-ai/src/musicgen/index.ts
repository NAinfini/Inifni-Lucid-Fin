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

export class MusicGenAdapter implements AIProviderAdapter {
  readonly id = 'musicgen-local';
  readonly name = 'MusicGen (Local)';
  readonly type: AdapterType = 'music';
  readonly capabilities: Capability[] = ['text-to-music'];
  readonly maxConcurrent = 1;

  private baseUrl = 'http://127.0.0.1:7861';

  configure(_apiKey: string, options?: Record<string, unknown>): void {
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/health`, { timeoutMs: 5000 });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: req.prompt,
        duration: req.duration ?? 10,
        model: (req.params?.model as string) ?? 'facebook/musicgen-medium',
      }),
      timeoutMs: 180_000,
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `MusicGen error: ${res.status}`);
    const data = (await res.json()) as { id: string; status: string };
    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { id: data.id, status: data.status },
    };
  }

  estimateCost(_req: GenerationRequest): CostEstimate {
    return { provider: this.id, estimatedCost: 0, currency: 'USD', unit: 'local' };
  }

  async checkStatus(jobId: string): Promise<JobStatus> {
    const res = await fetchWithTimeout(`${this.baseUrl}/api/status/${jobId}`);
    if (!res.ok) return JobStatus.Running;
    const data = (await res.json()) as { status: string };
    const map: Record<string, JobStatus> = {
      queued: JobStatus.Queued,
      processing: JobStatus.Running,
      complete: JobStatus.Completed,
      error: JobStatus.Failed,
    };
    return map[data.status] ?? JobStatus.Running;
  }

  async cancel(_jobId: string): Promise<void> {}
}
