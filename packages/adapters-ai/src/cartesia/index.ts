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
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export class CartesiaSonicAdapter implements AIProviderAdapter {
  readonly id = 'cartesia-sonic';
  readonly name = 'Cartesia Sonic TTS';
  readonly type: AdapterType = 'voice';
  readonly capabilities: Capability[] = ['text-to-voice'];
  readonly maxConcurrent = 5;

  private apiKey = '';
  private baseUrl = 'https://api.cartesia.ai';
  private apiVersion = '2025-04-16';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
    if (options?.apiVersion) this.apiVersion = options.apiVersion as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/voices`, {
        headers: {
          'X-API-Key': this.apiKey,
          'Cartesia-Version': this.apiVersion,
        },
      });
      return res.ok;
    } catch { /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const voiceId = (req.params?.voiceId as string) ?? 'a0e99841-438c-4a64-b679-ae501e7d6091';
    const modelId = (req.params?.modelId as string) ?? 'sonic-2';

    const res = await fetchWithTimeout(`${this.baseUrl}/tts/bytes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
        'Cartesia-Version': this.apiVersion,
      },
      body: JSON.stringify({
        model_id: modelId,
        transcript: req.prompt,
        voice: { mode: 'id', id: voiceId },
        output_format: { container: 'mp3', sample_rate: 44100 },
      }),
      timeoutMs: 60_000,
    });

    if (!res.ok) {
      if (res.status === 401)
        throw new LucidError(ErrorCode.AuthFailed, 'Invalid Cartesia API key');
      if (res.status === 429)
        throw new LucidError(ErrorCode.RateLimited, 'Cartesia rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Cartesia error: ${res.status}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const outPath = join(tmpdir(), `tts-cartesia-${hash}.mp3`);
    writeFileSync(outPath, buffer);

    return {
      assetHash: hash,
      assetPath: outPath,
      provider: this.id,
      metadata: { voiceId, modelId, contentType: 'audio/mpeg' },
    };
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    const charCount = req.prompt.length;
    return {
      provider: this.id,
      estimatedCost: (charCount / 1000) * 0.15,
      currency: 'USD',
      unit: 'per 1k characters',
    };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    return JobStatus.Completed;
  }

  async cancel(_jobId: string): Promise<void> {
    // Synchronous API
  }
}
