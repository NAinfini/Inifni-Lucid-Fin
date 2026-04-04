import type { GenerationRequest } from '@lucid-fin/contracts';

export function toUdioRequest(req: GenerationRequest): Record<string, unknown> {
  return {
    prompt: req.prompt,
    duration: req.duration ?? 30,
    ...(req.params?.style ? { style: req.params.style as string } : {}),
    ...(req.params?.instrumental === true ? { instrumental: true } : {}),
  };
}

export function parseUdioResponse(data: Record<string, unknown>): {
  id: string;
  status: string;
  audioUrl?: string;
} {
  return {
    id: (data['id'] ?? data['track_id'] ?? '') as string,
    status: (data['status'] ?? '') as string,
    audioUrl: (data['audio_url'] ?? undefined) as string | undefined,
  };
}
