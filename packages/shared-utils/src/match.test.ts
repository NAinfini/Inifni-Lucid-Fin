import { describe, it, expect } from 'vitest';
import { match, matchKind, matchParams } from './match.js';

type Event =
  | { type: 'click'; x: number; y: number }
  | { type: 'keydown'; key: string };

describe('match', () => {
  it('dispatches by the supplied tag', () => {
    const evt: Event = { type: 'click', x: 1, y: 2 };
    const label = match(evt, 'type', {
      click: (e) => `click ${e.x},${e.y}`,
      keydown: (e) => `key ${e.key}`,
    });
    expect(label).toBe('click 1,2');
  });

  it('throws with context when the tag is absent at runtime', () => {
    const evt = { type: 'scroll' } as unknown as Event;
    expect(() =>
      match(evt, 'type', {
        click: () => 'c',
        keydown: () => 'k',
      } as never),
    ).toThrow(/type=scroll/);
  });
});

type Node = { kind: 'text'; content: string } | { kind: 'image'; src: string };

describe('matchKind', () => {
  it('uses kind as the conventional discriminant', () => {
    const node: Node = { kind: 'image', src: '/a.png' };
    const out = matchKind(node, {
      text: (n) => `text:${n.content}`,
      image: (n) => `image:${n.src}`,
    });
    expect(out).toBe('image:/a.png');
  });
});

type Params =
  | { mode: 'create'; name: string }
  | { mode: 'update'; id: string; patch: Record<string, unknown> };

describe('matchParams', () => {
  it('uses mode for tool-style DUs', () => {
    const p: Params = { mode: 'update', id: 'x', patch: { a: 1 } };
    const summary = matchParams(p, {
      create: (x) => `create ${x.name}`,
      update: (x) => `update ${x.id}`,
    });
    expect(summary).toBe('update x');
  });
});
