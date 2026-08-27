import { describe, expect, it } from 'vitest';
import { legacyCanvasNodeAnnotationSource } from './canvas-node-annotation-policy.js';

describe('Legacy Canvas node annotation policy', () => {
  it('selects one exactly representable field without trimming or truncating', () => {
    expect(
      legacyCanvasNodeAnnotationSource({
        text: ' private whitespace ',
        content: 'Canonical content',
        label: 'Unused label',
      }),
    ).toEqual({ key: 'content', text: 'Canonical content' });

    expect(legacyCanvasNodeAnnotationSource({ text: 'X'.repeat(20_001) })).toBeNull();
    expect(legacyCanvasNodeAnnotationSource({ text: '' })).toBeNull();
  });
});
