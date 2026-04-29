import {
  type AdapterError,
  type GenerationRequest,
  resolvePrimaryVideoConditioningImage,
} from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toHunyuanInput(req: GenerationRequest): Record<string, unknown> {
  const conditioningImage = resolvePrimaryVideoConditioningImage(req);
  return {
    prompt: req.prompt,
    ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
    ...(conditioningImage ? { image: conditioningImage } : {}),
    ...(req.width ? { width: req.width } : {}),
    ...(req.height ? { height: req.height } : {}),
    ...(req.seed != null ? { seed: req.seed } : {}),
    ...(req.duration ? { num_frames: Math.round((req.duration * 24) / 4) * 4 + 1 } : {}),
  };
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({ provider: 'Hunyuan', status, error: data });
}
