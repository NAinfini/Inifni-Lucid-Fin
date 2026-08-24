import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '@lucid-fin/contracts';
import { computeBackdropContainment } from './backdrop-containment.js';

function node(
  id: string,
  type: CanvasNode['type'],
  x: number,
  y: number,
  width: number,
  height: number,
  collapsed = false,
): CanvasNode {
  return {
    id,
    type,
    title: id,
    position: { x, y },
    width,
    height,
    data: type === 'backdrop' ? { collapsed } : {},
    bypassed: false,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
  } as CanvasNode;
}

describe('computeBackdropContainment', () => {
  it('preserves overlapping, collapsed, negative-coordinate, and giant backdrop semantics', () => {
    const result = computeBackdropContainment([
      node('backdrop-a', 'backdrop', -200, -100, 500, 400, true),
      node('backdrop-b', 'backdrop', 0, 0, 500, 400),
      node('backdrop-giant', 'backdrop', -10_000, -10_000, 20_000, 20_000),
      node('inside-both', 'image', 25, 25, 100, 100),
      node('inside-a', 'text', -175, -75, 50, 50),
      node('outside-small', 'video', 1_000, 1_000, 100, 100),
    ]);

    expect(Object.fromEntries(result.backdropChildCounts)).toEqual({
      'backdrop-a': 2,
      'backdrop-b': 1,
      'backdrop-giant': 3,
    });
    expect([...result.hiddenNodeIds]).toEqual(['inside-both', 'inside-a']);
  });
});
