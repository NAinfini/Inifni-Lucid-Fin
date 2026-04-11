import type { AdapterError, GenerationRequest } from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toVeoRequest(req: GenerationRequest): Record<string, unknown> {
  return {
    instances: [{ prompt: req.prompt }],
    parameters: {
      aspectRatio: '16:9',
      personGeneration: 'allow_adult',
      sampleCount: 1,
      durationSeconds: req.duration ?? 5,
      ...(req.seed != null ? { seed: req.seed } : {}),
      ...(req.audio === true ? { generateAudio: true } : {}),
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

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({ provider: 'Veo', status, error: data });
}
