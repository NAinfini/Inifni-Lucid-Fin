import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { defineTool } from '../tools.js';
import { createCatalog } from './catalog.js';

// ── Test fixtures ──────────────────────────────────────────────

const emptyParams = z.object({});
const voidResult = z.void();

async function* noopRun(): AsyncIterable<never> {
  // Yield nothing — unreachable in these tests; we never actually `run` tools.
  if (false as boolean) yield undefined as never;
}

const queryTool = defineTool({
  name: 'test.query',
  version: 1,
  process: 'proc-a',
  category: 'query',
  params: emptyParams,
  result: voidResult,
  run: noopRun,
});

const mutationTool = defineTool({
  name: 'test.mutate',
  version: 1,
  process: 'proc-b',
  category: 'mutation',
  uiEffects: [{ kind: 'toast', message: 'done' }] as const,
  params: emptyParams,
  result: voidResult,
  run: noopRun,
});

const metaTool = defineTool({
  name: 'test.meta',
  version: 1,
  process: 'proc-a',
  category: 'meta',
  params: emptyParams,
  result: voidResult,
  run: noopRun,
});

// ── Tests ──────────────────────────────────────────────────────

describe('createCatalog', () => {
  it('produces an empty catalog when given no tools', () => {
    const catalog = createCatalog([] as const);
    expect(catalog.byKey).toEqual({});
    expect(catalog.byProcess).toEqual({});
    expect(catalog.mutatingKeys).toEqual([]);
    expect(catalog.metaKeys).toEqual([]);
    expect(catalog.uiEffectsByKey).toEqual({});
  });

  it('indexes tools by name', () => {
    const catalog = createCatalog([queryTool, mutationTool] as const);
    expect(Object.keys(catalog.byKey).sort()).toEqual([
      'test.mutate',
      'test.query',
    ]);
    expect(catalog.byKey['test.query']).toBe(queryTool);
    expect(catalog.byKey['test.mutate']).toBe(mutationTool);
  });

  it('groups tools by process', () => {
    const catalog = createCatalog([queryTool, mutationTool, metaTool] as const);
    expect(catalog.byProcess['proc-a']).toEqual([queryTool, metaTool]);
    expect(catalog.byProcess['proc-b']).toEqual([mutationTool]);
  });

  it('separates mutation keys from meta keys', () => {
    const catalog = createCatalog([queryTool, mutationTool, metaTool] as const);
    expect(catalog.mutatingKeys).toEqual(['test.mutate']);
    expect(catalog.metaKeys).toEqual(['test.meta']);
  });

  it('reflects declared uiEffects (empty array when absent)', () => {
    const catalog = createCatalog([queryTool, mutationTool] as const);
    expect(catalog.uiEffectsByKey['test.query']).toEqual([]);
    expect(catalog.uiEffectsByKey['test.mutate']).toEqual([
      { kind: 'toast', message: 'done' },
    ]);
  });

  it('freezes the catalog and all nested containers', () => {
    const catalog = createCatalog([queryTool, mutationTool] as const);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.byKey)).toBe(true);
    expect(Object.isFrozen(catalog.byProcess)).toBe(true);
    expect(Object.isFrozen(catalog.mutatingKeys)).toBe(true);
    expect(Object.isFrozen(catalog.metaKeys)).toBe(true);
    expect(Object.isFrozen(catalog.uiEffectsByKey)).toBe(true);
    expect(Object.isFrozen(catalog.byProcess['proc-a'])).toBe(true);
    expect(Object.isFrozen(catalog.uiEffectsByKey['test.mutate'])).toBe(true);
  });

  it('throws deterministically on duplicate tool names', () => {
    // Two distinct tool objects with the same `name` — createCatalog must
    // reject this loudly rather than silently last-wins, so misconfigured
    // registries fail at construction time (before any handler fires).
    const dup = defineTool({
      name: 'test.query',
      version: 2,
      process: 'proc-a',
      category: 'query',
      params: emptyParams,
      result: voidResult,
      run: noopRun,
    });
    expect(() => createCatalog([queryTool, dup] as const)).toThrow(
      /duplicate tool name "test\.query"/,
    );
  });
});
