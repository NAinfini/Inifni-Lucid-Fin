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

function extractErrorSummary(payload: unknown): string | undefined {
  if (!payload) return undefined;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof payload !== 'object') return undefined;

  const record = payload as Record<string, unknown>;
  for (const key of ['detail', 'error', 'message', 'title']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  if (Array.isArray(record.errors)) {
    const parts = record.errors
      .map((entry) => extractErrorSummary(entry))
      .filter((value): value is string => Boolean(value));
    if (parts.length > 0) return parts.join('; ');
  }

  return undefined;
}

async function readErrorSummary(res: Response): Promise<string | undefined> {
  const text = (await res.text()).trim();
  if (text.length === 0) return undefined;

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      return extractErrorSummary(JSON.parse(text)) ?? text;
    } catch {
      return text;
    }
  }

  return text;
}

function appendErrorSummary(message: string, summary: string | undefined): string {
  return summary ? `${message} - ${summary}` : message;
}

async function handleError(
  res: Response,
  provider: string,
  details?: Record<string, unknown>,
): Promise<never> {
  const summary = await readErrorSummary(res);
  const errorDetails = { ...details, provider, status: res.status };

  if (res.status === 401) {
    throw new LucidError(
      ErrorCode.AuthFailed,
      appendErrorSummary(`Invalid Replicate API key (${provider})`, summary),
      errorDetails,
    );
  }
  if (res.status === 429) {
    throw new LucidError(
      ErrorCode.RateLimited,
      appendErrorSummary(`Replicate rate limited (${provider})`, summary),
      errorDetails,
    );
  }
  if (res.status === 400 || res.status === 422) {
    throw new LucidError(
      ErrorCode.InvalidRequest,
      appendErrorSummary(`Replicate rejected the request for ${provider}: ${res.status}`, summary),
      errorDetails,
    );
  }

  throw new LucidError(
    ErrorCode.ServiceUnavailable,
    appendErrorSummary(`Replicate error for ${provider}: ${res.status}`, summary),
    errorDetails,
  );
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

  if (!res.ok) {
    await handleError(res, provider, {
      model,
      endpoint: url,
      operation: 'createPrediction',
    });
  }
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
    await handleError(res, provider, {
      predictionId,
      endpoint: `${baseUrl}/predictions/${predictionId}`,
      operation: 'getPrediction',
    });
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
