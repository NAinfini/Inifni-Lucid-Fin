import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../i18n.js', () => ({ t: (key: string) => key }));

import type { Canvas, CanvasNode, EquipmentRef } from '@lucid-fin/contracts';
import {
  buildCanvasClipboardPayload,
  cloneDeep,
  createEntityId,
  findActiveCanvas,
  findCanvasById,
  getAutoEdgeLabel,
  getDefaultNodeFrame,
  normalizeCanvasNodeFrame,
  normalizeCanvasNodeFrames,
  normalizeEquipmentRefs,
  sanitizeTransientNodeStatus,
} from './canvas-helpers.js';
import type { CanvasSliceState } from './canvas.js';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'node-1',
    type: 'image',
    position: { x: 0, y: 0 },
    data: {
      status: 'empty',
      width: 1024,
      height: 1024,
      variants: [],
      selectedVariantIndex: 0,
      variantCount: 1,
      seedLocked: false,
      presetTracks: {} as unknown,
    },
    title: '',
    bypassed: false,
    locked: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  } as CanvasNode;
}

function makeCanvas(overrides: Partial<Canvas> = {}): Canvas {
  return {
    id: 'canvas-1',
    name: 'Test',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getDefaultNodeFrame', () => {
  it('returns dimensions for image type', () => {
    expect(getDefaultNodeFrame('image')).toEqual({ width: 240, height: 180 });
  });

  it('returns dimensions for video type', () => {
    expect(getDefaultNodeFrame('video')).toEqual({ width: 240, height: 180 });
  });

  it('returns dimensions for text type', () => {
    expect(getDefaultNodeFrame('text')).toEqual({ width: 300, height: 200 });
  });

  it('returns dimensions for backdrop type', () => {
    expect(getDefaultNodeFrame('backdrop')).toEqual({ width: 420, height: 240 });
  });

  it('returns undefined for unknown type', () => {
    expect(getDefaultNodeFrame('unknown' as never)).toBeUndefined();
  });
});

describe('normalizeCanvasNodeFrame', () => {
  it('fills in default width/height if missing', () => {
    const node = makeNode({ width: undefined, height: undefined });
    const result = normalizeCanvasNodeFrame(node);
    expect(result.width).toBe(240);
    expect(result.height).toBe(180);
  });

  it('returns same ref if width and height already set', () => {
    const node = makeNode({ width: 500, height: 400 });
    const result = normalizeCanvasNodeFrame(node);
    expect(result).toBe(node);
  });

  it('fills only missing dimension', () => {
    const node = makeNode({ width: 500, height: undefined });
    const result = normalizeCanvasNodeFrame(node);
    expect(result.width).toBe(500);
    expect(result.height).toBe(180);
    expect(result).not.toBe(node);
  });

  it('returns same ref for types with no default frame', () => {
    const node = makeNode({ type: 'unknown' as never });
    const result = normalizeCanvasNodeFrame(node);
    expect(result).toBe(node);
  });
});

describe('normalizeCanvasNodeFrames', () => {
  it('normalizes all nodes that lack dimensions', () => {
    const canvas = makeCanvas({
      nodes: [
        makeNode({ id: 'n1', width: undefined, height: undefined }),
        makeNode({ id: 'n2', width: undefined, height: undefined }),
      ],
    });
    const result = normalizeCanvasNodeFrames(canvas);
    expect(result).not.toBe(canvas);
    expect(result.nodes[0].width).toBe(240);
    expect(result.nodes[1].width).toBe(240);
  });

  it('returns same canvas ref if nothing changed', () => {
    const canvas = makeCanvas({
      nodes: [makeNode({ id: 'n1', width: 240, height: 180 })],
    });
    const result = normalizeCanvasNodeFrames(canvas);
    expect(result).toBe(canvas);
  });

  it('returns same canvas ref for empty nodes array', () => {
    const canvas = makeCanvas({ nodes: [] });
    const result = normalizeCanvasNodeFrames(canvas);
    expect(result).toBe(canvas);
  });
});

