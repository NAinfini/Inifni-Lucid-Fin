import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../src/cascade.js';

describe('DependencyGraph', () => {
  describe('addNode / removeNode', () => {
    it('adds and retrieves nodes', () => {
      const g = new DependencyGraph();
      g.addNode('a', 'character');
      expect(g.getNode('a')).toBeDefined();
      expect(g.getNode('a')!.type).toBe('character');
    });

    it('ignores duplicate addNode', () => {
      const g = new DependencyGraph();
      g.addNode('a', 'character');
      g.addNode('a', 'style'); // should not overwrite
      expect(g.getNode('a')!.type).toBe('character');
    });

    it('removes node and cleans edges', () => {
      const g = new DependencyGraph();
      g.addNode('a', 'character');
      g.addNode('b', 'keyframe');
      g.addEdge('a', 'b');
      g.removeNode('a');
      expect(g.getNode('a')).toBeUndefined();
      expect(g.getUpstream('b')).toHaveLength(0);
    });
  });

  describe('addEdge / removeEdge', () => {
    it('creates upstream/downstream relationship', () => {
      const g = new DependencyGraph();
      g.addNode('a', 'character');
      g.addNode('b', 'keyframe');
      expect(g.addEdge('a', 'b')).toBe(true);
      expect(g.getDownstream('a').map((n) => n.id)).toContain('b');
      expect(g.getUpstream('b').map((n) => n.id)).toContain('a');
    });

    it('rejects self-loops', () => {
      const g = new DependencyGraph();
      g.addNode('a', 'character');
      expect(g.addEdge('a', 'a')).toBe(false);
    });

    it('rejects cycles', () => {
      const g = new DependencyGraph();
      g.addNode('a', 'character');
      g.addNode('b', 'keyframe');
      g.addNode('c', 'segment');
      g.addEdge('a', 'b');
      g.addEdge('b', 'c');
      expect(g.addEdge('c', 'a')).toBe(false); // would create cycle
    });

    it('returns false for missing nodes', () => {
      const g = new DependencyGraph();
      g.addNode('a', 'character');
      expect(g.addEdge('a', 'missing')).toBe(false);
    });

    it('removes edge cleanly', () => {
      const g = new DependencyGraph();
      g.addNode('a', 'character');
      g.addNode('b', 'keyframe');
      g.addEdge('a', 'b');
      g.removeEdge('a', 'b');
      expect(g.getDownstream('a')).toHaveLength(0);
      expect(g.getUpstream('b')).toHaveLength(0);
    });
  });

  describe('markChanged / staleness', () => {
    it('propagates staleness downstream', () => {
      const g = new DependencyGraph();
      g.addNode('char', 'character');
      g.addNode('kf', 'keyframe');
      g.addNode('seg', 'segment');
      g.addEdge('char', 'kf');
      g.addEdge('kf', 'seg');

      const affected = g.markChanged('char');
      expect(affected).toEqual(['kf', 'seg']);
      expect(g.getNode('kf')!.stale).toBe(true);
      expect(g.getNode('seg')!.stale).toBe(true);
      expect(g.getNode('char')!.stale).toBe(false); // source not stale
    });

    it('returns empty for unknown node', () => {
      const g = new DependencyGraph();
      expect(g.markChanged('nope')).toEqual([]);
    });

    it('logs cascade events', () => {
      const g = new DependencyGraph();
      g.addNode('a', 'character');
      g.addNode('b', 'keyframe');
      g.addEdge('a', 'b');
      g.markChanged('a');
      const events = g.getEventLog();
      expect(events).toHaveLength(1);
      expect(events[0].sourceId).toBe('a');
      expect(events[0].affectedIds).toEqual(['b']);
    });
  });

  describe('markFresh', () => {
    it('clears stale flag', () => {
      const g = new DependencyGraph();
      g.addNode('a', 'character');
      g.addNode('b', 'keyframe');
      g.addEdge('a', 'b');
      g.markChanged('a');
      expect(g.getNode('b')!.stale).toBe(true);
      g.markFresh('b');
      expect(g.getNode('b')!.stale).toBe(false);
    });

    it('batch clears stale flags', () => {
      const g = new DependencyGraph();
      g.addNode('a', 'character');
      g.addNode('b', 'keyframe');
      g.addNode('c', 'segment');
      g.addEdge('a', 'b');
      g.addEdge('a', 'c');
      g.markChanged('a');
      g.markFreshBatch(['b', 'c']);
      expect(g.getStaleNodes()).toHaveLength(0);
    });
  });

  describe('getStaleByType', () => {
    it('groups stale nodes by type', () => {
      const g = new DependencyGraph();
      g.addNode('a', 'character');
      g.addNode('b', 'keyframe');
      g.addNode('c', 'segment');
      g.addEdge('a', 'b');
      g.addEdge('a', 'c');
      g.markChanged('a');
      const byType = g.getStaleByType();
      expect(byType.get('keyframe')).toHaveLength(1);
      expect(byType.get('segment')).toHaveLength(1);
      expect(byType.has('character')).toBe(false);
    });
  });

  describe('serialize / deserialize', () => {
    it('round-trips the graph', () => {
      const g = new DependencyGraph();
      g.addNode('a', 'character');
      g.addNode('b', 'keyframe');
      g.addEdge('a', 'b');
      g.markChanged('a');

      const data = g.serialize();
      const g2 = DependencyGraph.deserialize(data);

      expect(g2.getNode('a')!.type).toBe('character');
      expect(g2.getNode('b')!.stale).toBe(true);
      expect(g2.getDownstream('a').map((n) => n.id)).toContain('b');
      expect(g2.getUpstream('b').map((n) => n.id)).toContain('a');
    });
  });

  describe('getAllNodes', () => {
    it('returns all registered nodes', () => {
      const g = new DependencyGraph();
      g.addNode('a', 'character');
      g.addNode('b', 'keyframe');
      expect(g.getAllNodes()).toHaveLength(2);
    });
  });
});
