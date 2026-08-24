import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMAdapter } from '@lucid-fin/contracts';
import { clearSettingsCache, updateSettingsCache } from '../settings-cache.js';
import { createVisualAnalyzer } from '../../services/visual-analyzer.service.js';
import { registerVisionHandlers } from './vision.handlers.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  clearSettingsCache();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function imageFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-vision-routing-'));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, 'asset.png');
  fs.writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  return {
    cas: { getAssetPath: vi.fn(() => filePath) },
    filePath,
  };
}

function adapter(id: string, visual: boolean, output: string): LLMAdapter {
  return {
    id,
    name: id,
    capabilities: visual ? ['text-generation', 'image-understanding'] : ['text-generation'],
    configure: vi.fn(),
    validate: vi.fn(async () => true),
    complete: vi.fn(async () => output),
    stream: vi.fn(),
    completeWithTools: vi.fn(),
  } as unknown as LLMAdapter;
}

describe('registerVisionHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    handlers = new Map();
  });

  it('rejects malformed describe-image requests at the typed IPC boundary', async () => {
    const visualAnalyzer = { analyzeImageAsset: vi.fn(), analyzeImageAssets: vi.fn() };

    registerVisionHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      {
        visualAnalyzer,
      } as never,
    );

    await expect(
      handlers.get('vision:describeImage')?.(
        {},
        { assetHash: '', assetType: 'image', style: 'prompt' },
      ),
    ).rejects.toThrow('assetHash is required');
    expect(visualAnalyzer.analyzeImageAsset).not.toHaveBeenCalled();
  });

  it('routes describe-image IPC through the shared visual analyzer', async () => {
    const visualAnalyzer = {
      analyzeImageAsset: vi.fn(async () => ({
        text: 'shared analysis',
        providerId: 'openai',
        model: 'gpt-5.6-sol',
      })),
      analyzeImageAssets: vi.fn(),
    };
    registerVisionHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      { visualAnalyzer } as never,
    );

    await expect(
      handlers.get('vision:describeImage')?.(
        {},
        { assetHash: 'asset-hash', assetType: 'image', style: 'style-analysis' },
      ),
    ).resolves.toEqual({ prompt: 'shared analysis' });
    expect(visualAnalyzer.analyzeImageAsset).toHaveBeenCalledWith(
      'asset-hash',
      expect.objectContaining({ systemPrompt: expect.stringContaining('visual style analyst') }),
    );
  });

  it('reuses the active visual LLM and never reads a fallback credential', async () => {
    const { cas } = imageFixture();
    const activeLLM = adapter('chatgpt-oauth', true, 'same-model analysis');
    const analyzer = createVisualAnalyzer({
      cas: cas as never,
      llmRegistry: { get: vi.fn() },
    });

    const result = await analyzer.analyzeImageAsset('asset', {
      systemPrompt: 'Analyze the image',
      preferredLLMAdapter: activeLLM,
    });

    expect(result).toMatchObject({ text: 'same-model analysis', providerId: 'chatgpt-oauth' });
    expect(activeLLM.validate).not.toHaveBeenCalled();
    expect(activeLLM.complete).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          images: [expect.objectContaining({ mimeType: 'image/png' })],
        }),
      ]),
    );
  });

  it('uses the dedicated vision provider only when the active LLM is text-only', async () => {
    const { cas } = imageFixture();
    updateSettingsCache({
      vision: {
        providers: [
          {
            id: 'gemini-vision',
            name: 'Gemini Vision',
            baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            model: 'gemini-3.6-flash',
            hasKey: true,
            credentialMode: 'api-key',
          },
        ],
      },
    });
    const textOnlyLLM = adapter('deepseek', false, 'must not run');
    const fallback = adapter('gemini-vision', true, 'fallback analysis');
    const analyzer = createVisualAnalyzer({
      cas: cas as never,
      llmRegistry: { get: vi.fn((id) => (id === fallback.id ? fallback : undefined)) },
    });

    const result = await analyzer.analyzeImageAsset('asset', {
      systemPrompt: 'Analyze the image',
      preferredLLMAdapter: textOnlyLLM,
    });

    expect(result).toMatchObject({
      text: 'fallback analysis',
      providerId: 'gemini-vision',
    });
    expect(textOnlyLLM.complete).not.toHaveBeenCalled();
    expect(fallback.complete).toHaveBeenCalledTimes(1);
  });

  it('surfaces an active visual LLM failure without invoking the fallback provider', async () => {
    const { cas } = imageFixture();
    const activeLLM = adapter('chatgpt-oauth', true, 'unused');
    activeLLM.complete = vi.fn(async () => {
      throw new Error('active visual LLM failed');
    });
    const fallback = adapter('gemini-vision', true, 'must not run');
    const analyzer = createVisualAnalyzer({
      cas: cas as never,
      llmRegistry: { get: vi.fn(() => fallback) },
    });

    await expect(
      analyzer.analyzeImageAsset('asset', {
        systemPrompt: 'Analyze the image',
        preferredLLMAdapter: activeLLM,
      }),
    ).rejects.toThrow('active visual LLM failed');

    expect(fallback.complete).not.toHaveBeenCalled();
  });

  it('fails closed when the configured active visual LLM is not ready', async () => {
    updateSettingsCache({
      llm: {
        providers: [
          {
            id: 'chatgpt-oauth',
            name: 'ChatGPT',
            model: 'gpt-5.6-sol',
            supportsVision: true,
          },
        ],
      },
      vision: {
        providers: [{ id: 'openai-vision', name: 'OpenAI Vision', model: 'gpt-5.6-sol' }],
      },
    });
    const activeLLM = adapter('chatgpt-oauth', true, 'must not run');
    activeLLM.validate = vi.fn(async () => false);
    const fallback = adapter('openai-vision', true, 'must not run');
    const analyzer = createVisualAnalyzer({
      cas: {} as never,
      llmRegistry: {
        get: vi.fn((id) => (id === activeLLM.id ? activeLLM : fallback)),
      },
    });

    await expect(analyzer.analyzeImageAsset('asset', { systemPrompt: 'Analyze' })).rejects.toThrow(
      'Visual provider is not ready: chatgpt-oauth',
    );
    expect(fallback.validate).not.toHaveBeenCalled();
    expect(fallback.complete).not.toHaveBeenCalled();
  });

  it('fails closed when an OAuth vision provider has no registered adapter', async () => {
    updateSettingsCache({
      vision: {
        providers: [
          {
            id: 'chatgpt-vision-oauth',
            name: 'ChatGPT Vision',
            model: 'gpt-5.6-sol',
            credentialMode: 'oauth',
          },
        ],
      },
    });
    const analyzer = createVisualAnalyzer({
      cas: {} as never,
      llmRegistry: { get: vi.fn(() => undefined) },
    });

    await expect(analyzer.analyzeImageAsset('asset', { systemPrompt: 'Analyze' })).rejects.toThrow(
      'Visual provider is not registered in the main process',
    );
  });
});