describe('sanitizeTransientNodeStatus', () => {
  it('resets generating node with assetHash to done', () => {
    const canvas = makeCanvas({
      nodes: [
        makeNode({
          id: 'n1',
          type: 'image',
          data: {
            status: 'generating',
            assetHash: 'abc123',
            width: 1024,
            height: 1024,
            variants: [],
            selectedVariantIndex: 0,
            variantCount: 1,
            seedLocked: false,
            presetTracks: {} as unknown,
          } as CanvasNode['data'],
        }),
      ],
    });
    const result = sanitizeTransientNodeStatus(canvas);
    expect(result).not.toBe(canvas);
    expect((result.nodes[0].data as { status: string }).status).toBe('done');
  });

  it('resets failed node without assetHash to empty', () => {
    const canvas = makeCanvas({
      nodes: [
        makeNode({
          id: 'n1',
          type: 'image',
          data: {
            status: 'failed',
            width: 1024,
            height: 1024,
            variants: [],
            selectedVariantIndex: 0,
            variantCount: 1,
            seedLocked: false,
            presetTracks: {} as unknown,
          } as CanvasNode['data'],
        }),
      ],
    });
    const result = sanitizeTransientNodeStatus(canvas);
    expect((result.nodes[0].data as { status: string }).status).toBe('empty');
  });

  it('leaves non-generatable nodes unchanged', () => {
    const canvas = makeCanvas({
      nodes: [makeNode({ id: 'n1', type: 'text', data: { content: 'hello' } })],
    });
    const result = sanitizeTransientNodeStatus(canvas);
    expect(result).toBe(canvas);
  });

  it('leaves done nodes unchanged', () => {
    const canvas = makeCanvas({
      nodes: [
        makeNode({
          id: 'n1',
          type: 'image',
          data: {
            status: 'done',
            assetHash: 'hash',
            width: 1024,
            height: 1024,
            variants: [],
            selectedVariantIndex: 0,
            variantCount: 1,
            seedLocked: false,
            presetTracks: {} as unknown,
          } as CanvasNode['data'],
        }),
      ],
    });
    const result = sanitizeTransientNodeStatus(canvas);
    expect(result).toBe(canvas);
  });

  it('clears progress/error/currentStep/jobId on reset', () => {
    const canvas = makeCanvas({
      nodes: [
        makeNode({
          id: 'n1',
          type: 'video',
          data: {
            status: 'generating',
            progress: 0.5,
            error: 'some error',
            currentStep: 'step',
            jobId: 'job-1',
            width: 1280,
            height: 720,
            duration: 5,
            fps: 24,
            variants: [],
            selectedVariantIndex: 0,
            variantCount: 1,
            seedLocked: false,
            presetTracks: {} as unknown,
          } as CanvasNode['data'],
        }),
      ],
    });
    const result = sanitizeTransientNodeStatus(canvas);
    const data = result.nodes[0].data as Record<string, unknown>;
    expect(data.progress).toBeUndefined();
    expect(data.error).toBeUndefined();
    expect(data.currentStep).toBeUndefined();
    expect(data.jobId).toBeUndefined();
  });
});

describe('findActiveCanvas / findCanvasById', () => {
  const canvas1 = makeCanvas({ id: 'c-1' });
  const canvas2 = makeCanvas({ id: 'c-2' });
  const state: CanvasSliceState = {
    canvases: { ids: ['c-1', 'c-2'], entities: { 'c-1': canvas1, 'c-2': canvas2 } },
    activeCanvasId: 'c-1',
    selectedNodeIds: [],
    selectedEdgeIds: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    containerWidth: 800,
    containerHeight: 600,
    clipboard: null,
    loading: false,
  };

  it('findActiveCanvas returns the active canvas', () => {
    expect(findActiveCanvas(state)).toBe(canvas1);
  });

  it('findActiveCanvas returns undefined when no activeCanvasId', () => {
    expect(findActiveCanvas({ ...state, activeCanvasId: null })).toBeUndefined();
  });

  it('findCanvasById returns canvas by id', () => {
    expect(findCanvasById(state, 'c-2')).toBe(canvas2);
  });

  it('findCanvasById returns undefined for null id', () => {
    expect(findCanvasById(state, null)).toBeUndefined();
  });

  it('findCanvasById returns undefined for non-existent id', () => {
    expect(findCanvasById(state, 'not-exist')).toBeUndefined();
  });
});

