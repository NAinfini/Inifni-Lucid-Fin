import type { AdapterError, GenerationRequest } from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toElevenLabsRequest(req: GenerationRequest): Record<string, unknown> {
  return {
    text: req.prompt,
    model_id: 'eleven_multilingual_v2',
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75,
      style: 0.0,
      use_speaker_boost: true,
    },
  };
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({ provider: 'ElevenLabs', status, error: data });
}
