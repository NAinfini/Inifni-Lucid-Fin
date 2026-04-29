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
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateProviderUrl } from '../url-policy.js';

export class ElevenLabsSFXAdapter implements AIProviderAdapter {
  readonly id = 'elevenlabs-sfx';
  readonly name = 'ElevenLabs Sound Effects';
  readonly type: AdapterType = 'sfx';
  readonly capabilities: Capability[] = ['text-to-sfx'];
  readonly maxConcurrent = 5;

  private apiKey = '';
  private baseUrl = 'https://api.elevenlabs.io/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
    }
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/user`, {
        headers: { 'xi-api-key': this.apiKey },
      });
      return res.ok;
    } catch {
      /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const body: Record<string, unknown> = { text: req.prompt };
    if (req.duration) body.duration_seconds = req.duration;
    if (req.params?.duration_seconds) body.duration_seconds = req.params.duration_seconds;

    const res = await fetchWithTimeout(`${this.baseUrl}/sound-generation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
      timeoutMs: 60_000,
    });

    if (!res.ok) {
      if (res.status === 401)
        throw new LucidError(ErrorCode.AuthFailed, 'Invalid ElevenLabs API key');
      if (res.status === 429)
        throw new LucidError(ErrorCode.RateLimited, 'ElevenLabs rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `ElevenLabs SFX error: ${res.status}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const outPath = join(tmpdir(), `sfx-11labs-${hash}.mp3`);
    writeFileSync(outPath, buffer);

    return {
      assetHash: hash,
      assetPath: outPath,
      provider: this.id,
      metadata: { contentType: res.headers.get('content-type') ?? 'audio/mpeg' },
    };
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    const durationSec = req.duration ?? 5;
    return {
      provider: this.id,
      estimatedCost: durationSec * 0.01,
      currency: 'USD',
      unit: 'per second',
    };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    return JobStatus.Completed;
  }

  async cancel(_jobId: string): Promise<void> {
    // Synchronous API
  }
}
