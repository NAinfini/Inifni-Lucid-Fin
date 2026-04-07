import type { AdapterError, GenerationRequest } from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toStabilityAudioRequest(req: GenerationRequest): Record<string, unknown> {
  return {
    prompt: req.prompt,
    negative_prompt: req.negativePrompt ?? '',
    duration_seconds: req.duration ?? 10,
    ...(req.seed != null ? { seed: req.seed } : {}),
    steps: 100,
    cfg_scale: 7,
  };
}

export function parseStabilityAudioResponse(data: Record<string, unknown>): {
  id: string;
  status: string;
  audioUrl?: string;
} {
  return {
    id: (data['id'] ?? '') as string,
    status: (data['status'] ?? '') as string,
    audioUrl: (data['audio_url'] ?? data['audio'] ?? undefined) as string | undefined,
  };
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({ provider: 'Stability Audio', status, error: data });
}
