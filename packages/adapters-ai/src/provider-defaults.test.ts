import { describe, expect, it, vi } from 'vitest';
import type { GenerationRequest } from '@lucid-fin/contracts';
import { OpenAILLMAdapter } from './llm/openai-llm.js';
import { ClaudeLLMAdapter } from './llm/claude-llm.js';
import { GeminiLLMAdapter } from './llm/gemini-llm.js';
import { GrokLLMAdapter } from './llm/grok-llm.js';
import { CohereLLMAdapter } from './llm/cohere-llm.js';
import { GoogleImagen3Adapter } from './imagen/index.js';
import { toOpenAIRequest } from './openai-dalle/mapper.js';
import { toOpenAITTSRequest } from './openai-tts/mapper.js';
import { toRunwayRequest } from './runway/mapper.js';
import { toMiniMaxRequest } from './minimax/mapper.js';
import { IdeogramAdapter } from './ideogram/index.js';
import { VeoAdapter } from './veo/index.js';

function makeImageRequest(): GenerationRequest {
  return {
    type: 'image',
    providerId: 'test-provider',
    prompt: 'cinematic skyline',
  };
}

function makeVideoRequest(): GenerationRequest {
  return {
    type: 'video',
    providerId: 'test-provider',
    prompt: 'slow dolly through a forest',
  };
}

describe('adapter defaults', () => {
  it('uses the approved hosted llm defaults', () => {
    expect(Reflect.get(new OpenAILLMAdapter(), 'model')).toBe('gpt-5.6-sol');
    expect(Reflect.get(new ClaudeLLMAdapter(), 'model')).toBe('claude-sonnet-5');
    expect(Reflect.get(new GeminiLLMAdapter(), 'model')).toBe('gemini-3.6-flash');
    expect(Reflect.get(new GrokLLMAdapter(), 'model')).toBe('grok-4.5');
    expect(Reflect.get(new CohereLLMAdapter(), 'model')).toBe('command-a-plus-05-2026');
  });

  it('uses the approved image, video, and audio mapper defaults', () => {
    expect(toOpenAIRequest(makeImageRequest())['model']).toBe('gpt-image-2');
    expect(toOpenAITTSRequest(makeImageRequest())['model']).toBe('gpt-4o-mini-tts');
    expect(toRunwayRequest(makeVideoRequest())['model']).toBe('gen4.5');
    expect(toMiniMaxRequest(makeVideoRequest())['model']).toBe('MiniMax-H3');
    expect(Reflect.get(new GoogleImagen3Adapter(), 'model')).toBe('gemini-3.1-flash-image');
  });

  it('sends the approved ideogram and veo model values', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ url: 'https://example.com/image.png', seed: 1 }] }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'interaction-video-test',
            steps: [
              {
                type: 'model_output',
                content: [
                  {
                    type: 'video',
                    mime_type: 'video/mp4',
                    uri: 'https://example.com/video.mp4',
                  },
                ],
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const ideogram = new IdeogramAdapter();
      ideogram.configure('sk-test');
      await ideogram.generate(makeImageRequest());

      const ideogramInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(ideogramInit.body).toBeDefined();
      expect(JSON.parse(String(ideogramInit.body))).toMatchObject({
        image_request: { model: 'V_3' },
      });

      const veo = new VeoAdapter();
      veo.configure('sk-test');
      await veo.generate(makeVideoRequest());

      expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
        'https://generativelanguage.googleapis.com/v1beta/interactions',
      );
      const veoInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
      expect(JSON.parse(String(veoInit.body))).toMatchObject({
        model: 'gemini-omni-flash-preview',
        generation_config: { video_config: { task: 'text_to_video' } },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
