import type { GenerationRequest } from '@lucid-fin/contracts';

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
