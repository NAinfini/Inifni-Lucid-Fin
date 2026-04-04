import type { GenerationRequest } from '@lucid-fin/contracts';

export function toHunyuanInput(req: GenerationRequest): Record<string, unknown> {
  const hasImage = req.referenceImages && req.referenceImages.length > 0;
  return {
    prompt: req.prompt,
    ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
    ...(hasImage ? { image: req.referenceImages![0] } : {}),
    ...(req.width ? { width: req.width } : {}),
    ...(req.height ? { height: req.height } : {}),
    ...(req.seed != null ? { seed: req.seed } : {}),
    ...(req.duration ? { num_frames: Math.round(req.duration * 24 / 4) * 4 + 1 } : {}),
  };
}
