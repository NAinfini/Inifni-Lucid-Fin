import { describe, expect, it } from 'vitest';
import type { Canvas, ImageNodeData } from '@lucid-fin/contracts';
import { buildExternalAIPrompt } from './prompt-export.js';

function createCanvasWithImageNode(data: ImageNodeData): Canvas {
  return {
    id: 'canvas-1',
    name: 'Canvas',
    nodes: [
      {
        id: 'node-1',
        type: 'image',
        title: 'Hero Shot',
        position: { x: 0, y: 0 },
        data,
        bypassed: false,
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('buildExternalAIPrompt', () => {
  it('includes legacy negative prompts when present on persisted node data', () => {
    const canvas = createCanvasWithImageNode({
      status: 'done',
      prompt: 'A determined pilot in a storm.',
      variants: [],
      selectedVariantIndex: 0,
      negativePrompt: 'blurry, watermark',
    } as ImageNodeData & { negativePrompt: string });

    const prompt = buildExternalAIPrompt(canvas, 'node-1');

    expect(prompt).toContain('**Current Prompt:** A determined pilot in a storm.');
    expect(prompt).toContain('**Negative Prompt:** blurry, watermark');
  });

  it('omits the negative prompt line when node data does not contain one', () => {
    const canvas = createCanvasWithImageNode({
      status: 'done',
      prompt: 'A determined pilot in a storm.',
      variants: [],
      selectedVariantIndex: 0,
    });

    const prompt = buildExternalAIPrompt(canvas, 'node-1');

    expect(prompt).not.toContain('**Negative Prompt:**');
  });
});
