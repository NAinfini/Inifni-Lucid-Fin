import {
  type AdapterError,
  type GenerationRequest,
  resolveLastVideoConditioningImage,
  resolvePrimaryVideoConditioningImage,
} from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toLumaRequest(req: GenerationRequest): Record<string, unknown> {
  const startImage = resolvePrimaryVideoConditioningImage(req);
  const endImage = resolveLastVideoConditioningImage(req);

  const keyframes: Record<string, unknown> = {};
  if (startImage) keyframes.frame0 = { type: 'image', url: startImage };
  if (endImage) keyframes.frame1 = { type: 'image', url: endImage };

  return {
    model: 'ray-2',
    prompt: req.prompt,
    aspect_ratio: req.params?.aspect_ratio ?? '16:9',
    loop: req.params?.loop ?? false,
    ...(req.duration ? { duration: req.duration } : {}),
    ...(Object.keys(keyframes).length > 0 ? { keyframes } : {}),
  };
}

export function parseLumaResponse(data: Record<string, unknown>): {
  generationId: string;
  status: string;
} {
  return {
    generationId: (data['id'] ?? '') as string,
    status: (data['state'] ?? data['status'] ?? '') as string,
  };
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({ provider: 'Luma', status, error: data });
}
