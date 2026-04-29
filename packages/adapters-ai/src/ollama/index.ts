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

export class OllamaAdapter implements AIProviderAdapter {
  readonly id = 'ollama-local';
  readonly name = 'Ollama (Local LLM)';
  readonly type: AdapterType = 'text';
  readonly capabilities: Capability[] = ['text-generation'];
  readonly maxConcurrent = 1;

  private baseUrl = 'http://127.0.0.1:11434';
  private model = 'llama3';

  configure(_apiKey: string, options?: Record<string, unknown>): void {
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string, { allowLocalhost: true });
      this.baseUrl = options.baseUrl as string;
    }
    if (options?.model) this.model = options.model as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/tags`, { timeoutMs: 5000 });
      return res.ok;
    } catch {
      /* network error — Ollama server unreachable, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const res = await fetchWithTimeout(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: (req.params?.model as string) ?? this.model,
        prompt: req.prompt,
        stream: false,
      }),
      timeoutMs: 120_000,
    });

    if (!res.ok) throw new LucidError(ErrorCode.ServiceUnavailable, `Ollama error: ${res.status}`);
    const data = (await res.json()) as { response: string };

    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { response: data.response, model: this.model },
    };
  }

  estimateCost(_req: GenerationRequest): CostEstimate {
    return { provider: this.id, estimatedCost: 0, currency: 'USD', unit: 'local' };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    return JobStatus.Completed;
  }

  async cancel(_jobId: string): Promise<void> {
    // Ollama doesn't support cancel for non-streaming
  }
}
