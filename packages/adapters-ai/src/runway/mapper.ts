import type { GenerationRequest } from '@lucid-fin/contracts';

export function toRunwayRequest(req: GenerationRequest): Record<string, unknown> {
  return {
    promptText: req.prompt,
    model: 'gen4.5',
    width: req.width ?? 1280,
    height: req.height ?? 768,
    duration: req.duration ?? 5,
    seed: req.seed,
    init_image: req.referenceImages?.[0],
  };
}

export function parseRunwayResponse(data: Record<string, unknown>): {
  taskId: string;
  status: string;
} {
  return {
    taskId: data['id'] as string,
    status: data['status'] as string,
  };
}
