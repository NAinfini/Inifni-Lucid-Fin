import type { GenerationRequest } from '@lucid-fin/contracts';

export function toPikaRequest(req: GenerationRequest): Record<string, unknown> {
  return {
    promptText: req.prompt,
    negativePrompt: req.negativePrompt ?? '',
    style: (req.params?.style as string) ?? 'default',
    resolution: { width: req.width ?? 1280, height: req.height ?? 720 },
    duration: req.duration ?? 5,
    ...(req.seed != null ? { seed: req.seed } : {}),
    ...(req.referenceImages?.[0] ? { image: req.referenceImages[0] } : {}),
  };
}

export function parsePikaResponse(data: Record<string, unknown>): { id: string; status: string } {
  return {
    id: (data['id'] ?? '') as string,
    status: (data['status'] ?? '') as string,
  };
}
