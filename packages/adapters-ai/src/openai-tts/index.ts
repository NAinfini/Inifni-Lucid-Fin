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
import { toOpenAITTSRequest } from './mapper.js';

export class OpenAITTSAdapter implements AIProviderAdapter {
  readonly id = 'openai-tts-1-hd';
  readonly name = 'OpenAI TTS';
  readonly type: AdapterType = 'voice';
  readonly capabilities: Capability[] = ['text-to-voice'];
  readonly maxConcurrent = 5;

  private apiKey = '';
  private baseUrl = 'https://api.openai.com/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const body = toOpenAITTSRequest(req);

    const res = await fetchWithTimeout(`${this.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 401) throw new LucidError(ErrorCode.AuthFailed, 'Invalid OpenAI API key');
      if (res.status === 429)
        throw new LucidError(ErrorCode.RateLimited, 'OpenAI TTS rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `OpenAI TTS error: ${res.status}`);
    }

    // OpenAI TTS returns audio bytes directly (synchronous)
    const buffer = Buffer.from(await res.arrayBuffer());
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const outPath = (req.params?.savePath as string) ?? join(tmpdir(), `tts-openai-${hash}.mp3`);
    writeFileSync(outPath, buffer);

    return {
      assetHash: hash,
      assetPath: outPath,
      provider: this.id,
      metadata: { voice: body['voice'], contentType: 'audio/mpeg' },
    };
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    const charCount = req.prompt.length;
    return {
      provider: this.id,
      estimatedCost: (charCount / 1000) * 0.03,
      currency: 'USD',
      unit: 'per 1k characters',
    };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    return JobStatus.Completed;
  }

  async cancel(_jobId: string): Promise<void> {}
}
