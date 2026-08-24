import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PromptAssemblyInputV1 } from '@lucid-fin/contracts';
import { SqliteIndex } from '@lucid-fin/storage';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createPromptAssemblyService,
  validatePromptAssemblyOutput,
} from './prompt-assembly.service.js';

const roots: string[] = [];
const indexes: SqliteIndex[] = [];

afterEach(() => {
  for (const db of indexes.splice(0)) db.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function createService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-prompt-assembly-'));
  const db = new SqliteIndex(path.join(root, 'project.db'));
  roots.push(root);
  indexes.push(db);
  return createPromptAssemblyService({ db });
}

function prepare(service: ReturnType<typeof createService>) {
  return service.prepare({
    canvasId: 'canvas-1',
    nodeId: 'node-1',
    nodeUpdatedAt: 42,
    mediaType: 'image',
    mode: 'text-to-image',
    purpose: 'initial',
    authority: { kind: 'canvas-draft' },
    sources: [
      {
        sourceId: 'user-intent',
        kind: 'user-intent',
        label: 'User intent',
        content: 'A quiet rainy platform',
        required: true,
      },
      {
        sourceId: 'preset-camera',
        kind: 'preset',
        label: 'Camera preset',
        content: 'A slow lateral tracking composition',
        required: false,
      },
    ],
    conditioningManifest: [],
    providerProfile: {
      providerId: 'image-provider',
      model: 'model-a',
      capabilities: ['text-to-image'],
    },
    hostConstraints: { immutable: ['providerId', 'resolution'] },
  });
}

function outputFor(input: PromptAssemblyInputV1) {
  return {
    version: 1 as const,
    assemblyId: input.assemblyId,
    inputHash: input.inputHash,
    finalPrompt: 'A woman waits alone on a quiet rain-soaked platform, soft lateral framing.',
    negativePrompt: 'crowds, text, watermark',
    sourceDecisions: input.sources.map((source) => ({
      sourceId: source.sourceId,
      sourceHash: source.sourceHash,
      disposition: 'applied' as const,
    })),
    summary: 'Reconciled scene intent and camera direction without duplication.',
    warnings: [],
  };
}

describe('PromptAssemblyService', () => {
  it('persists the exact validated Commander-authored provider prompt', () => {
    const service = createService();
    const prepared = prepare(service);
    const exactFinalPrompt =
      '  A woman waits alone on a quiet rain-soaked platform.\nCamera: slow lateral framing.  ';
    const exactNegativePrompt = ' crowds, text, watermark\nlogo ';
    const assembled = service.submitCommanderOutput(
      prepared.id,
      {
        ...outputFor(prepared.input),
        finalPrompt: exactFinalPrompt,
        negativePrompt: exactNegativePrompt,
      },
      { providerId: 'chatgpt-oauth:llm', model: 'ChatGPT OAuth' },
    );

    expect(assembled.status).toBe('assembled');
    expect(assembled.output?.finalPrompt).toBe(exactFinalPrompt);
    expect(assembled.output?.negativePrompt).toBe(exactNegativePrompt);
    expect(assembled.llmProviderId).toBe('chatgpt-oauth:llm');
  });

  it('rejects an omitted required source without mutating the prepared snapshot', () => {
    const service = createService();
    const prepared = prepare(service);
    const invalid = outputFor(prepared.input);
    invalid.sourceDecisions[0] = {
      ...invalid.sourceDecisions[0]!,
      disposition: 'omitted',
    };

    expect(() =>
      service.submitCommanderOutput(prepared.id, invalid, { providerId: 'commander' }),
    ).toThrow('omitted required source');
    expect(service.get(prepared.id)).toMatchObject({ status: 'prepared' });
  });

  it('rejects stale hashes and duplicate source decisions', () => {
    const service = createService();
    const prepared = prepare(service);
    const stale = outputFor(prepared.input);
    stale.inputHash = 'stale';
    expect(() => validatePromptAssemblyOutput(prepared.input, stale)).toThrow(
      'input hash is stale',
    );

    const duplicate = outputFor(prepared.input);
    duplicate.sourceDecisions[1] = duplicate.sourceDecisions[0]!;
    expect(() => validatePromptAssemblyOutput(prepared.input, duplicate)).toThrow(
      'duplicate source decision',
    );
  });
});
