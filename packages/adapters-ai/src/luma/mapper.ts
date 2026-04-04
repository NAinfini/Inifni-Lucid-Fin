import type { GenerationRequest } from '@lucid-fin/contracts';

export function toLumaRequest(req: GenerationRequest): Record<string, unknown> {
  const hasStartImage = req.referenceImages && req.referenceImages.length > 0;
  const hasEndImage = req.referenceImages && req.referenceImages.length > 1;

  const keyframes: Record<string, unknown> = {};
  if (hasStartImage) keyframes.frame0 = { type: 'image', url: req.referenceImages![0] };
  if (hasEndImage) keyframes.frame1 = { type: 'image', url: req.referenceImages![1] };

  return {
    model: 'ray-2',
    prompt: req.prompt,
    aspect_ratio: req.params?.aspect_ratio ?? '16:9',
    loop: req.params?.loop ?? false,
    ...(req.duration ? { duration: `${req.duration}s` } : {}),
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
