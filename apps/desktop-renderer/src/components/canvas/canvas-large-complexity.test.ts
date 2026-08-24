import { describe, expect, it } from 'vitest';
import type { BackdropNodeData, CanvasNode, ImageNodeData, VideoNodeData } from '@lucid-fin/contracts';
import { computeBackdropContainment } from './backdrop-containment.js';
import { toFlowNode } from './canvas-utils.js';

function node(overrides: Partial<CanvasNode>): CanvasNode {
  return {
    id: 'node',
    type: 'image',
    position: { x: 0, y: 0 },
    data: { status: 'empty' } as ImageNodeData,
    title: '',
    bypassed: false,
    locked: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function referenceContainment(nodes: readonly CanvasNode[]) {
  const backdrops = nodes.filter((candidate) => candidate.type === 'backdrop');
  const backdropChildCounts = new Map(backdrops.map((backdrop) => [backdrop.id, 0]));
  const hiddenNodeIds = new Set<string>();

  for (const candidate of nodes) {
    if (candidate.type === 'backdrop') continue;
    const centerX = candidate.position.x + (candidate.width ?? 200) / 2;
    const centerY = candidate.position.y + (candidate.height ?? 100) / 2;
    for (const backdrop of backdrops) {
      const width = backdrop.width ?? 420;
      const height = backdrop.height ?? 240;
      if (
        centerX >= backdrop.position.x &&
        centerX <= backdrop.position.x + width &&
        centerY >= backdrop.position.y &&
        centerY <= backdrop.position.y + height
      ) {
        backdropChildCounts.set(
          backdrop.id,
          (backdropChildCounts.get(backdrop.id) ?? 0) + 1,
        );
        if ((backdrop.data as BackdropNodeData).collapsed) hiddenNodeIds.add(candidate.id);
      }
    }
  }

  return { backdropChildCounts, hiddenNodeIds };
}

function seededNodes(count: number): CanvasNode[] {
  let seed = 0x12345678;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const nodes: CanvasNode[] = [];
  for (let index = 0; index < count; index++) {
    const backdrop = index % 9 === 0;
    nodes.push(
      node({
        id: `${backdrop ? 'backdrop' : 'node'}-${index}`,
        type: backdrop ? 'backdrop' : 'image',
        position: { x: Math.floor(random() * 8_000) - 2_000, y: Math.floor(random() * 6_000) - 1_500 },
        width: backdrop ? 200 + Math.floor(random() * 1_200) : 80 + Math.floor(random() * 300),
        height: backdrop ? 150 + Math.floor(random() * 800) : 60 + Math.floor(random() * 220),
        data: backdrop
          ? ({ collapsed: index % 18 === 0 } as BackdropNodeData)
          : ({ status: 'empty' } as ImageNodeData),
      }),
    );
  }
  return nodes;
}

describe('large-canvas complexity helpers', () => {
  it('matches reference containment for overlaps, exact boundaries, and giant backdrops', () => {
    const nodes = [
      node({
        id: 'outer',
        type: 'backdrop',
        position: { x: -10_000, y: -10_000 },
        width: 20_000,
        height: 20_000,
        data: { collapsed: false } as BackdropNodeData,
      }),
      node({
        id: 'collapsed',
        type: 'backdrop',
        position: { x: 0, y: 0 },
        width: 420,
        height: 240,
        data: { collapsed: true } as BackdropNodeData,
      }),
      node({ id: 'inside-both', position: { x: 100, y: 70 }, width: 20, height: 20 }),
      node({ id: 'right-boundary', position: { x: 410, y: 110 }, width: 20, height: 20 }),
      node({ id: 'outside-collapsed', position: { x: 900, y: 900 }, width: 20, height: 20 }),
    ];

    expect(computeBackdropContainment(nodes)).toEqual(referenceContainment(nodes));
  });

  it('matches the reference implementation on deterministic sparse data', () => {
    const nodes = seededNodes(2_000);
    expect(computeBackdropContainment(nodes)).toEqual(referenceContainment(nodes));
  });

  it('resolves video frame hashes from the pre-indexed node map and keeps explicit hashes', () => {
    const first = node({ id: 'first', data: { assetHash: 'first-hash' } as ImageNodeData });
    const last = node({ id: 'last', data: { assetHash: 'last-hash' } as ImageNodeData });
    const video = node({
      id: 'video',
      type: 'video',
      data: {
        status: 'empty',
        firstFrameNodeId: first.id,
        lastFrameNodeId: last.id,
        firstFrameAssetHash: 'explicit-first',
      } as VideoNodeData,
    });
    const nodesById = new Map([first, last, video].map((candidate) => [candidate.id, candidate]));

    const flowNode = toFlowNode(
      video,
      {},
      { dependencyRole: null, dimmed: false },
      nodesById,
    );

    expect(flowNode.data).toMatchObject({
      firstFrameHash: 'explicit-first',
      lastFrameHash: 'last-hash',
    });
  });
});