describe('cloneDeep', () => {
  it('deep clones plain objects', () => {
    const obj = { a: 1, b: { c: [2, 3] } };
    const clone = cloneDeep(obj);
    expect(clone).toEqual(obj);
    expect(clone).not.toBe(obj);
    expect(clone.b).not.toBe(obj.b);
    expect(clone.b.c).not.toBe(obj.b.c);
  });

  it('deep clones arrays', () => {
    const arr = [{ x: 1 }, { x: 2 }];
    const clone = cloneDeep(arr);
    expect(clone).toEqual(arr);
    expect(clone[0]).not.toBe(arr[0]);
  });

  it('handles primitives', () => {
    expect(cloneDeep(42)).toBe(42);
    expect(cloneDeep('hello')).toBe('hello');
    expect(cloneDeep(null)).toBe(null);
  });
});

describe('createEntityId', () => {
  it('returns string starting with node- prefix', () => {
    const id = createEntityId('node');
    expect(id).toMatch(/^node-/);
  });

  it('returns string starting with edge- prefix', () => {
    const id = createEntityId('edge');
    expect(id).toMatch(/^edge-/);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 20 }, () => createEntityId('node')));
    expect(ids.size).toBe(20);
  });
});

describe('getAutoEdgeLabel', () => {
  it('text -> image returns edge.generateImage', () => {
    expect(getAutoEdgeLabel('text', 'image')).toBe('edge.generateImage');
  });

  it('image -> video returns edge.animate', () => {
    expect(getAutoEdgeLabel('image', 'video')).toBe('edge.animate');
  });

  it('text -> video returns edge.generateVideo', () => {
    expect(getAutoEdgeLabel('text', 'video')).toBe('edge.generateVideo');
  });

  it('audio -> image returns edge.addAudio', () => {
    expect(getAutoEdgeLabel('audio', 'image')).toBe('edge.addAudio');
  });

  it('audio -> video returns edge.addAudio', () => {
    expect(getAutoEdgeLabel('audio', 'video')).toBe('edge.addAudio');
  });

  it('text -> audio returns edge.narrate', () => {
    expect(getAutoEdgeLabel('text', 'audio')).toBe('edge.narrate');
  });

  it('image -> image returns edge.reference', () => {
    expect(getAutoEdgeLabel('image', 'image')).toBe('edge.reference');
  });

  it('video -> image returns edge.extractFrame', () => {
    expect(getAutoEdgeLabel('video', 'image')).toBe('edge.extractFrame');
  });

  it('video -> audio returns edge.extractAudio', () => {
    expect(getAutoEdgeLabel('video', 'audio')).toBe('edge.extractAudio');
  });

  it('any -> backdrop returns edge.group', () => {
    expect(getAutoEdgeLabel('image', 'backdrop')).toBe('edge.group');
  });

  it('backdrop -> any returns edge.ungroup', () => {
    expect(getAutoEdgeLabel('backdrop', 'image')).toBe('edge.ungroup');
  });

  it('returns undefined when sourceType is undefined', () => {
    expect(getAutoEdgeLabel(undefined, 'image')).toBeUndefined();
  });

  it('returns undefined when targetType is undefined', () => {
    expect(getAutoEdgeLabel('image', undefined)).toBeUndefined();
  });

  it('returns capitalized fallback for unknown combos', () => {
    expect(getAutoEdgeLabel('audio', 'audio')).toBe('Audio -> Audio');
  });
});

