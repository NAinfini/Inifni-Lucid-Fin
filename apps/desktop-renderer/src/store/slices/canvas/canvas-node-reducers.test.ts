import { describe, expect, it, vi } from 'vitest';
import type {
  Canvas,
  CanvasEdge,
  CanvasNode,
  CanvasNodeData,
  ImageNodeData,
  VideoNodeData,
} from '@lucid-fin/contracts';
import type { EntityState } from '@reduxjs/toolkit';
import type { CanvasSliceState } from './canvas.js';
import {
  addNode,
  removeNodes,
  updateNode,
  updateNodeData,
  moveNode,
  moveNodes,
  renameNode,
  toggleBypass,
  setNodeColorTag,
  toggleLock,
  toggleBackdropCollapse,
  setBackdropOpacity,
  setBackdropColor,
  setNodeProvider,
  setNodeVariantCount,
  setNodeUploadedAsset,
  clearNodeAsset,
  setVideoFrameNode,
  restoreNodes,
} from './canvas-node-reducers.js';

vi.mock('../../../i18n.js', () => ({ t: (key: string) => key }));

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

function makeEdge(
  overrides: Partial<CanvasEdge> & { id: string; source: string; target: string },
): CanvasEdge {
  return {
    data: { status: 'idle' as const, label: '' },
    ...overrides,
  };
}

function makeState(canvas?: Canvas): CanvasSliceState {
  const c = canvas ?? makeCanvas();
  return {
    canvases: {
      ids: [c.id],
      entities: { [c.id]: c },
    } as EntityState<Canvas, string>,
    activeCanvasId: c.id,
    selectedNodeIds: [],
    selectedEdgeIds: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    containerWidth: 800,
    containerHeight: 600,
    clipboard: null,
    loading: false,
  };
}

function action<T>(payload: T) {
  return { type: 'test', payload } as { type: string; payload: T };
}

