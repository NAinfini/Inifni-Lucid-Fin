import { describe, it, expect } from 'vitest';
import { generationStrategyKey, type GenerationSubject } from '@lucid-fin/contracts';
import { STRATEGIES, selectStrategy } from './application-service.js';

describe('GenerationApplicationService strategy table', () => {
  it('covers every (intent, kind | entity) pair', () => {
    // Complementary keys — every legal GenerationSubject should resolve to a
    // key in this set. If a new GeneratableNodeKind / entityKind is added
    // without a matching strategy, the `satisfies` clause in application-
    // service.ts already fails to compile; this test double-checks the
    // runtime table matches the expected catalog.
    const expected: readonly string[] = [
      'canvas-node.image',
      'canvas-node.video',
      'canvas-node.audio',
      'ref-image.character',
      'ref-image.location',
      'ref-image.equipment',
    ];
    expect(Object.keys(STRATEGIES).sort()).toEqual([...expected].sort());
  });

  it('selectStrategy is exhaustive across canvas-node kinds', () => {
    const base = {
      intent: 'canvas-node' as const,
      canvasId: 'c1' as unknown as GenerationSubject['canvasId' & never],
      nodeId: 'n1' as unknown as GenerationSubject['nodeId' & never],
    };
    const kinds = ['image', 'video', 'audio'] as const;
    for (const kind of kinds) {
      // Cast fine — the test just asserts dispatch routing, not brand safety.
      const subject = { ...base, kind } as unknown as GenerationSubject;
      const strategy = selectStrategy(subject);
      expect(strategy.key).toBe(`canvas-node.${kind}`);
      expect(generationStrategyKey(subject)).toBe(strategy.key);
    }
  });

  it('selectStrategy is exhaustive across ref-image entity kinds', () => {
    const entities = ['character', 'location', 'equipment'] as const;
    for (const entityKind of entities) {
      const subject = {
        intent: 'ref-image',
        entityKind,
        entityId: 'e1',
      } as unknown as GenerationSubject;
      const strategy = selectStrategy(subject);
      expect(strategy.key).toBe(`ref-image.${entityKind}`);
      expect(generationStrategyKey(subject)).toBe(strategy.key);
    }
  });
});