describe('buildCanvasClipboardPayload', () => {
  it('returns null for empty selection', () => {
    const canvas = makeCanvas({ nodes: [makeNode()] });
    expect(buildCanvasClipboardPayload(canvas, [])).toBeNull();
  });

  it('includes only selected nodes', () => {
    const canvas = makeCanvas({
      nodes: [
        makeNode({ id: 'n1' }),
        makeNode({ id: 'n2' }),
        makeNode({ id: 'n3' }),
      ],
      edges: [],
    });
    const result = buildCanvasClipboardPayload(canvas, ['n1', 'n3']);
    expect(result).not.toBeNull();
    expect(result!.nodes).toHaveLength(2);
    expect(result!.nodes.map((n) => n.id)).toEqual(['n1', 'n3']);
  });

  it('includes only internal edges (both endpoints selected)', () => {
    const canvas = makeCanvas({
      nodes: [makeNode({ id: 'n1' }), makeNode({ id: 'n2' }), makeNode({ id: 'n3' })],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2', data: { status: 'idle' as const } },
        { id: 'e2', source: 'n2', target: 'n3', data: { status: 'idle' as const } },
        { id: 'e3', source: 'n1', target: 'n3', data: { status: 'idle' as const } },
      ],
    });
    const result = buildCanvasClipboardPayload(canvas, ['n1', 'n2']);
    expect(result!.edges).toHaveLength(1);
    expect(result!.edges[0].id).toBe('e1');
  });

  it('returns deep cloned nodes', () => {
    const node = makeNode({ id: 'n1' });
    const canvas = makeCanvas({ nodes: [node] });
    const result = buildCanvasClipboardPayload(canvas, ['n1']);
    expect(result!.nodes[0]).toEqual(node);
    expect(result!.nodes[0]).not.toBe(node);
  });

  it('sets sourceCanvasId and version', () => {
    const canvas = makeCanvas({ id: 'my-canvas', nodes: [makeNode({ id: 'n1' })] });
    const result = buildCanvasClipboardPayload(canvas, ['n1']);
    expect(result!.sourceCanvasId).toBe('my-canvas');
    expect(result!.version).toBe(1);
  });
});

describe('normalizeEquipmentRefs', () => {
  it('deduplicates by equipmentId', () => {
    const refs: EquipmentRef[] = [
      { equipmentId: 'eq-1' },
      { equipmentId: 'eq-1', angleSlot: 'front' },
      { equipmentId: 'eq-2' },
    ];
    const result = normalizeEquipmentRefs(refs);
    expect(result).toHaveLength(2);
    expect(result[0].equipmentId).toBe('eq-1');
    expect(result[1].equipmentId).toBe('eq-2');
  });

  it('trims equipmentId whitespace', () => {
    const refs: EquipmentRef[] = [{ equipmentId: '  eq-1  ', angleSlot: 'side' }];
    const result = normalizeEquipmentRefs(refs);
    expect(result[0].equipmentId).toBe('eq-1');
  });

  it('skips entries with empty equipmentId', () => {
    const refs: EquipmentRef[] = [
      { equipmentId: '' },
      { equipmentId: '   ' },
      { equipmentId: 'eq-1' },
    ];
    const result = normalizeEquipmentRefs(refs);
    expect(result).toHaveLength(1);
    expect(result[0].equipmentId).toBe('eq-1');
  });

  it('returns empty array for undefined input', () => {
    expect(normalizeEquipmentRefs(undefined)).toEqual([]);
  });

  it('returns empty array for non-array input', () => {
    expect(normalizeEquipmentRefs(null as unknown as EquipmentRef[])).toEqual([]);
  });

  it('preserves angleSlot and referenceImageHash', () => {
    const refs: EquipmentRef[] = [
      { equipmentId: 'eq-1', angleSlot: 'top', referenceImageHash: 'hash-abc' },
    ];
    const result = normalizeEquipmentRefs(refs);
    expect(result[0]).toEqual({
      equipmentId: 'eq-1',
      angleSlot: 'top',
      referenceImageHash: 'hash-abc',
    });
  });
});
