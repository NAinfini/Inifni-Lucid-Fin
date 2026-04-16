import {
  type AdapterError,
  type GenerationRequest,
  resolveLastVideoConditioningImage,
  resolvePrimaryVideoConditioningImage,
} from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toWanInput(req: GenerationRequest): Record<string, unknown> {
  const firstFrameImage = resolvePrimaryVideoConditioningImage(req);
  const lastFrameImage = resolveLastVideoConditioningImage(req);

  return {
    prompt: req.prompt,
    ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
    num_frames: req.params?.num_frames ?? 81,
    guidance_scale: req.params?.guidance_scale ?? 5,
    ...(firstFrameImage ? { first_frame_image: firstFrameImage } : {}),
    ...(lastFrameImage ? { last_frame_image: lastFrameImage } : {}),
    ...(req.seed != null ? { seed: req.seed } : {}),
  };
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({ provider: 'Wan', status, error: data });
}
