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
import { join, resolve, sep } from 'node:path';
import { validateProviderUrl } from '../url-policy.js';

export class FishAudioAdapter implements AIProviderAdapter {
  readonly id = 'fish-audio-v1';
  readonly name = 'Fish Audio TTS';
  readonly type: AdapterType = 'voice';
  readonly capabilities: Capability[] = ['text-to-voice'];
  readonly maxConcurrent = 2;

  private apiKey = '';
  private baseUrl = 'https://api.fish.audio/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    this.apiKey = apiKey;
    if (options?.baseUrl) {
      validateProviderUrl(options.baseUrl as string);
      this.baseUrl = options.baseUrl as string;
    }
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });
      return res.ok;
    } catch {
      /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const voiceId = (req.params?.voiceId as string) ?? 'default';
    const res = await fetchWithTimeout(`${this.baseUrl}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ text: req.prompt, reference_id: voiceId, format: 'mp3' }),
      timeoutMs: 60_000,
    });
    if (!res.ok) {
      if (res.status === 401)
        throw new LucidError(ErrorCode.AuthFailed, 'Invalid Fish Audio API key');
      if (res.status === 429)
        throw new LucidError(ErrorCode.RateLimited, 'Fish Audio rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Fish Audio error: ${res.status}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const defaultPath = join(tmpdir(), `tts-fish-${hash}.mp3`);
    const requestedPath = req.params?.savePath as string | undefined;
    const tmpBase = resolve(tmpdir());
    const outPath =
      requestedPath && resolve(requestedPath).startsWith(tmpBase + sep)
        ? requestedPath
        : defaultPath;
    writeFileSync(outPath, buffer);

    return { assetHash: hash, assetPath: outPath, provider: this.id, metadata: { voiceId } };
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    return {
      provider: this.id,
      estimatedCost: req.prompt.length * 0.00003,
      currency: 'USD',
      unit: 'per char',
    };
  }

  async checkStatus(_jobId: string): Promise<JobStatus> {
    return JobStatus.Completed;
  }
  async cancel(_jobId: string): Promise<void> {}
}
