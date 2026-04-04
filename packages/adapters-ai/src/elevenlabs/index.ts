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
import { toElevenLabsRequest } from './mapper.js';

export class ElevenLabsAdapter implements AIProviderAdapter {
  readonly id = 'elevenlabs-v2';
  readonly name = 'ElevenLabs TTS';
  readonly type: AdapterType = 'voice';
  readonly capabilities: Capability[] = ['text-to-voice'];
  readonly maxConcurrent = 5;

  private apiKey = '';
  private baseUrl = 'https://api.elevenlabs.io/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/user`, {
        headers: { 'xi-api-key': this.apiKey },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const voiceId = (req.params?.voiceId as string) ?? 'EXAVITQu4vr4xnSDxMaL';
    const body = toElevenLabsRequest(req);

    const res = await fetchWithTimeout(`${this.baseUrl}/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 401)
        throw new LucidError(ErrorCode.AuthFailed, 'Invalid ElevenLabs API key');
      if (res.status === 429)
        throw new LucidError(ErrorCode.RateLimited, 'ElevenLabs rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `ElevenLabs error: ${res.status}`);
    }

    // ElevenLabs returns audio bytes directly (synchronous)
    const buffer = Buffer.from(await res.arrayBuffer());
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const outPath = (req.params?.savePath as string) ?? join(tmpdir(), `tts-11labs-${hash}.mp3`);
    writeFileSync(outPath, buffer);

    return {
      assetHash: hash,
      assetPath: outPath,
      provider: this.id,
      metadata: { voiceId, contentType: res.headers.get('content-type') ?? 'audio/mpeg' },
    };
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    const charCount = req.prompt.length;
    return {
      provider: this.id,
      estimatedCost: (charCount / 1000) * 0.3,
      currency: 'USD',
      unit: 'per 1k characters',
    };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    // ElevenLabs TTS is synchronous — always completed
    return JobStatus.Completed;
  }

  async cancel(_jobId: string): Promise<void> {
    // No-op: synchronous API
  }
}
