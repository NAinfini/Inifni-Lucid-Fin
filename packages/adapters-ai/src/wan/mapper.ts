import type { AdapterError, GenerationRequest } from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toWanInput(req: GenerationRequest): Record<string, unknown> {
  const hasFirstFrame = req.referenceImages && req.referenceImages.length > 0;
  const hasLastFrame = req.referenceImages && req.referenceImages.length > 1;

  return {
    prompt: req.prompt,
    ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
    num_frames: req.params?.num_frames ?? 81,
    guidance_scale: req.params?.guidance_scale ?? 5,
    ...(hasFirstFrame ? { first_frame_image: req.referenceImages![0] } : {}),
    ...(hasLastFrame ? { last_frame_image: req.referenceImages![1] } : {}),
    ...(req.seed != null ? { seed: req.seed } : {}),
  };
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({ provider: 'Wan', status, error: data });
}
