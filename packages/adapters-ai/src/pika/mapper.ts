import {
  type AdapterError,
  type GenerationRequest,
  resolvePrimaryVideoConditioningImage,
} from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toPikaRequest(req: GenerationRequest): Record<string, unknown> {
  const conditioningImage = resolvePrimaryVideoConditioningImage(req);
  return {
    promptText: req.prompt,
    negativePrompt: req.negativePrompt ?? '',
    style: (req.params?.style as string) ?? 'default',
    resolution: { width: req.width ?? 1280, height: req.height ?? 720 },
    duration: req.duration ?? 5,
    ...(req.seed != null ? { seed: req.seed } : {}),
    ...(conditioningImage ? { image: conditioningImage } : {}),
  };
}

export function parsePikaResponse(data: Record<string, unknown>): { id: string; status: string } {
  return {
    id: (data['id'] ?? '') as string,
    status: (data['status'] ?? '') as string,
  };
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({ provider: 'Pika', status, error: data });
}
