/**
 * ContextGraph tests — Phase G2a-2.
 */

import { describe, it, expect } from 'vitest';
import { ContextGraph } from './context-graph.js';
import type { ContextItem, ContextItemId, EntityRef } from '@lucid-fin/contracts';
import { freshContextItemId } from '@lucid-fin/contracts-parse';
import type { ToolKey } from '@lucid-fin/contracts';

// ── Helpers ────────────────────────────────────────────────────

function mkId(): ContextItemId {
  return freshContextItemId();
}

function mkUserMessage(step = 0, content = 'Hello'): ContextItem {
  return { kind: 'user-message', itemId: mkId(), producedAtStep: step, content };
}

function mkAssistantTurn(step = 1, content = 'World'): ContextItem {
  return { kind: 'assistant-turn', itemId: mkId(), producedAtStep: step, content };
}

function mkToolResult(
  toolKey: string,
  paramsHash: string,
  step = 1,
  content: unknown = { success: true },
  entityRef?: EntityRef,
  toolCallId?: string,
): ContextItem {
  return {
    kind: 'tool-result',
    itemId: mkId(),
    producedAtStep: step,
    toolKey: toolKey as ToolKey,
    paramsHash,
    content,
    schemaVersion: 1,
    entityRef,
    toolCallId,
  };
}

function mkEntitySnapshot(ref: EntityRef, step = 1, snapshot: unknown = {}): ContextItem {
  return { kind: 'entity-snapshot', itemId: mkId(), producedAtStep: step, entityRef: ref, snapshot };
}

function mkGuide(guideKey: string, content = 'Do this.'): ContextItem {
  return { kind: 'guide', itemId: mkId(), producedAtStep: 0, guideKey, content };
}

// ── Tests ──────────────────────────────────────────────────────

