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

export class PlayHTAdapter implements AIProviderAdapter {
  readonly id = 'playht-3';
  readonly name = 'PlayHT 3.0';
  readonly type: AdapterType = 'voice';
  readonly capabilities: Capability[] = ['text-to-voice'];
  readonly maxConcurrent = 5;

  private apiKey = '';
  private userId = '';
  private baseUrl = 'https://api.play.ht/api/v2';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.userId) this.userId = options.userId as string;
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/voices`, {
        headers: {
          AUTHORIZATION: this.apiKey,
          'X-USER-ID': this.userId,
        },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const voiceId = (req.params?.voiceId as string) ??
      's3://voice-cloning-zero-shot/775ae416-49bb-4fb6-bd45-740f205d20a1/original/manifest.json';

    const res = await fetchWithTimeout(`${this.baseUrl}/tts/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        AUTHORIZATION: this.apiKey,
        'X-USER-ID': this.userId,
      },
      body: JSON.stringify({
        text: req.prompt,
        voice: voiceId,
        output_format: 'mp3',
        voice_engine: 'Play3.0-mini',
      }),
      timeoutMs: 60_000,
    });

    if (!res.ok) {
      if (res.status === 401)
        throw new LucidError(ErrorCode.AuthFailed, 'Invalid PlayHT credentials');
      if (res.status === 429)
        throw new LucidError(ErrorCode.RateLimited, 'PlayHT rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `PlayHT error: ${res.status}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const outPath = join(tmpdir(), `tts-playht-${hash}.mp3`);
    writeFileSync(outPath, buffer);

    return {
      assetHash: hash,
      assetPath: outPath,
      provider: this.id,
      metadata: { voiceId, contentType: 'audio/mpeg' },
    };
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    const charCount = req.prompt.length;
    return {
      provider: this.id,
      estimatedCost: (charCount / 1000) * 0.1,
      currency: 'USD',
      unit: 'per 1k characters',
    };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    return JobStatus.Completed;
  }

  async cancel(_jobId: string): Promise<void> {
    // Streaming API — cannot cancel after start
  }
}
