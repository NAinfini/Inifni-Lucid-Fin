import type { AdapterError, GenerationRequest } from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toOpenAITTSRequest(req: GenerationRequest): Record<string, unknown> {
  return {
    model: 'gpt-4o-mini-tts',
    input: req.prompt,
    voice: (req.params?.voice as string) ?? 'alloy',
    response_format: 'mp3',
    speed: (req.params?.speed as number) ?? 1.0,
  };
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({ provider: 'OpenAI TTS', status, error: data });
}
