import { describe, expect, it } from 'vitest';
import type {
  CanvasEdge,
  CanvasNode,
  ImageNodeData,
  TextNodeData,
  AudioNodeData,
  BackdropNodeData,
  PresetDefinition,
} from '@lucid-fin/contracts';
import type { PresetTrackNodeData } from './canvas-flow-types.js';
import {
  localizePresetName,
  firstPresetNameFromCategory,
  cloneDeep,
  shallowDataEqual,
  buildClipboardPayload,
  parseClipboardPayload,
  collectNodeSearchText,
  collectDependencies,
  toFlowNode,
  toFlowEdge,
  minimapNodeColor,
} from './canvas-utils.js';

// ---------------------------------------------------------------------------
// Helpers — minimal node/edge factories
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'n1',
    type: 'text',
    position: { x: 0, y: 0 },
    title: 'Test Node',
    status: 'idle',
    data: { content: 'hello' } as TextNodeData,
    bypassed: false,
    locked: false,
    ...overrides,
  } as CanvasNode;
}

function makeEdge(overrides: Partial<CanvasEdge> = {}): CanvasEdge {
  return {
    id: 'e1',
    source: 'n1',
    target: 'n2',
    data: { status: 'idle' as const },
    ...overrides,
  } as CanvasEdge;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('canvas-utils', () => {
  describe('cloneDeep', () => {
    it('returns a deep copy', () => {
      const obj = { a: 1, nested: { b: 2 } };
      const clone = cloneDeep(obj);
      expect(clone).toEqual(obj);
      expect(clone).not.toBe(obj);
      expect(clone.nested).not.toBe(obj.nested);
    });
  });

  describe('shallowDataEqual', () => {
    it('returns true for identical flat objects', () => {
      const a = { x: 1, y: 'foo', z: true };
      expect(shallowDataEqual(a, a)).toBe(true);
    });

    it('returns true for equal flat objects', () => {
      expect(shallowDataEqual({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true);
    });

    it('returns false when values differ', () => {
      expect(shallowDataEqual({ a: 1 }, { a: 2 })).toBe(false);
    });

    it('returns false when key counts differ', () => {
      expect(shallowDataEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    });

    it('compares by reference for nested objects', () => {
      const inner = { deep: true };
      expect(shallowDataEqual({ a: inner }, { a: inner })).toBe(true);
      expect(shallowDataEqual({ a: inner }, { a: { deep: true } })).toBe(false);
    });
  });

  describe('buildClipboardPayload', () => {
    it('returns null for empty selection', () => {
      const canvas = { id: 'c1', nodes: [makeNode()], edges: [] };
      expect(buildClipboardPayload(canvas, [])).toBeNull();
    });

    it('copies selected nodes and relevant edges', () => {
      const n1 = makeNode({ id: 'n1' });
      const n2 = makeNode({ id: 'n2' });
      const n3 = makeNode({ id: 'n3' });
      const e1 = makeEdge({ id: 'e1', source: 'n1', target: 'n2' });
      const e2 = makeEdge({ id: 'e2', source: 'n2', target: 'n3' });
      const canvas = { id: 'c1', nodes: [n1, n2, n3], edges: [e1, e2] };
      const result = buildClipboardPayload(canvas, ['n1', 'n2']);
      expect(result).not.toBeNull();
      expect(result!.nodes).toHaveLength(2);
      expect(result!.edges).toHaveLength(1); // only e1 (both endpoints selected)
      expect(result!.edges[0].id).toBe('e1');
      // Deep clone check — should not be same reference
      expect(result!.nodes[0]).not.toBe(n1);
    });
  });

  describe('parseClipboardPayload', () => {
    it('returns null for non-JSON', () => {
      expect(parseClipboardPayload('not json')).toBeNull();
    });

    it('returns null for wrong type', () => {
      expect(parseClipboardPayload(JSON.stringify({ type: 'other' }))).toBeNull();
    });

    it('parses valid payload', () => {
      const payload = {
        version: 1,
        sourceCanvasId: 'c1',
        nodes: [],
        edges: [],
        copiedAt: 123,
      };
      const raw = JSON.stringify({ type: 'lucid-canvas-selection', payload });
      expect(parseClipboardPayload(raw)).toEqual(payload);
    });
  });

  describe('collectNodeSearchText', () => {
    it('includes title, status, type for text nodes', () => {
      const node = makeNode({ title: 'My Title', status: 'done', type: 'text' });
      const text = collectNodeSearchText(node);
      expect(text).toContain('my title');
      expect(text).toContain('done');
      expect(text).toContain('text');
      expect(text).toContain('hello'); // content from TextNodeData
    });

    it('includes prompt and provider for image nodes', () => {
      const node = makeNode({
        type: 'image',
        data: {
          prompt: 'a cat',
          providerId: 'openai',
          seed: 42,
        } as unknown as ImageNodeData,
      });
      const text = collectNodeSearchText(node);
      expect(text).toContain('a cat');
      expect(text).toContain('openai');
      expect(text).toContain('42');
    });

    it('includes audioType for audio nodes', () => {
      const node = makeNode({
        type: 'audio',
        data: {
          audioType: 'music',
          prompt: 'lofi beats',
        } as unknown as AudioNodeData,
      });
      const text = collectNodeSearchText(node);
      expect(text).toContain('music');
      expect(text).toContain('lofi beats');
    });

    it('includes color for backdrop nodes', () => {
      const node = makeNode({
        type: 'backdrop',
        data: { color: 'blue' } as unknown as BackdropNodeData,
      });
      const text = collectNodeSearchText(node);
      expect(text).toContain('blue');
    });
  });

  describe('collectDependencies', () => {
    it('returns empty sets when no edges exist', () => {
      const result = collectDependencies([], 'n1');
      expect(result.upstream.size).toBe(0);
      expect(result.downstream.size).toBe(0);
    });

    it('finds direct upstream and downstream', () => {
      const edges = [
        makeEdge({ id: 'e1', source: 'a', target: 'b' }),
        makeEdge({ id: 'e2', source: 'b', target: 'c' }),
      ];
      const result = collectDependencies(edges, 'b');
      expect(result.upstream).toEqual(new Set(['a']));
      expect(result.downstream).toEqual(new Set(['c']));
      expect(result.upstreamEdges).toEqual(new Set(['e1']));
      expect(result.downstreamEdges).toEqual(new Set(['e2']));
    });

    it('traverses transitive dependencies', () => {
      const edges = [
        makeEdge({ id: 'e1', source: 'a', target: 'b' }),
        makeEdge({ id: 'e2', source: 'b', target: 'c' }),
        makeEdge({ id: 'e3', source: 'c', target: 'd' }),
      ];
      const result = collectDependencies(edges, 'b');
      expect(result.upstream).toEqual(new Set(['a']));
      expect(result.downstream).toEqual(new Set(['c', 'd']));
    });

    it('handles cycles without infinite loop', () => {
      const edges = [
        makeEdge({ id: 'e1', source: 'a', target: 'b' }),
        makeEdge({ id: 'e2', source: 'b', target: 'c' }),
        makeEdge({ id: 'e3', source: 'c', target: 'a' }), // cycle
      ];
      const result = collectDependencies(edges, 'b');
      expect(result.upstream).toContain('a');
      expect(result.downstream).toContain('c');
      // c→a is downstream of b, and a is already upstream — both sets should
      // contain their respective nodes without crashing
    });
  });

  describe('toFlowNode', () => {
    const emptyPresets: Record<string, PresetDefinition> = {};

    it('maps a text node correctly', () => {
      const node = makeNode({ id: 'n1', title: 'My Text', type: 'text' });
      const rfNode = toFlowNode(node, emptyPresets, { dependencyRole: null, dimmed: false });
      expect(rfNode.id).toBe('n1');
      expect(rfNode.type).toBe('text');
      expect((rfNode.data as Record<string, unknown>).title).toBe('My Text');
      expect((rfNode.data as Record<string, unknown>).content).toBe('hello');
    });

    it('applies dimmed opacity', () => {
      const node = makeNode({ type: 'text' });
      const rfNode = toFlowNode(node, emptyPresets, { dependencyRole: null, dimmed: true });
      expect((rfNode.style as Record<string, unknown>).opacity).toBe(0.22);
    });

    it('applies dimmed opacity for backdrop type', () => {
      const node = makeNode({
        type: 'backdrop',
        data: { color: 'blue', opacity: 1 } as unknown as BackdropNodeData,
      });
      const rfNode = toFlowNode(node, emptyPresets, { dependencyRole: null, dimmed: true });
      expect((rfNode.style as Record<string, unknown>).opacity).toBe(0.28);
    });

    it('applies dependency boxShadow for upstream', () => {
      const node = makeNode({ type: 'text' });
      const rfNode = toFlowNode(node, emptyPresets, { dependencyRole: 'upstream', dimmed: false });
      expect((rfNode.style as Record<string, unknown>).boxShadow).toContain('rgba(245, 158, 11');
    });

    it('uses default dimensions when node has no explicit size', () => {
      const node = makeNode({ type: 'text', width: undefined, height: undefined });
      const rfNode = toFlowNode(node, emptyPresets, { dependencyRole: null, dimmed: false });
      expect(rfNode.width).toBe(300); // default text width
      expect(rfNode.height).toBe(200); // default text height
    });
  });

  describe('toFlowEdge', () => {
    it('maps edge correctly with label fallback', () => {
      const edge = makeEdge({ id: 'e1', source: 'n1', target: 'n2' });
      const summaries = { n2: 'Camera, Cinematic' };
      const rfEdge = toFlowEdge(edge, summaries, { dependencyRole: null, dimmed: false });
      expect(rfEdge.id).toBe('e1');
      expect(rfEdge.type).toBe('link');
      expect((rfEdge.data as Record<string, unknown>).label).toBe('Camera, Cinematic');
    });

    it('applies dimmed state', () => {
      const edge = makeEdge();
      const rfEdge = toFlowEdge(edge, {}, { dependencyRole: null, dimmed: true });
      expect((rfEdge.data as Record<string, unknown>).dimmed).toBe(true);
    });
  });

  describe('minimapNodeColor', () => {
    it('returns correct colors for each node type', () => {
      expect(minimapNodeColor({ type: 'text' })).toBe('#ffffff');
      expect(minimapNodeColor({ type: 'image' })).toBe('#3b82f6');
      expect(minimapNodeColor({ type: 'video' })).toBe('#a855f7');
      expect(minimapNodeColor({ type: 'audio' })).toBe('#22c55e');
      expect(minimapNodeColor({ type: 'backdrop' })).toBe('#334155');
    });

    it('returns fallback for unknown type', () => {
      expect(minimapNodeColor({ type: 'unknown' })).toBe('hsl(var(--muted-foreground))');
      expect(minimapNodeColor({})).toBe('hsl(var(--muted-foreground))');
    });
  });

  describe('localizePresetName', () => {
    it('returns original name when no translation found', () => {
      // t() returns the key when no translation exists, so localizePresetName
      // should fall back to the original name
      expect(localizePresetName('SomeUnknownPreset')).toBe('SomeUnknownPreset');
    });
  });

  describe('firstPresetNameFromCategory', () => {
    it('returns null when no tracks exist', () => {
      expect(firstPresetNameFromCategory({}, 'camera', {})).toBeNull();
    });

    it('returns null when track has no entries', () => {
      expect(
        firstPresetNameFromCategory(
          { presetTracks: { camera: { category: 'camera', entries: [] } } },
          'camera',
          {},
        ),
      ).toBeNull();
    });

    it('returns preset name for a simple entry', () => {
      const presetById: Record<string, PresetDefinition> = {
        p1: { id: 'p1', name: 'Close Up', category: 'camera' } as PresetDefinition,
      };
      const data = {
        presetTracks: {
          camera: { category: 'camera', entries: [{ presetId: 'p1' }] },
        },
      } as unknown as PresetTrackNodeData;
      expect(firstPresetNameFromCategory(data, 'camera', presetById)).toBe('Close Up');
    });

    it('returns blended name for blend entry', () => {
      const presetById: Record<string, PresetDefinition> = {
        p1: { id: 'p1', name: 'Wide', category: 'camera' } as PresetDefinition,
        p2: { id: 'p2', name: 'Close', category: 'camera' } as PresetDefinition,
      };
      const data = {
        presetTracks: {
          camera: {
            category: 'camera',
            entries: [{
              presetId: 'p1',
              blend: { presetIdB: 'p2', weight: 0.5 },
            }],
          },
        },
      } as unknown as PresetTrackNodeData;
      expect(firstPresetNameFromCategory(data, 'camera', presetById)).toBe('Wide + Close');
    });
  });
});