describe('canvas-node-reducers', () => {
  describe('addNode', () => {
    it('adds a node to the active canvas', () => {
      const state = makeState();
      addNode(state, action({ type: 'image' as const, position: { x: 10, y: 20 }, id: 'new-1' }));
      const canvas = state.canvases.entities['canvas-1']!;
      expect(canvas.nodes).toHaveLength(1);
      expect(canvas.nodes[0].id).toBe('new-1');
      expect(canvas.nodes[0].position).toEqual({ x: 10, y: 20 });
    });

    it('does nothing when no active canvas', () => {
      const state = makeState();
      state.activeCanvasId = null;
      addNode(state, action({ type: 'image' as const, position: { x: 0, y: 0 }, id: 'x' }));
      expect(state.canvases.entities['canvas-1']!.nodes).toHaveLength(0);
    });
  });

  describe('removeNodes', () => {
    it('removes specified nodes and their connected edges', () => {
      const node1 = makeNode({ id: 'n1' });
      const node2 = makeNode({ id: 'n2' });
      const canvas = makeCanvas({
        nodes: [node1, node2],
        edges: [makeEdge({ id: 'e1', source: 'n1', target: 'n2' })],
      });
      const state = makeState(canvas);
      state.selectedNodeIds = ['n1', 'n2'];

      removeNodes(state, action(['n1']));
      const c = state.canvases.entities['canvas-1']!;
      expect(c.nodes).toHaveLength(1);
      expect(c.nodes[0].id).toBe('n2');
      expect(c.edges).toHaveLength(0);
      expect(state.selectedNodeIds).toEqual(['n2']);
    });

    it('clears video frame references pointing to removed nodes', () => {
      const videoNode = makeNode({
        id: 'v1',
        type: 'video',
        data: {
          status: 'empty',
          width: 1280,
          height: 720,
          duration: 5,
          fps: 24,
          variants: [],
          selectedVariantIndex: 0,
          variantCount: 1,
          seedLocked: false,
          presetTracks: {},
          firstFrameNodeId: 'img1',
          lastFrameNodeId: 'img2',
        } as unknown as VideoNodeData,
      });
      const img1 = makeNode({ id: 'img1' });
      const canvas = makeCanvas({ nodes: [videoNode, img1] });
      const state = makeState(canvas);

      removeNodes(state, action(['img1']));
      const v = state.canvases.entities['canvas-1']!.nodes[0];
      const vd = v.data as VideoNodeData;
      expect(vd.firstFrameNodeId).toBeUndefined();
      expect(vd.lastFrameNodeId).toBe('img2');
    });
  });

  describe('updateNode', () => {
    it('applies changes to matching node', () => {
      const node = makeNode({ id: 'n1', title: 'Old' });
      const state = makeState(makeCanvas({ nodes: [node] }));
      updateNode(state, action({ id: 'n1', changes: { title: 'New' } }));
      expect(state.canvases.entities['canvas-1']!.nodes[0].title).toBe('New');
    });

    it('blocks height change on collapsed backdrop', () => {
      const node = makeNode({
        id: 'b1',
        type: 'backdrop',
        data: {
          color: '#000',
          padding: 24,
          opacity: 0.14,
          collapsed: true,
        } as unknown as CanvasNodeData,
        height: 100,
      });
      const state = makeState(makeCanvas({ nodes: [node] }));
      updateNode(state, action({ id: 'b1', changes: { height: 500 } }));
      expect(state.canvases.entities['canvas-1']!.nodes[0].height).toBe(100);
    });
  });

  describe('updateNodeData', () => {
    it('merges partial data into existing node data', () => {
      const node = makeNode({ id: 'n1' });
      const state = makeState(makeCanvas({ nodes: [node] }));
      updateNodeData(state, action({ id: 'n1', data: { prompt: 'test prompt' } }));
      expect((state.canvases.entities['canvas-1']!.nodes[0].data as ImageNodeData).prompt).toBe(
        'test prompt',
      );
    });
  });

  describe('moveNode', () => {
    it('updates position of unlocked node', () => {
      const node = makeNode({ id: 'n1' });
      const state = makeState(makeCanvas({ nodes: [node] }));
      moveNode(state, action({ id: 'n1', position: { x: 99, y: 88 } }));
      expect(state.canvases.entities['canvas-1']!.nodes[0].position).toEqual({ x: 99, y: 88 });
    });

    it('does not move a locked node', () => {
      const node = makeNode({ id: 'n1', locked: true });
      const state = makeState(makeCanvas({ nodes: [node] }));
      moveNode(state, action({ id: 'n1', position: { x: 99, y: 88 } }));
      expect(state.canvases.entities['canvas-1']!.nodes[0].position).toEqual({ x: 0, y: 0 });
    });
  });

  describe('moveNodes', () => {
    it('moves multiple unlocked nodes', () => {
      const n1 = makeNode({ id: 'n1' });
      const n2 = makeNode({ id: 'n2', locked: true });
      const state = makeState(makeCanvas({ nodes: [n1, n2] }));
      moveNodes(
        state,
        action([
          { id: 'n1', position: { x: 5, y: 5 } },
          { id: 'n2', position: { x: 10, y: 10 } },
        ]),
      );
      const nodes = state.canvases.entities['canvas-1']!.nodes;
      expect(nodes[0].position).toEqual({ x: 5, y: 5 });
      expect(nodes[1].position).toEqual({ x: 0, y: 0 });
    });
  });

  describe('renameNode', () => {
    it('sets the title of a node', () => {
      const state = makeState(makeCanvas({ nodes: [makeNode({ id: 'n1' })] }));
      renameNode(state, action({ id: 'n1', title: 'Hello' }));
      expect(state.canvases.entities['canvas-1']!.nodes[0].title).toBe('Hello');
    });
  });

  describe('toggleBypass', () => {
    it('toggles bypassed flag', () => {
      const state = makeState(makeCanvas({ nodes: [makeNode({ id: 'n1', bypassed: false })] }));
      toggleBypass(state, action({ id: 'n1' }));
      expect(state.canvases.entities['canvas-1']!.nodes[0].bypassed).toBe(true);
      toggleBypass(state, action({ id: 'n1' }));
      expect(state.canvases.entities['canvas-1']!.nodes[0].bypassed).toBe(false);
    });
  });

  describe('setNodeColorTag', () => {
    it('sets and clears color tag', () => {
      const state = makeState(makeCanvas({ nodes: [makeNode({ id: 'n1' })] }));
      setNodeColorTag(state, action({ id: 'n1', colorTag: 'red' }));
      expect(state.canvases.entities['canvas-1']!.nodes[0].colorTag).toBe('red');
      setNodeColorTag(state, action({ id: 'n1', colorTag: undefined }));
      expect(state.canvases.entities['canvas-1']!.nodes[0].colorTag).toBeUndefined();
    });
  });

  describe('toggleLock', () => {
    it('toggles locked flag', () => {
      const state = makeState(makeCanvas({ nodes: [makeNode({ id: 'n1', locked: false })] }));
      toggleLock(state, action({ id: 'n1' }));
      expect(state.canvases.entities['canvas-1']!.nodes[0].locked).toBe(true);
    });
  });

  describe('toggleBackdropCollapse', () => {
    it('toggles collapsed on backdrop node only', () => {
      const node = makeNode({
        id: 'b1',
        type: 'backdrop',
        data: { color: '#000', padding: 24, opacity: 0.14, collapsed: false },
      });
      const state = makeState(makeCanvas({ nodes: [node] }));
      toggleBackdropCollapse(state, action({ id: 'b1' }));
      expect(
        (state.canvases.entities['canvas-1']!.nodes[0].data as { collapsed: boolean }).collapsed,
      ).toBe(true);
    });

    it('ignores non-backdrop nodes', () => {
      const state = makeState(makeCanvas({ nodes: [makeNode({ id: 'n1', type: 'image' })] }));
      toggleBackdropCollapse(state, action({ id: 'n1' }));
      expect(state.canvases.entities['canvas-1']!.nodes[0].data).not.toHaveProperty('collapsed');
    });
  });

  describe('setBackdropOpacity', () => {
    it('clamps opacity between 0.05 and 1', () => {
      const node = makeNode({
        id: 'b1',
        type: 'backdrop',
        data: { color: '#000', padding: 24, opacity: 0.5, collapsed: false },
      });
      const state = makeState(makeCanvas({ nodes: [node] }));

      setBackdropOpacity(state, action({ id: 'b1', opacity: 0.01 }));
      expect(
        (state.canvases.entities['canvas-1']!.nodes[0].data as { opacity: number }).opacity,
      ).toBe(0.05);

      setBackdropOpacity(state, action({ id: 'b1', opacity: 2.0 }));
      expect(
        (state.canvases.entities['canvas-1']!.nodes[0].data as { opacity: number }).opacity,
      ).toBe(1);
    });

    it('does not change locked backdrop', () => {
      const node = makeNode({
        id: 'b1',
        type: 'backdrop',
        locked: true,
        data: { color: '#000', padding: 24, opacity: 0.5, collapsed: false },
      });
      const state = makeState(makeCanvas({ nodes: [node] }));
      setBackdropOpacity(state, action({ id: 'b1', opacity: 0.8 }));
      expect(
        (state.canvases.entities['canvas-1']!.nodes[0].data as { opacity: number }).opacity,
      ).toBe(0.5);
    });
  });

  describe('setBackdropColor', () => {
    it('sets color on unlocked backdrop', () => {
      const node = makeNode({
        id: 'b1',
        type: 'backdrop',
        data: { color: '#000', padding: 24, opacity: 0.14, collapsed: false },
      });
      const state = makeState(makeCanvas({ nodes: [node] }));
      setBackdropColor(state, action({ id: 'b1', color: '#fff' }));
      expect((state.canvases.entities['canvas-1']!.nodes[0].data as { color: string }).color).toBe(
        '#fff',
      );
    });
  });

  describe('setNodeProvider', () => {
    it('sets providerId on generation node', () => {
      const state = makeState(makeCanvas({ nodes: [makeNode({ id: 'n1' })] }));
      setNodeProvider(state, action({ id: 'n1', providerId: 'dalle' }));
      expect((state.canvases.entities['canvas-1']!.nodes[0].data as ImageNodeData).providerId).toBe(
        'dalle',
      );
    });
  });

  describe('setNodeVariantCount', () => {
    it('sets variantCount on generation node', () => {
      const state = makeState(makeCanvas({ nodes: [makeNode({ id: 'n1' })] }));
      setNodeVariantCount(state, action({ id: 'n1', count: 4 }));
      expect(
        (state.canvases.entities['canvas-1']!.nodes[0].data as ImageNodeData).variantCount,
      ).toBe(4);
    });
  });

  describe('setNodeUploadedAsset', () => {
    it('sets assetHash and status=done', () => {
      const state = makeState(makeCanvas({ nodes: [makeNode({ id: 'n1' })] }));
      setNodeUploadedAsset(state, action({ id: 'n1', assetHash: 'abc123' }));
      const data = state.canvases.entities['canvas-1']!.nodes[0].data as ImageNodeData;
      expect(data.assetHash).toBe('abc123');
      expect(data.status).toBe('done');
    });
  });

  describe('clearNodeAsset', () => {
    it('clears asset and resets to empty', () => {
      const node = makeNode({ id: 'n1' });
      (node.data as ImageNodeData).assetHash = 'old';
      (node.data as ImageNodeData).status = 'done';
      (node.data as ImageNodeData).variants = [
        { assetHash: 'old', seed: 1 },
      ] as unknown as ImageNodeData['variants'];
      const state = makeState(makeCanvas({ nodes: [node] }));
      clearNodeAsset(state, action({ id: 'n1' }));
      const data = state.canvases.entities['canvas-1']!.nodes[0].data as ImageNodeData;
      expect(data.assetHash).toBeUndefined();
      expect(data.status).toBe('empty');
      expect(data.variants).toEqual([]);
    });
  });

  describe('setVideoFrameNode', () => {
    it('sets firstFrameNodeId and clears assetHash', () => {
      const video = makeNode({
        id: 'v1',
        type: 'video',
        data: {
          status: 'empty',
          width: 1280,
          height: 720,
          duration: 5,
          fps: 24,
          variants: [],
          selectedVariantIndex: 0,
          variantCount: 1,
          seedLocked: false,
          presetTracks: {},
        } as unknown as VideoNodeData,
      });
      const img = makeNode({ id: 'img1', type: 'image' });
      const state = makeState(makeCanvas({ nodes: [video, img] }));

      setVideoFrameNode(state, action({ id: 'v1', role: 'first', frameNodeId: 'img1' }));
      const vd = state.canvases.entities['canvas-1']!.nodes[0].data as VideoNodeData;
      expect(vd.firstFrameNodeId).toBe('img1');
    });

    it('rejects frame reference to non-existent node', () => {
      const video = makeNode({
        id: 'v1',
        type: 'video',
        data: {
          status: 'empty',
          width: 1280,
          height: 720,
          duration: 5,
          variants: [],
          selectedVariantIndex: 0,
          variantCount: 1,
          seedLocked: false,
          presetTracks: {},
        } as unknown as VideoNodeData,
      });
      const state = makeState(makeCanvas({ nodes: [video] }));
      setVideoFrameNode(state, action({ id: 'v1', role: 'first', frameNodeId: 'missing' }));
      const vd = state.canvases.entities['canvas-1']!.nodes[0].data as VideoNodeData;
      expect(vd.firstFrameNodeId).toBeUndefined();
    });
  });

  describe('restoreNodes', () => {
    it('restores nodes and edges without duplicating existing', () => {
      const existing = makeNode({ id: 'n1' });
      const state = makeState(makeCanvas({ nodes: [existing], edges: [] }));
      const restoredNode = makeNode({ id: 'n2' });
      const restoredEdge = makeEdge({ id: 'e1', source: 'n1', target: 'n2' });

      restoreNodes(state, action({ nodes: [existing, restoredNode], edges: [restoredEdge] }));
      const c = state.canvases.entities['canvas-1']!;
      expect(c.nodes).toHaveLength(2);
      expect(c.edges).toHaveLength(1);
    });
  });
});
