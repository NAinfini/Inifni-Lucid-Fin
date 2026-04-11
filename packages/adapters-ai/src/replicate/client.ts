import { LucidError, ErrorCode, JobStatus } from '@lucid-fin/contracts';
import { fetchWithTimeout } from '../fetch-utils.js';

const REPLICATE_BASE = 'https://api.replicate.com/v1';

export interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: unknown;
  error?: string;
  urls?: { get: string; cancel: string };
}

const STATUS_MAP: Record<string, JobStatus> = {
  starting: JobStatus.Queued,
  processing: JobStatus.Running,
  succeeded: JobStatus.Completed,
  failed: JobStatus.Failed,
  canceled: JobStatus.Cancelled,
};

function headers(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

function handleError(res: Response, provider: string): never {
  if (res.status === 401) throw new LucidError(ErrorCode.AuthFailed, `Invalid Replicate API key (${provider})`);
  if (res.status === 429) throw new LucidError(ErrorCode.RateLimited, `Replicate rate limited (${provider})`);
  throw new LucidError(ErrorCode.ServiceUnavailable, `Replicate error for ${provider}: ${res.status}`);
}

export async function createPrediction(
  apiKey: string,
  model: string,
  input: Record<string, unknown>,
  provider: string,
  baseUrl = REPLICATE_BASE,
): Promise<ReplicatePrediction> {
  // Official models use /models/{owner}/{name}/predictions
  // Version-pinned models use /predictions with version field
  const parts = model.split(':');
  const slug = parts[0]; // e.g. "wan-ai/wan-2.1"
  const version = parts[1]; // e.g. "latest" or a sha256 hash

  const isOfficialModel = !version || version === 'latest';
  const url = isOfficialModel
    ? `${baseUrl}/models/${slug}/predictions`
    : `${baseUrl}/predictions`;

  const body = isOfficialModel
    ? { input }
    : { version, input };

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify(body),
    timeoutMs: 60_000,
  });

  if (!res.ok) handleError(res, provider);
  return (await res.json()) as ReplicatePrediction;
}

export async function getPrediction(
  apiKey: string,
  predictionId: string,
  provider: string,
  baseUrl = REPLICATE_BASE,
): Promise<ReplicatePrediction> {
  const res = await fetchWithTimeout(`${baseUrl}/predictions/${predictionId}`, {
    headers: headers(apiKey),
  });

  if (!res.ok) {
    throw new LucidError(ErrorCode.ServiceUnavailable, `Replicate status check failed for ${provider}: ${res.status}`);
  }
  return (await res.json()) as ReplicatePrediction;
}

export async function cancelPrediction(
  apiKey: string,
  predictionId: string,
  baseUrl = REPLICATE_BASE,
): Promise<void> {
  await fetchWithTimeout(`${baseUrl}/predictions/${predictionId}/cancel`, {
    method: 'POST',
    headers: headers(apiKey),
  });
}

export function toJobStatus(status: string): JobStatus {
  return STATUS_MAP[status] ?? JobStatus.Running;
}
