import type {
  AIProviderAdapter,
  AdapterType,
  Capability,
  GenerationRequest,
  GenerationResult,
  CostEstimate,
} from '@lucid-fin/contracts';
import {
  LucidError,
  ErrorCode,
  JobStatus,
  resolvePrimaryVideoConditioningImage,
} from '@lucid-fin/contracts';
import { fetchWithTimeout } from '../fetch-utils.js';
import { toKlingRequest, parseKlingResponse } from './mapper.js';

export class KlingAdapter implements AIProviderAdapter {
  readonly id = 'kling-v1';
  readonly name = 'Kling AI';
  readonly type: AdapterType = 'video';
  readonly capabilities: Capability[] = ['text-to-video', 'image-to-video'];
  readonly maxConcurrent = 2;

  private accessKeyId = '';
  private secretKey = '';
  private baseUrl = 'https://api.klingai.com/v1';

  configure(apiKey: string, options?: Record<string, unknown>): void {
    const [ak, sk] = apiKey.split(':');
    this.accessKeyId = ak ?? apiKey;
    this.secretKey = sk ?? '';
    if (options?.baseUrl) this.baseUrl = options.baseUrl as string;
  }

  private async authHeader(): Promise<string> {
    if (!this.secretKey) return `Bearer ${this.accessKeyId}`;
    const encoder = new TextEncoder();
    const now = Math.floor(Date.now() / 1000);
    const headerB64 = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const payloadB64 = btoa(JSON.stringify({ iss: this.accessKeyId, exp: now + 1800, nbf: now - 5 })).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    const sigInput = `${headerB64}.${payloadB64}`;
    const key = await crypto.subtle.importKey('raw', encoder.encode(this.secretKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(sigInput));
    const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `Bearer ${sigInput}.${sigB64}`;
  }

  async validate(): Promise<boolean> {
    try {
      const res = await fetchWithTimeout(`${this.baseUrl}/videos/text2video`, {
        method: 'GET',
        headers: { Authorization: await this.authHeader() },
      });
      return res.ok || res.status === 405;
    } catch { /* network error — key cannot be validated, report as invalid */
      return false;
    }
  }

  async generate(req: GenerationRequest): Promise<GenerationResult> {
    const isImg2Vid = Boolean(resolvePrimaryVideoConditioningImage(req));
    const endpoint = isImg2Vid ? '/videos/image2video' : '/videos/text2video';
    const body = toKlingRequest(req);
    const auth = await this.authHeader();

    const res = await fetchWithTimeout(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      if (res.status === 401) throw new LucidError(ErrorCode.AuthFailed, 'Invalid Kling API key');
      if (res.status === 429) throw new LucidError(ErrorCode.RateLimited, 'Kling rate limited');
      throw new LucidError(ErrorCode.ServiceUnavailable, `Kling error: ${res.status}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseKlingResponse(data);

    return {
      assetHash: '',
      assetPath: '',
      provider: this.id,
      metadata: { taskId: parsed.taskId, status: parsed.status, endpoint },
    };
  }

  estimateCost(req: GenerationRequest): CostEstimate {
    return {
      provider: this.id,
      estimatedCost: (req.duration ?? 5) * 0.07,
      currency: 'USD',
      unit: 'per video',
    };
  }

  async checkStatus(jobId: string, metadata?: Record<string, unknown>): Promise<JobStatus> {
    const endpoint = String(metadata?.endpoint ?? '/videos/text2video');
    const auth = await this.authHeader();
    const res = await fetchWithTimeout(`${this.baseUrl}${endpoint}/${jobId}`, {
      headers: { Authorization: auth },
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `Kling status check failed: ${res.status}`);

    const data = (await res.json()) as Record<string, unknown>;
    const parsed = parseKlingResponse(data);
    const map: Record<string, JobStatus> = {
      submitted: JobStatus.Queued,
      processing: JobStatus.Running,
      succeed: JobStatus.Completed,
      failed: JobStatus.Failed,
    };
    return map[parsed.status] ?? JobStatus.Running;
  }

  async cancel(jobId: string): Promise<void> {
    const auth = await this.authHeader();
    const res = await fetchWithTimeout(`${this.baseUrl}/videos/text2video/${jobId}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    });
    if (!res.ok)
      throw new LucidError(ErrorCode.ServiceUnavailable, `Kling cancel failed: ${res.status}`);
  }
}
