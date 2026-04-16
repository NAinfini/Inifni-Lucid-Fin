import { describe, it, expect } from 'vitest';
import { ToolResultCache } from './tool-result-cache.js';
import type { LLMMessage } from '@lucid-fin/contracts';

// Helper: build a minimal ToolResult
function ok(data: unknown) { return { success: true, data }; }
function fail(msg: string) { return { success: false, error: msg }; }

describe('ToolResultCache', () => {
  // ---------- extractListItems ----------
  describe('extractListItems', () => {
    it('finds the first array-valued property, skipping meta keys', () => {
      const cache = new ToolResultCache();
      const data = { total: 5, offset: 0, limit: 50, nodes: [{ id: 'n1' }, { id: 'n2' }] };
      expect(cache.extractListItems(data)).toEqual([{ id: 'n1' }, { id: 'n2' }]);
    });

    it('returns empty for non-objects', () => {
      const cache = new ToolResultCache();
      expect(cache.extractListItems(null)).toEqual([]);
      expect(cache.extractListItems('string')).toEqual([]);
    });

    it('returns empty when no array property found', () => {
      const cache = new ToolResultCache();
      expect(cache.extractListItems({ total: 5, success: true })).toEqual([]);
    });
  });

  // ---------- extractEntityKey ----------
  describe('extractEntityKey', () => {
    it('prefers id over hash over code', () => {
      const cache = new ToolResultCache();
      expect(cache.extractEntityKey({ id: 'abc', hash: 'def' })).toBe('abc');
      expect(cache.extractEntityKey({ hash: 'def', code: 'ghi' })).toBe('def');
      expect(cache.extractEntityKey({ code: 'ghi' })).toBe('ghi');
    });

    it('returns singleton for objects without known keys', () => {
      const cache = new ToolResultCache();
      expect(cache.extractEntityKey({ name: 'test' })).toBe('singleton');
      expect(cache.extractEntityKey(null)).toBe('singleton');
    });
  });

  // ---------- buildListCacheKey ----------
  describe('buildListCacheKey', () => {
    it('returns just toolName when no non-pagination args', () => {
      const cache = new ToolResultCache();
      expect(cache.buildListCacheKey('canvas.listNodes', { offset: 0, limit: 50 })).toBe('canvas.listNodes');
    });

    it('includes sorted non-pagination args', () => {
      const cache = new ToolResultCache();
      const key = cache.buildListCacheKey('equipment.list', { type: 'weapon', offset: 0 });
      expect(key).toBe('equipment.list?type="weapon"');
    });
  });

  // ---------- absorbResult ----------
  describe('absorbResult', () => {
    it('absorbs get results for classified tools', () => {
      const cache = new ToolResultCache();
      const absorbed = cache.absorbResult('canvas.getNode', {}, ok({ id: 'n1', type: 'image' }), 1);
      expect(absorbed).toBe(true);
      expect(cache.entryCount).toBe(1);
      expect(cache.sizeChars).toBeGreaterThan(0);
    });

    it('absorbs list results by merging items', () => {
      const cache = new ToolResultCache();
      // Page 1
      cache.absorbResult('canvas.listNodes', { offset: 0, limit: 2 },
        ok({ total: 4, offset: 0, limit: 2, nodes: [{ id: 'n1' }, { id: 'n2' }] }), 1);
      // Page 2
      cache.absorbResult('canvas.listNodes', { offset: 2, limit: 2 },
        ok({ total: 4, offset: 2, limit: 2, nodes: [{ id: 'n3' }, { id: 'n4' }] }), 2);

      expect(cache.entryCount).toBe(1); // One list entry, not two
      const serialized = cache.serialize();
      expect(serialized).toContain('n1');
      expect(serialized).toContain('n3');
      expect(serialized).toContain('n4');
    });

    it('skips unclassified tools', () => {
      const cache = new ToolResultCache();
      const absorbed = cache.absorbResult('unknown.tool', {}, ok({ id: 'x' }), 1);
      expect(absorbed).toBe(false);
      expect(cache.entryCount).toBe(0);
    });

    it('skips failed results', () => {
      const cache = new ToolResultCache();
      const absorbed = cache.absorbResult('canvas.getNode', {}, fail('not found'), 1);
      expect(absorbed).toBe(false);
    });

    it('skips mutation tools', () => {
      const cache = new ToolResultCache();
      const absorbed = cache.absorbResult('canvas.addNode', {}, ok({ id: 'n1' }), 1);
      expect(absorbed).toBe(false);
    });

    it('absorbs array data from get tools', () => {
      const cache = new ToolResultCache();
      cache.absorbResult('canvas.readNodePresetTracks', {},
        ok([{ id: 'track1' }, { id: 'track2' }]), 1);
      expect(cache.entryCount).toBe(2);
    });

    it('uses singleton key for entities without id/hash/code', () => {
      const cache = new ToolResultCache();
      cache.absorbResult('canvas.getState', {}, ok({ name: 'Canvas 1', nodeCount: 5 }), 1);
      expect(cache.entryCount).toBe(1);
      expect(cache.serialize()).toContain('Canvas 1');
    });

    it('updates existing entity on re-fetch', () => {
      const cache = new ToolResultCache();
      cache.absorbResult('canvas.getNode', {}, ok({ id: 'n1', status: 'empty' }), 1);
      cache.absorbResult('canvas.getNode', {}, ok({ id: 'n1', status: 'ready' }), 2);
      expect(cache.entryCount).toBe(1);
      expect(cache.serialize()).toContain('ready');
      expect(cache.serialize()).not.toContain('empty');
    });
  });

  // ---------- invalidation ----------
  describe('invalidation', () => {
    it('invalidates by domain prefix', () => {
      const cache = new ToolResultCache();
      cache.absorbResult('canvas.getNode', {}, ok({ id: 'n1' }), 1);
      cache.absorbResult('canvas.getState', {}, ok({ name: 'C1' }), 1);
      cache.absorbResult('character.list', {},
        ok({ total: 1, characters: [{ id: 'c1' }] }), 1);

      cache.invalidateForMutation('canvas.updateNodeData');

      // Canvas entries should be gone
      expect(cache.serialize()).not.toContain('n1');
      // Character entries should remain
      expect(cache.serialize()).toContain('c1');
    });

    it('clearAll removes everything', () => {
      const cache = new ToolResultCache();
      cache.absorbResult('canvas.getNode', {}, ok({ id: 'n1' }), 1);
      cache.absorbResult('character.list', {},
        ok({ total: 1, characters: [{ id: 'c1' }] }), 1);

      cache.clearAll();
      expect(cache.entryCount).toBe(0);
      expect(cache.sizeChars).toBe(0);
    });
  });

  // ---------- resolveToolName ----------
  describe('resolveToolName', () => {
    it('resolves tool name from assistant toolCalls', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: '', toolCalls: [
          { id: 'tc1', name: 'canvas.getNode', arguments: { id: 'n1' } },
        ]},
        { role: 'tool', content: '{"success":true}', toolCallId: 'tc1' },
      ];
      expect(ToolResultCache.resolveToolName(messages, 3)).toBe('canvas.getNode');
    });

    it('returns undefined for orphan tool messages', () => {
      const messages: LLMMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'tool', content: '{}', toolCallId: 'orphan' },
      ];
      expect(ToolResultCache.resolveToolName(messages, 1)).toBeUndefined();
    });
  });

  // ---------- processRound ----------
  describe('processRound', () => {
    it('stubs older tool results that are cached', () => {
      const cache = new ToolResultCache();
      const bigResult = JSON.stringify({ success: true, data: { id: 'n1', description: 'x'.repeat(200) } });
      const messages: LLMMessage[] = [
        { role: 'system', content: 'sys' },
        // Round 1 (old)
        { role: 'assistant', content: '', toolCalls: [
          { id: 'tc1', name: 'canvas.getNode', arguments: { id: 'n1' } },
        ]},
        { role: 'tool', content: bigResult, toolCallId: 'tc1' },
        // Round 2 (latest)
        { role: 'assistant', content: '', toolCalls: [
          { id: 'tc2', name: 'canvas.getNode', arguments: { id: 'n2' } },
        ]},
        { role: 'tool', content: bigResult, toolCallId: 'tc2' },
      ];

      // Absorb both results
      cache.absorbResult('canvas.getNode', { id: 'n1' }, { success: true, data: { id: 'n1' } }, 1);
      cache.absorbResult('canvas.getNode', { id: 'n2' }, { success: true, data: { id: 'n2' } }, 2);

      cache.processRound(messages, 2);

      // Round 1 tool result should be stubbed
      expect(messages[2].content).toBe('{"_cached":true}');
      // Round 2 (latest) should NOT be stubbed
      expect(messages[4].content).toBe(bigResult);
    });

    it('preserves short tool results', () => {
      const cache = new ToolResultCache();
      const shortResult = '{"success":true}';
      const messages: LLMMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: '', toolCalls: [
          { id: 'tc1', name: 'canvas.getNode', arguments: {} },
        ]},
        { role: 'tool', content: shortResult, toolCallId: 'tc1' },
        { role: 'assistant', content: '', toolCalls: [
          { id: 'tc2', name: 'canvas.getNode', arguments: {} },
        ]},
        { role: 'tool', content: shortResult, toolCallId: 'tc2' },
      ];

      cache.processRound(messages, 2);
      // Short results should NOT be stubbed
      expect(messages[2].content).toBe(shortResult);
    });

    it('invalidates cache for mutation tools in current round', () => {
      const cache = new ToolResultCache();
      cache.absorbResult('canvas.getNode', {}, ok({ id: 'n1' }), 1);
      expect(cache.entryCount).toBe(1);

      const messages: LLMMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: '', toolCalls: [
          { id: 'tc1', name: 'canvas.updateNodeData', arguments: {} },
        ]},
        { role: 'tool', content: '{"success":true}', toolCallId: 'tc1' },
      ];

      cache.processRound(messages, 2);
      // Canvas domain should be invalidated
      expect(cache.entryCount).toBe(0);
    });

    it('clears all on snapshot.restore', () => {
      const cache = new ToolResultCache();
      cache.absorbResult('canvas.getNode', {}, ok({ id: 'n1' }), 1);
      cache.absorbResult('character.list', {},
        ok({ total: 1, characters: [{ id: 'c1' }] }), 1);

      const messages: LLMMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: '', toolCalls: [
          { id: 'tc1', name: 'snapshot.restore', arguments: {} },
        ]},
        { role: 'tool', content: '{"success":true}', toolCallId: 'tc1' },
      ];

      cache.processRound(messages, 2);
      expect(cache.entryCount).toBe(0);
    });
  });

  // ---------- warmFromHistory ----------
  describe('warmFromHistory', () => {
    it('absorbs parseable tool results from history', () => {
      const cache = new ToolResultCache();
      const messages: LLMMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: '', toolCalls: [
          { id: 'tc1', name: 'canvas.getNode', arguments: { id: 'n1' } },
        ]},
        { role: 'tool', content: JSON.stringify({ success: true, data: { id: 'n1', type: 'image' } }), toolCallId: 'tc1' },
      ];

      cache.warmFromHistory(messages);
      expect(cache.entryCount).toBe(1);
    });

    it('skips stubs', () => {
      const cache = new ToolResultCache();
      const messages: LLMMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'assistant', content: '', toolCalls: [
          { id: 'tc1', name: 'canvas.getNode', arguments: {} },
        ]},
        { role: 'tool', content: '{"_cached":true}', toolCallId: 'tc1' },
      ];

      cache.warmFromHistory(messages);
      expect(cache.entryCount).toBe(0);
    });

    it('skips unresolvable tool messages', () => {
      const cache = new ToolResultCache();
      const messages: LLMMessage[] = [
        { role: 'system', content: 'sys' },
        { role: 'tool', content: '{"success":true,"data":{"id":"n1"}}', toolCallId: 'orphan' },
      ];

      cache.warmFromHistory(messages);
      expect(cache.entryCount).toBe(0);
    });
  });

  // ---------- serialize ----------
  describe('serialize', () => {
    it('returns empty string when cache is empty', () => {
      const cache = new ToolResultCache();
      expect(cache.serialize()).toBe('');
    });

    it('groups by domain and produces readable output', () => {
      const cache = new ToolResultCache();
      cache.absorbResult('canvas.getNode', {}, ok({ id: 'n1', type: 'image' }), 1);
      cache.absorbResult('character.list', {},
        ok({ total: 1, characters: [{ id: 'c1', name: 'Alice' }] }), 1);

      const output = cache.serialize();
      expect(output).toContain('[Entity Cache');
      expect(output).toContain('### canvas');
      expect(output).toContain('### character');
      expect(output).toContain('n1');
      expect(output).toContain('Alice');
    });

    it('keeps a single canonical copy when an item exists in both entity and list cache', () => {
      const cache = new ToolResultCache();
      cache.absorbResult('canvas.getNode', { nodeId: 'n1' }, ok({ id: 'n1', title: 'Alpha' }), 1);
      cache.absorbResult(
        'canvas.listNodes',
        {},
        ok({ total: 2, nodes: [{ id: 'n1', title: 'Alpha' }, { id: 'n2', title: 'Beta' }] }),
        1,
      );

      const output = cache.serialize();
      expect(output.match(/"title":"Alpha"/g)?.length ?? 0).toBe(1);
      expect(output).toContain('"itemRefs":["n1","n2"]');
    });
  });

  // ---------- eviction ----------
  describe('eviction', () => {
    it('evicts oldest entries when over budget', () => {
      const cache = new ToolResultCache();
      // Fill with large entries
      const largeData = { id: 'placeholder', payload: 'x'.repeat(20000) };
      for (let i = 0; i < 10; i++) {
        cache.absorbResult('canvas.getNode', {},
          ok({ ...largeData, id: `n${i}` }), i);
      }
      // Should have evicted some old entries
      expect(cache.sizeChars).toBeLessThanOrEqual(ToolResultCache.MAX_CACHE_CHARS);
    });
  });

  // ---------- filtered list cache keys ----------
  describe('filtered list cache keys', () => {
    it('stores different cache entries for different filter params', () => {
      const cache = new ToolResultCache();
      cache.absorbResult('equipment.list', { type: 'weapon' },
        ok({ total: 1, equipment: [{ id: 'e1', type: 'weapon' }] }), 1);
      cache.absorbResult('equipment.list', { type: 'armor' },
        ok({ total: 1, equipment: [{ id: 'e2', type: 'armor' }] }), 1);

      expect(cache.entryCount).toBe(2); // Two separate list entries
    });
  });
});
