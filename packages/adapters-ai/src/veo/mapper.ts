import type { GenerationRequest } from '@lucid-fin/contracts';

export function toVeoRequest(req: GenerationRequest): Record<string, unknown> {
  return {
    instances: [{ prompt: req.prompt }],
    parameters: {
      aspectRatio: '16:9',
      personGeneration: 'allow_adult',
      sampleCount: 1,
      durationSeconds: req.duration ?? 5,
      ...(req.seed != null ? { seed: req.seed } : {}),
    },
  };
}

export function parseVeoResponse(data: Record<string, unknown>): {
  operationName: string;
  done: boolean;
  error?: string;
} {
  return {
    operationName: (data['name'] ?? '') as string,
    done: data['done'] === true,
    error: data['error'] ? JSON.stringify(data['error']) : undefined,
  };
}
