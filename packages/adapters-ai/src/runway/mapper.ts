import {
  type AdapterError,
  type GenerationRequest,
  resolvePrimaryVideoConditioningImage,
} from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toRunwayRequest(req: GenerationRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    promptText: req.prompt,
    model: 'gen4.5',
    ratio: `${req.width ?? 1280}:${req.height ?? 768}`,
    duration: req.duration ?? 5,
  };
  if (req.seed != null) body.seed = req.seed;
  const promptImage = resolvePrimaryVideoConditioningImage(req);
  if (promptImage) body.promptImage = promptImage;
  return body;
}

export function parseRunwayResponse(data: Record<string, unknown>): {
  taskId: string;
  status: string;
} {
  return {
    taskId: data['id'] as string,
    status: data['status'] as string,
  };
}

export function parseRunwayTask(data: Record<string, unknown>): {
  taskId: string;
  status: string;
  percentage?: number;
  currentStep?: string;
  queuePosition?: number;
  estimatedWaitTime?: number;
  assetUrl?: string;
  failureReason?: string;
} {
  return {
    taskId: String(data['id'] ?? ''),
    status: String(data['status'] ?? ''),
    percentage: normalizePercentage(data['progress'] ?? data['percentage'] ?? data['progress_percentage']),
    currentStep: firstString(data['progress_text'], data['stage'], data['status_text']),
    queuePosition: firstNumber(data['queue_position'], data['queuePosition']),
    estimatedWaitTime: firstNumber(
      data['eta'],
      data['estimated_wait_time'],
      data['estimatedWaitTime'],
      data['time_to_start'],
    ),
    assetUrl: extractAssetUrl(data),
    failureReason: firstString(data['failure_reason'], data['failureReason'], data['error']),
  };
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({
    provider: 'Runway',
    status,
    error: data,
  });
}

function extractAssetUrl(data: Record<string, unknown>): string | undefined {
  const output = data['output'];
  if (typeof output === 'string' && output.startsWith('http')) return output;
  if (Array.isArray(output)) {
    for (const candidate of output) {
      if (typeof candidate === 'string' && candidate.startsWith('http')) return candidate;
      if (candidate && typeof candidate === 'object') {
        const url = firstString(
          (candidate as Record<string, unknown>)['url'],
          (candidate as Record<string, unknown>)['download_url'],
          (candidate as Record<string, unknown>)['video_url'],
        );
        if (url) return url;
      }
    }
  }

  return firstString(data['url'], data['video_url'], data['download_url']);
}

function normalizePercentage(value: unknown): number | undefined {
  const raw = firstNumber(value);
  if (raw == null) return undefined;
  if (raw >= 0 && raw <= 1) return Math.round(raw * 100);
  if (raw >= 0 && raw <= 100) return Math.round(raw);
  return undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}
