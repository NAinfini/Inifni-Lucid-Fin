import type { AdapterError, GenerationRequest } from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toSeedanceInput(req: GenerationRequest): Record<string, unknown> {
  const hasImage = req.referenceImages && req.referenceImages.length > 0;
  return {
    prompt: req.prompt,
    ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
    ...(hasImage ? { image: req.referenceImages![0] } : {}),
    ...(req.seed != null ? { seed: req.seed } : {}),
    ...(req.duration ? { duration: req.duration } : {}),
  };
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({ provider: 'Seedance', status, error: data });
}
