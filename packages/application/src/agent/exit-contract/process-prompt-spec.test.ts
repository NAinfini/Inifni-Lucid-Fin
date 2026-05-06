import { describe, expect, it } from 'vitest';
import {
  createPromptQualityGateSpec,
  createStylePlateLockSpec,
  stylePlateLockPredicate,
  isGenerationTool,
  evaluateProcessPromptSpecs,
  type ActivationContext,
} from './index.js';

function ctx(overrides: Partial<ActivationContext> = {}): ActivationContext {
  return {
    canvasId: 'c1',
    pendingToolCalls: [],
    canvasSettings: undefined,
    ledger: [],
    step: 0,
    ...overrides,
  };
}

describe('stylePlateLockPredicate', () => {
  it('fires when generation tool pending and stylePlate is empty', () => {
    const a = ctx({
      pendingToolCalls: [{ name: 'canvas.generate', arguments: {} }],
      canvasSettings: { stylePlate: '' },
    });
    expect(stylePlateLockPredicate(a)).toBe(true);
  });

  it('does not fire when stylePlate already set', () => {
    const a = ctx({
      pendingToolCalls: [{ name: 'canvas.generate', arguments: {} }],
      canvasSettings: { stylePlate: 'warm cinematic' },
    });
    expect(stylePlateLockPredicate(a)).toBe(false);
  });

  it('does not fire without a canvasId', () => {
    const a = ctx({
      canvasId: undefined,
      pendingToolCalls: [{ name: 'canvas.generate', arguments: {} }],
      canvasSettings: { stylePlate: '' },
    });
    expect(stylePlateLockPredicate(a)).toBe(false);
  });

  it('does not fire when no pending tool calls', () => {
    const a = ctx({ canvasSettings: { stylePlate: '' } });
    expect(stylePlateLockPredicate(a)).toBe(false);
  });

  it('does not fire when no pending tool is a generation tool', () => {
    const a = ctx({
      pendingToolCalls: [{ name: 'canvas.getState', arguments: {} }],
      canvasSettings: { stylePlate: '' },
    });
    expect(stylePlateLockPredicate(a)).toBe(false);
  });

  it('fires on canvas.batchCreate when nodes include an image', () => {
    const a = ctx({
      pendingToolCalls: [
        {
          name: 'canvas.batchCreate',
          arguments: { nodes: [{ type: 'image' }] },
        },
      ],
      canvasSettings: { stylePlate: '' },
    });
    expect(stylePlateLockPredicate(a)).toBe(true);
  });

  it('does not fire on canvas.batchCreate with only text nodes', () => {
    const a = ctx({
      pendingToolCalls: [
        {
          name: 'canvas.batchCreate',
          arguments: { nodes: [{ type: 'text' }] },
        },
      ],
      canvasSettings: { stylePlate: '' },
    });
    expect(stylePlateLockPredicate(a)).toBe(false);
  });

  it('fires on canvas.addNode with image type', () => {
    const a = ctx({
      pendingToolCalls: [{ name: 'canvas.addNode', arguments: { type: 'image' } }],
      canvasSettings: { stylePlate: '' },
    });
    expect(stylePlateLockPredicate(a)).toBe(true);
  });

  it('does not fire on canvas.addNode with text type', () => {
    const a = ctx({
      pendingToolCalls: [{ name: 'canvas.addNode', arguments: { type: 'text' } }],
      canvasSettings: { stylePlate: '' },
    });
    expect(stylePlateLockPredicate(a)).toBe(false);
  });
});

describe('isGenerationTool', () => {
  it('recognises the canonical generation tools', () => {
    expect(isGenerationTool('canvas.generate')).toBe(true);
    expect(isGenerationTool('character.generateRefImage')).toBe(true);
    expect(isGenerationTool('location.generateRefImage')).toBe(true);
    expect(isGenerationTool('equipment.generateRefImage')).toBe(true);
  });

  it('rejects read-only tools', () => {
    expect(isGenerationTool('canvas.getState')).toBe(false);
    expect(isGenerationTool('tool.list')).toBe(false);
  });
});

describe('evaluateProcessPromptSpecs', () => {
  const spec = createStylePlateLockSpec({
    resolvePromptText: () => 'Lock the style plate before generating.',
  });

  it('returns activations only for matching predicates', () => {
    const a = ctx({
      pendingToolCalls: [{ name: 'canvas.generate', arguments: {} }],
      canvasSettings: { stylePlate: '' },
    });
    const result = evaluateProcessPromptSpecs([spec], a, new Set());
    expect(result.activated).toHaveLength(1);
    expect(result.activated[0].spec.key).toBe('style-plate-lock');
    expect(result.activated[0].content).toContain('Lock the style plate');
  });

  it('skips specs already activated', () => {
    const a = ctx({
      pendingToolCalls: [{ name: 'canvas.generate', arguments: {} }],
      canvasSettings: { stylePlate: '' },
    });
    const result = evaluateProcessPromptSpecs([spec], a, new Set(['style-plate-lock']));
    expect(result.activated).toHaveLength(0);
  });

  it('skips specs whose content resolves to empty', () => {
    const emptySpec = createStylePlateLockSpec({ resolvePromptText: () => '' });
    const a = ctx({
      pendingToolCalls: [{ name: 'canvas.generate', arguments: {} }],
      canvasSettings: { stylePlate: '' },
    });
    const result = evaluateProcessPromptSpecs([emptySpec], a, new Set());
    expect(result.activated).toHaveLength(0);
  });

  it('treats predicate throws as no-activation without crashing', () => {
    const bad = {
      key: 'broken',
      displayName: 'Broken',
      lifecycle: 'one-shot' as const,
      activationPredicate: () => {
        throw new Error('boom');
      },
      content: () => 'x',
    };
    const result = evaluateProcessPromptSpecs([bad], ctx(), new Set());
    expect(result.activated).toHaveLength(0);
  });
});

describe('configurable process prompt specs', () => {
  it('limits style plate lock to reference-image tools when configured', () => {
    const spec = createStylePlateLockSpec({
      resolvePromptText: () => 'Lock the style plate before reference images.',
      referenceImagesOnly: true,
    });

    const canvasGenerate = evaluateProcessPromptSpecs(
      [
        spec,
      ],
      ctx({
        pendingToolCalls: [{ name: 'canvas.generate', arguments: {} }],
        canvasSettings: { stylePlate: '' },
      }),
      new Set(),
    );
    const refImageGenerate = evaluateProcessPromptSpecs(
      [
        spec,
      ],
      ctx({
        pendingToolCalls: [{ name: 'character.generateRefImage', arguments: {} }],
        canvasSettings: { stylePlate: '' },
      }),
      new Set(),
    );

    expect(canvasGenerate.activated).toHaveLength(0);
    expect(refImageGenerate.activated).toHaveLength(1);
  });

  it('adds quality gate behavior instructions to the resolved prompt', () => {
    const spec = createPromptQualityGateSpec({
      resolvePromptText: () => 'Before generating, inspect the prompt.',
      behavior: 'block-generation',
    });
    const result = evaluateProcessPromptSpecs(
      [
        spec,
      ],
      ctx({
        pendingToolCalls: [{ name: 'canvas.generate', arguments: { prompt: '' } }],
      }),
      new Set(),
    );

    expect(result.activated[0]?.content).toContain('Configured behavior: block generation');
  });
});
