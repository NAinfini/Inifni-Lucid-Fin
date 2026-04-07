import type { AdapterError, GenerationRequest } from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toSunoRequest(req: GenerationRequest): Record<string, unknown> {
  return {
    prompt: req.prompt,
    make_instrumental: req.params?.instrumental === true,
    duration: req.duration ?? 30,
    ...(req.params?.style ? { tags: req.params.style as string } : {}),
  };
}

export function parseSunoResponse(data: Record<string, unknown>): {
  id: string;
  status: string;
  audioUrl?: string;
} {
  return {
    id: (data['id'] ?? '') as string,
    status: (data['status'] ?? '') as string,
    audioUrl: (data['audio_url'] ?? undefined) as string | undefined,
  };
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({ provider: 'Suno', status, error: data });
}
