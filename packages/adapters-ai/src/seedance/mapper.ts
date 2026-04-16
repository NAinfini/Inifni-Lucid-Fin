import {
  type AdapterError,
  type GenerationRequest,
  resolvePrimaryVideoConditioningImage,
} from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toSeedanceInput(req: GenerationRequest): Record<string, unknown> {
  const conditioningImage = resolvePrimaryVideoConditioningImage(req);
  return {
    prompt: req.prompt,
    ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
    ...(conditioningImage ? { image: conditioningImage } : {}),
    ...(req.seed != null ? { seed: req.seed } : {}),
    ...(req.duration ? { duration: req.duration } : {}),
  };
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({ provider: 'Seedance', status, error: data });
}
