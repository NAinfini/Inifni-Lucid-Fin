import {
  type AdapterError,
  type GenerationRequest,
  resolvePrimaryVideoConditioningImage,
} from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toKlingRequest(req: GenerationRequest): Record<string, unknown> {
  const conditioningImage = resolvePrimaryVideoConditioningImage(req);
  return {
    prompt: req.prompt,
    negative_prompt: req.negativePrompt ?? '',
    cfg_scale: 0.5,
    mode: req.quality ?? 'std',
    aspect_ratio: '16:9',
    duration: String(req.duration ?? 5),
    ...(conditioningImage ? { image: conditioningImage } : {}),
    ...(req.seed != null ? { seed: req.seed } : {}),
    ...(req.audio === true ? { enable_audio: true } : {}),
  };
}

export function parseKlingResponse(data: Record<string, unknown>): {
  taskId: string;
  status: string;
} {
  const d = (data['data'] ?? data) as Record<string, unknown>;
  return {
    taskId: (d['task_id'] ?? d['id'] ?? '') as string,
    status: (d['task_status'] ?? d['status'] ?? '') as string,
  };
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({ provider: 'Kling', status, error: data });
}