describe('ContextGraph', () => {
  describe('add and get', () => {
    it('adds and retrieves an item by id', () => {
      const graph = new ContextGraph();
      const item = mkUserMessage(0, 'hello');
      graph.add(item);
      expect(graph.get(item.itemId)).toStrictEqual(item);
    });

    it('size reflects number of items', () => {
      const graph = new ContextGraph();
      expect(graph.size().items).toBe(0);
      graph.add(mkUserMessage());
      expect(graph.size().items).toBe(1);
      graph.add(mkAssistantTurn());
      expect(graph.size().items).toBe(2);
    });

    it('get returns undefined for unknown id', () => {
      const graph = new ContextGraph();
      expect(graph.get('nonexistent' as ContextItemId)).toBeUndefined();
    });
  });

  describe('findLatest', () => {
    it('finds the most recent item of a kind matching predicate', () => {
      const graph = new ContextGraph();
      const m1 = mkUserMessage(0, 'first');
      const m2 = mkUserMessage(1, 'second');
      graph.add(m1);
      graph.add(m2);
      const found = graph.findLatest('user-message', (i) => i.content === 'first');
      expect(found?.itemId).toBe(m1.itemId);
    });

    it('returns the latest if multiple match', () => {
      const graph = new ContextGraph();
      const m1 = mkUserMessage(0, 'hi');
      const m2 = mkUserMessage(1, 'hi');
      graph.add(m1);
      graph.add(m2);
      const found = graph.findLatest('user-message', (i) => i.content === 'hi');
      expect(found?.itemId).toBe(m2.itemId);
    });

    it('returns undefined when no item matches', () => {
      const graph = new ContextGraph();
      graph.add(mkUserMessage(0, 'hello'));
      const found = graph.findLatest('user-message', (i) => i.content === 'nonexistent');
      expect(found).toBeUndefined();
    });
  });

  describe('tool-result dedup', () => {
    it('supersedes an earlier tool-result with same toolKey+paramsHash', () => {
      const graph = new ContextGraph();
      const old = mkToolResult('character.get', 'hash1', 1, { id: 'c1', name: 'Alice' });
      const newer = mkToolResult('character.get', 'hash1', 2, { id: 'c1', name: 'Alice (updated)' });
      graph.add(old);
      graph.add(newer);
      // old item must be gone
      expect(graph.get(old.itemId)).toBeUndefined();
      // newer item must be present
      expect(graph.get(newer.itemId)).toBeDefined();
      // size stays 1
      expect(graph.size().items).toBe(1);
    });

    it('keeps two tool-results with different paramsHash', () => {
      const graph = new ContextGraph();
      const r1 = mkToolResult('character.get', 'hash1', 1);
      const r2 = mkToolResult('character.get', 'hash2', 2);
      graph.add(r1);
      graph.add(r2);
      expect(graph.size().items).toBe(2);
    });

    it('keeps two tool-results with different toolKey', () => {
      const graph = new ContextGraph();
      const r1 = mkToolResult('character.get', 'hash1', 1);
      const r2 = mkToolResult('location.get', 'hash1', 2);
      graph.add(r1);
      graph.add(r2);
      expect(graph.size().items).toBe(2);
    });
  });

  describe('invalidateByEntity', () => {
    const charRef: EntityRef = { entityType: 'character', entityId: 'c1' };

    it('drops entity-snapshot items for the ref', () => {
      const graph = new ContextGraph();
      const snap = mkEntitySnapshot(charRef, 1, { name: 'Alice' });
      const other = mkEntitySnapshot({ entityType: 'location', entityId: 'l1' }, 2);
      graph.add(snap);
      graph.add(other);
      const dropped = graph.invalidateByEntity(charRef);
      expect(dropped).toContain(snap.itemId);
      expect(graph.get(snap.itemId)).toBeUndefined();
      expect(graph.get(other.itemId)).toBeDefined();
    });

    it('cascades to tool-result items with matching entityRef', () => {
      const graph = new ContextGraph();
      const result = mkToolResult('character.get', 'h1', 1, {}, charRef);
      graph.add(result);
      const dropped = graph.invalidateByEntity(charRef);
      expect(dropped).toContain(result.itemId);
      expect(graph.get(result.itemId)).toBeUndefined();
    });

    it('does not drop tool-results with different entityRef', () => {
      const graph = new ContextGraph();
      const result = mkToolResult('location.get', 'h2', 1, {}, { entityType: 'location', entityId: 'l1' });
      graph.add(result);
      const dropped = graph.invalidateByEntity(charRef);
      expect(dropped).toHaveLength(0);
      expect(graph.get(result.itemId)).toBeDefined();
    });

    it('does not drop tool-results without entityRef', () => {
      const graph = new ContextGraph();
      const result = mkToolResult('canvas.getState', 'h3', 1);
      graph.add(result);
      const dropped = graph.invalidateByEntity(charRef);
      expect(dropped).toHaveLength(0);
    });
  });

  describe('serialize and hydrate', () => {
    it('round-trips all items in insertion order', () => {
      const graph = new ContextGraph();
      const u = mkUserMessage(0);
      const a = mkAssistantTurn(1);
      const g = mkGuide('workflow-1');
      graph.add(u);
      graph.add(a);
      graph.add(g);

      const items = graph.serialize();
      expect(items).toHaveLength(3);
      expect(items[0]!.itemId).toBe(u.itemId);
      expect(items[1]!.itemId).toBe(a.itemId);
      expect(items[2]!.itemId).toBe(g.itemId);

      const restored = ContextGraph.hydrate(items);
      expect(restored.size().items).toBe(3);
      expect(restored.get(u.itemId)).toStrictEqual(u);
    });

    it('hydrate rebuilds tool-result dedup index', () => {
      const graph = new ContextGraph();
      const old = mkToolResult('character.get', 'h1', 1, { name: 'v1' });
      const newer = mkToolResult('character.get', 'h1', 2, { name: 'v2' });
      graph.add(old);
      graph.add(newer);

      const items = graph.serialize();
      const restored = ContextGraph.hydrate(items);
      // Only the newer item should be present
      expect(restored.size().items).toBe(1);
      expect(restored.get(newer.itemId)).toBeDefined();
    });
  });

  describe('size', () => {
    it('estimates chars from content', () => {
      const graph = new ContextGraph();
      graph.add({ kind: 'user-message', itemId: mkId(), producedAtStep: 0, content: 'hello' });
      expect(graph.size().chars).toBe(5);
      expect(graph.size().tokens).toBeGreaterThan(0);
    });
  });
});
