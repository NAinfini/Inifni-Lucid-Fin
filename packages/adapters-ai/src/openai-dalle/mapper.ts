import type { GenerationRequest } from '@lucid-fin/contracts';

export function toOpenAIRequest(req: GenerationRequest): Record<string, unknown> {
  return {
    model: 'gpt-image-1',
    prompt: req.prompt,
    n: 1,
    size: `${req.width ?? 1024}x${req.height ?? 1024}`,
    quality: 'standard',
    response_format: 'url',
  };
}

export function parseOpenAIResponse(data: Record<string, unknown>): { url: string } {
  const arr = data['data'] as Array<{ url: string }>;
  return { url: arr[0].url };
}
