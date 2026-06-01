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
      pendingToolCalls: [{ name: 'canvas.generation', arguments: {} }],
      canvasSettings: { stylePlate: '' },
    });
    expect(stylePlateLockPredicate(a)).toBe(true);
  });

  it('does not fire when stylePlate already set', () => {
    const a = ctx({
      pendingToolCalls: [{ name: 'canvas.generation', arguments: {} }],
      canvasSettings: { stylePlate: 'warm cinematic' },
    });
    expect(stylePlateLockPredicate(a)).toBe(false);
  });

  it('does not fire without a canvasId', () => {
    const a = ctx({
      canvasId: undefined,
      pendingToolCalls: [{ name: 'canvas.generation', arguments: {} }],
      canvasSettings: { stylePlate: '' },
    });
    expect(stylePlateLockPredicate(a)).toBe(false);
  });

  it('v2: fires when stylePlate is empty regardless of pending tool calls', () => {
    const a = ctx({ canvasSettings: { stylePlate: '' } });
    expect(stylePlateLockPredicate(a)).toBe(true);
  });

  it('v2: fires even when pending tools are non-generation', () => {
    const a = ctx({
      pendingToolCalls: [{ name: 'canvas.getInfo', arguments: {} }],
      canvasSettings: { stylePlate: '' },
    });
    expect(stylePlateLockPredicate(a)).toBe(true);
  });

  it('fires on canvas.createNodes when nodes include an image', () => {
    const a = ctx({
      pendingToolCalls: [
        {
          name: 'canvas.createNodes',
          arguments: { nodes: [{ type: 'image' }] },
        },
      ],
      canvasSettings: { stylePlate: '' },
    });
    expect(stylePlateLockPredicate(a)).toBe(true);
  });

  it('v2: fires on canvas.createNodes with text-only nodes when plate empty', () => {
    const a = ctx({
      pendingToolCalls: [
        {
          name: 'canvas.createNodes',
          arguments: { nodes: [{ type: 'text' }] },
        },
      ],
      canvasSettings: { stylePlate: '' },
    });
    expect(stylePlateLockPredicate(a)).toBe(true);
  });

  it('fires on canvas.createNodes with image type', () => {
    const a = ctx({
      pendingToolCalls: [{ name: 'canvas.createNodes', arguments: { type: 'image' } }],
      canvasSettings: { stylePlate: '' },
    });
    expect(stylePlateLockPredicate(a)).toBe(true);
  });

  it('v2: fires on canvas.createNodes with text type when plate empty', () => {
    const a = ctx({
      pendingToolCalls: [{ name: 'canvas.createNodes', arguments: { type: 'text' } }],
      canvasSettings: { stylePlate: '' },
    });
    expect(stylePlateLockPredicate(a)).toBe(true);
  });
});

describe('isGenerationTool', () => {
  it('recognises the canonical generation tools', () => {
    expect(isGenerationTool('canvas.generation')).toBe(true);
    expect(isGenerationTool('entity.generateRefImage')).toBe(true);
  });

  it('rejects read-only tools', () => {
    expect(isGenerationTool('canvas.getInfo')).toBe(false);
    expect(isGenerationTool('tool.get')).toBe(false);
  });
});

describe('evaluateProcessPromptSpecs', () => {
  const spec = createStylePlateLockSpec({
    resolvePromptText: () => 'Lock the style plate before generating.',
  });

  it('returns activations only for matching predicates', () => {
    const a = ctx({
      pendingToolCalls: [{ name: 'canvas.generation', arguments: {} }],
      canvasSettings: { stylePlate: '' },
    });
    const result = evaluateProcessPromptSpecs([spec], a, new Set());
    expect(result.activated).toHaveLength(1);
    expect(result.activated[0].spec.key).toBe('style-plate-lock');
    expect(result.activated[0].content).toContain('Lock the style plate');
  });

  it('skips specs already activated', () => {
    const a = ctx({
      pendingToolCalls: [{ name: 'canvas.generation', arguments: {} }],
      canvasSettings: { stylePlate: '' },
    });
    const result = evaluateProcessPromptSpecs([spec], a, new Set(['style-plate-lock']));
    expect(result.activated).toHaveLength(0);
  });

  it('skips specs whose content resolves to empty', () => {
    const emptySpec = createStylePlateLockSpec({ resolvePromptText: () => '' });
    const a = ctx({
      pendingToolCalls: [{ name: 'canvas.generation', arguments: {} }],
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
  it('v2: referenceImagesOnly no longer filters — fires based on workspace state', () => {
    const spec = createStylePlateLockSpec({
      resolvePromptText: () => 'Lock the style plate before reference images.',
      referenceImagesOnly: true,
    });

    // v2: Both cases fire because the predicate checks workspace state
    // (plate empty), not pending tool call types.
    const canvasGenerate = evaluateProcessPromptSpecs(
      [
        spec,
      ],
      ctx({
        pendingToolCalls: [{ name: 'canvas.generation', arguments: {} }],
        canvasSettings: { stylePlate: '' },
      }),
      new Set(),
    );
    const refImageGenerate = evaluateProcessPromptSpecs(
      [
        spec,
      ],
      ctx({
        pendingToolCalls: [{ name: 'entity.generateRefImage', arguments: {} }],
        canvasSettings: { stylePlate: '' },
      }),
      new Set(),
    );

    expect(canvasGenerate.activated).toHaveLength(1);
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
        pendingToolCalls: [{ name: 'canvas.generation', arguments: { prompt: '' } }],
      }),
      new Set(),
    );

    expect(result.activated[0]?.content).toContain('Configured behavior: block generation');
  });
});
