import { describe, expect, it } from 'vitest';
import type { Canvas, CanvasNode, ImageNodeData, VideoNodeData } from '@lucid-fin/contracts';
import type { RootState } from '../../index.js';
import {
  selectAllCanvases,
  selectCanvasMetadataList,
  selectActiveCanvas,
  selectActiveCanvasNodes,
  selectNodesById,
  selectNodeById,
  selectSingleSelectedNode,
  selectEntityUsageCounts,
  selectActiveCanvasNodesByType,
  selectActiveCanvasEdges,
} from './canvas-selectors.js';

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
      presetTracks: {},
    } as unknown as ImageNodeData,
    title: '',
    bypassed: false,
    locked: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeCanvas(overrides: Partial<Canvas> = {}): Canvas {
  return {
    id: 'canvas-1',
    name: 'Test Canvas',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makeState(overrides: {
  canvases?: Canvas[];
  activeCanvasId?: string | null;
  selectedNodeIds?: string[];
} = {}): RootState {
  const canvases = overrides.canvases ?? [makeCanvas()];
  return {
    canvas: {
      canvases: {
        ids: canvases.map((c) => c.id),
        entities: Object.fromEntries(canvases.map((c) => [c.id, c])),
      },
      activeCanvasId: 'activeCanvasId' in overrides ? overrides.activeCanvasId! : (canvases[0]?.id ?? null),
      selectedNodeIds: overrides.selectedNodeIds ?? [],
      selectedEdgeIds: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      containerWidth: 800,
      containerHeight: 600,
      clipboard: null,
      loading: false,
    },
  } as unknown as RootState;
}

describe('canvas-selectors', () => {
  describe('selectAllCanvases', () => {
    it('returns all canvases as an array', () => {
      const c1 = makeCanvas({ id: 'c1' });
      const c2 = makeCanvas({ id: 'c2' });
      const state = makeState({ canvases: [c1, c2] });
      const result = selectAllCanvases(state);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('c1');
      expect(result[1].id).toBe('c2');
    });

    it('returns empty array when no canvases', () => {
      const state = makeState({ canvases: [], activeCanvasId: null });
      expect(selectAllCanvases(state)).toEqual([]);
    });
  });

  describe('selectCanvasMetadataList', () => {
    it('returns light metadata with node/edge counts', () => {
      const canvas = makeCanvas({
        id: 'c1',
        name: 'My Canvas',
        nodes: [makeNode({ id: 'n1' }), makeNode({ id: 'n2' })],
        edges: [{ id: 'e1', source: 'n1', target: 'n2', data: { status: 'idle' } }],
        updatedAt: 5000,
      });
      const state = makeState({ canvases: [canvas] });
      const result = selectCanvasMetadataList(state);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 'c1',
        name: 'My Canvas',
        updatedAt: 5000,
        nodeCount: 2,
        edgeCount: 1,
      });
    });
  });

  describe('selectActiveCanvas', () => {
    it('returns the active canvas', () => {
      const c1 = makeCanvas({ id: 'c1' });
      const state = makeState({ canvases: [c1], activeCanvasId: 'c1' });
      expect(selectActiveCanvas(state)).toBe(c1);
    });

    it('returns undefined when no active canvas', () => {
      const state = makeState({ canvases: [makeCanvas()], activeCanvasId: null });
      expect(selectActiveCanvas(state)).toBeUndefined();
    });

    it('returns undefined for non-existent activeCanvasId', () => {
      const state = makeState({ canvases: [makeCanvas()], activeCanvasId: 'missing' });
      expect(selectActiveCanvas(state)).toBeUndefined();
    });
  });

  describe('selectActiveCanvasNodes', () => {
    it('returns nodes of active canvas', () => {
      const nodes = [makeNode({ id: 'n1' }), makeNode({ id: 'n2' })];
      const canvas = makeCanvas({ nodes });
      const state = makeState({ canvases: [canvas] });
      expect(selectActiveCanvasNodes(state)).toBe(nodes);
    });

    it('returns undefined when no active canvas', () => {
      const state = makeState({ canvases: [], activeCanvasId: null });
      expect(selectActiveCanvasNodes(state)).toBeUndefined();
    });
  });

  describe('selectNodesById', () => {
    it('returns Map<nodeId, node>', () => {
      const n1 = makeNode({ id: 'n1' });
      const n2 = makeNode({ id: 'n2' });
      const state = makeState({ canvases: [makeCanvas({ nodes: [n1, n2] })] });
      const map = selectNodesById(state);
      expect(map).toBeInstanceOf(Map);
      expect(map.size).toBe(2);
      expect(map.get('n1')).toBe(n1);
      expect(map.get('n2')).toBe(n2);
    });

    it('returns empty map when no active canvas', () => {
      const state = makeState({ canvases: [], activeCanvasId: null });
      expect(selectNodesById(state).size).toBe(0);
    });
  });

  describe('selectNodeById', () => {
    it('returns node for valid id', () => {
      const n1 = makeNode({ id: 'n1' });
      const state = makeState({ canvases: [makeCanvas({ nodes: [n1] })] });
      expect(selectNodeById(state, 'n1')).toBe(n1);
    });

    it('returns undefined for invalid id', () => {
      const state = makeState({ canvases: [makeCanvas({ nodes: [makeNode()] })] });
      expect(selectNodeById(state, 'missing')).toBeUndefined();
    });

    it('returns undefined for undefined nodeId', () => {
      const state = makeState();
      expect(selectNodeById(state, undefined)).toBeUndefined();
    });
  });

  describe('selectSingleSelectedNode', () => {
    it('returns node when exactly 1 is selected', () => {
      const n1 = makeNode({ id: 'n1' });
      const state = makeState({
        canvases: [makeCanvas({ nodes: [n1, makeNode({ id: 'n2' })] })],
        selectedNodeIds: ['n1'],
      });
      expect(selectSingleSelectedNode(state)).toBe(n1);
    });

    it('returns undefined when 0 selected', () => {
      const state = makeState({
        canvases: [makeCanvas({ nodes: [makeNode()] })],
        selectedNodeIds: [],
      });
      expect(selectSingleSelectedNode(state)).toBeUndefined();
    });

    it('returns undefined when multiple selected', () => {
      const state = makeState({
        canvases: [makeCanvas({ nodes: [makeNode({ id: 'n1' }), makeNode({ id: 'n2' })] })],
        selectedNodeIds: ['n1', 'n2'],
      });
      expect(selectSingleSelectedNode(state)).toBeUndefined();
    });
  });

  describe('selectEntityUsageCounts', () => {
    it('counts character, equipment, and location refs across canvases', () => {
      const n1 = makeNode({
        id: 'n1',
        type: 'image',
        data: {
          status: 'done',
          width: 1024,
          height: 1024,
          variants: [],
          selectedVariantIndex: 0,
          variantCount: 1,
          seedLocked: false,
          presetTracks: {},
          characterRefs: [{ characterId: 'char-1' }, { characterId: 'char-2' }],
          equipmentRefs: [{ equipmentId: 'eq-1' }],
          locationRefs: [{ locationId: 'loc-1' }],
        } as unknown as ImageNodeData,
      });
      const n2 = makeNode({
        id: 'n2',
        type: 'video',
        data: {
          status: 'done',
          width: 1280,
          height: 720,
          duration: 5,
          fps: 24,
          variants: [],
          selectedVariantIndex: 0,
          variantCount: 1,
          seedLocked: false,
          presetTracks: {},
          characterRefs: [{ characterId: 'char-1' }],
          locationRefs: [{ locationId: 'loc-1' }, { locationId: 'loc-2' }],
        } as unknown as VideoNodeData,
      });
      const state = makeState({ canvases: [makeCanvas({ nodes: [n1, n2] })] });
      const counts = selectEntityUsageCounts(state);
      expect(counts.character['char-1']).toBe(2);
      expect(counts.character['char-2']).toBe(1);
      expect(counts.equipment['eq-1']).toBe(1);
      expect(counts.location['loc-1']).toBe(2);
      expect(counts.location['loc-2']).toBe(1);
    });

    it('ignores text and backdrop nodes', () => {
      const textNode = makeNode({ id: 'n1', type: 'text', data: { content: '' } });
      const state = makeState({ canvases: [makeCanvas({ nodes: [textNode] })] });
      const counts = selectEntityUsageCounts(state);
      expect(counts.character).toEqual({});
      expect(counts.equipment).toEqual({});
      expect(counts.location).toEqual({});
    });
  });

  describe('selectActiveCanvasNodesByType', () => {
    it('groups nodes by type', () => {
      const nodes = [
        makeNode({ id: 'n1', type: 'image' }),
        makeNode({ id: 'n2', type: 'text', data: { content: '' } }),
        makeNode({ id: 'n3', type: 'image' }),
      ];
      const state = makeState({ canvases: [makeCanvas({ nodes })] });
      const byType = selectActiveCanvasNodesByType(state);
      expect(byType['image']).toHaveLength(2);
      expect(byType['text']).toHaveLength(1);
    });

    it('returns empty object when no active canvas', () => {
      const state = makeState({ canvases: [], activeCanvasId: null });
      expect(selectActiveCanvasNodesByType(state)).toEqual({});
    });
  });

  describe('selectActiveCanvasEdges', () => {
    it('returns edges of active canvas', () => {
      const edges = [{ id: 'e1', source: 'n1', target: 'n2', data: { status: 'idle' as const } }] as Canvas['edges'];
      const state = makeState({ canvases: [makeCanvas({ edges })] });
      expect(selectActiveCanvasEdges(state)).toBe(edges);
    });
  });
});
