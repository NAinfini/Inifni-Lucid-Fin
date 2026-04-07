import type { AdapterError, GenerationRequest } from '@lucid-fin/contracts';
import { ErrorCategory } from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toOpenAIRequest(req: GenerationRequest): Record<string, unknown> {
  return {
    model: 'gpt-image-1',
    prompt: req.prompt,
    n: 1,
    size: `${req.width ?? 1024}x${req.height ?? 1024}`,
    quality: 'standard',
  };
}

export function parseOpenAIResponse(data: Record<string, unknown>): { url: string } {
  const arr = data['data'] as Array<{ url?: string; b64_json?: string }>;
  const item = arr[0];
  if (item.url) return { url: item.url };
  if (item.b64_json) return { url: `data:image/png;base64,${item.b64_json}` };
  throw new Error('No image in OpenAI response');
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({
    provider: 'OpenAI',
    status,
    error: data,
    fallbackCategory: status === 400 ? ErrorCategory.ContentModeration : undefined,
  });
}
