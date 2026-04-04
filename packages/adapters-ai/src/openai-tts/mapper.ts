import type { GenerationRequest } from '@lucid-fin/contracts';

export function toOpenAITTSRequest(req: GenerationRequest): Record<string, unknown> {
  return {
    model: 'tts-1-hd',
    input: req.prompt,
    voice: (req.params?.voice as string) ?? 'alloy',
    response_format: 'mp3',
    speed: (req.params?.speed as number) ?? 1.0,
  };
}
