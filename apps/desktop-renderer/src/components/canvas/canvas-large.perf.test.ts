import { describe, expect, it } from 'vitest';
import type { BackdropNodeData, CanvasNode, ImageNodeData, VideoNodeData } from '@lucid-fin/contracts';
import { computeBackdropContainment } from './backdrop-containment.js';
import { toFlowNode } from './canvas-utils.js';

function makeNode(overrides: Partial<CanvasNode>): CanvasNode {
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

function makeSparseCanvas(total: number, backdropCount: number): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  const columns = Math.max(1, Math.ceil(Math.sqrt(backdropCount)));
  for (let index = 0; index < backdropCount; index++) {
    nodes.push(
      makeNode({
        id: `backdrop-${index}`,
        type: 'backdrop',
        position: { x: (index % columns) * 720, y: Math.floor(index / columns) * 520 },
        width: 520,
        height: 320,
        data: { collapsed: index % 11 === 0 } as BackdropNodeData,
      }),
    );
  }
  const width = columns * 720;
  const height = Math.max(520, Math.ceil(backdropCount / columns) * 520);
  for (let index = backdropCount; index < total; index++) {
    nodes.push(
      makeNode({
        id: `node-${index}`,
        position: { x: (index * 137) % width, y: (index * 271) % height },
        width: 200,
        height: 100,
      }),
    );
  }
  return nodes;
}

function referenceContainment(nodes: readonly CanvasNode[]): number {
  const backdrops = nodes.filter((node) => node.type === 'backdrop');
  let memberships = 0;
  for (const node of nodes) {
    if (node.type === 'backdrop') continue;
    const centerX = node.position.x + (node.width ?? 200) / 2;
    const centerY = node.position.y + (node.height ?? 100) / 2;
    for (const backdrop of backdrops) {
      if (
        centerX >= backdrop.position.x &&
        centerX <= backdrop.position.x + (backdrop.width ?? 420) &&
        centerY >= backdrop.position.y &&
        centerY <= backdrop.position.y + (backdrop.height ?? 240)
      ) {
        memberships++;
      }
    }
  }
  return memberships;
}

function medianMs(run: () => unknown, samples = 7): number {
  run();
  run();
  const durations: number[] = [];
  for (let sample = 0; sample < samples; sample++) {
    const startedAt = performance.now();
    run();
    durations.push(performance.now() - startedAt);
  }
  durations.sort((a, b) => a - b);
  return durations[Math.floor(durations.length / 2)] ?? 0;
}

function makeVideoCanvas(total: number, videoCount: number): CanvasNode[] {
  const images = Array.from({ length: total - videoCount }, (_, index) =>
    makeNode({ id: `image-${index}`, data: { assetHash: `hash-${index}` } as ImageNodeData }),
  );
  const videos = Array.from({ length: videoCount }, (_, index) =>
    makeNode({
      id: `video-${index}`,
      type: 'video',
      data: {
        status: 'empty',
        firstFrameNodeId: `image-${index % images.length}`,
        lastFrameNodeId: `image-${(index * 17) % images.length}`,
      } as VideoNodeData,
    }),
  );
  return [...images, ...videos];
}

function referenceMapFlowNodes(nodes: CanvasNode[]) {
  return nodes.map((node) => {
    if (node.type !== 'video') {
      return toFlowNode(node, {}, { dependencyRole: null, dimmed: false });
    }
    const data = node.data as VideoNodeData;
    const first = data.firstFrameNodeId
      ? nodes.find((candidate) => candidate.id === data.firstFrameNodeId)
      : undefined;
    const last = data.lastFrameNodeId
      ? nodes.find((candidate) => candidate.id === data.lastFrameNodeId)
      : undefined;
    return toFlowNode(
      node,
      {},
      { dependencyRole: null, dimmed: false },
      new Map(
        [first, last]
          .filter((candidate): candidate is CanvasNode => candidate !== undefined)
          .map((candidate) => [candidate.id, candidate]),
      ),
    );
  });
}

function indexedMapFlowNodes(nodes: CanvasNode[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return nodes.map((node) =>
    toFlowNode(node, {}, { dependencyRole: null, dimmed: false }, nodesById),
  );
}

function referenceMove(
  nodes: CanvasNode[],
  moves: Array<{ id: string; position: { x: number; y: number } }>,
) {
  for (const move of moves) {
    const node = nodes.find((candidate) => candidate.id === move.id);
    if (node && !node.locked) node.position = move.position;
  }
}

function indexedMove(
  nodes: CanvasNode[],
  moves: Array<{ id: string; position: { x: number; y: number } }>,
) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const move of moves) {
    const node = nodesById.get(move.id);
    if (node && !node.locked) node.position = move.position;
  }
}

describe('large canvas performance', () => {
  it('scales backdrop containment with spatial density instead of N × B', () => {
    const medium = makeSparseCanvas(5_000, 500);
    const large = makeSparseCanvas(10_000, 1_000);
    const referenceMs = medianMs(() => referenceContainment(large));
    const mediumMs = medianMs(() => computeBackdropContainment(medium));
    const optimizedMs = medianMs(() => computeBackdropContainment(large));

    console.info('backdrop containment', { referenceMs, mediumMs, optimizedMs });
    expect(optimizedMs).toBeLessThan(referenceMs * 0.5);
    expect(optimizedMs / mediumMs).toBeLessThan(3);
  });

  it('indexes video frame nodes once', () => {
    const nodes = makeVideoCanvas(10_000, 2_500);
    const referenceMs = medianMs(() => referenceMapFlowNodes(nodes), 5);
    const optimizedMs = medianMs(() => indexedMapFlowNodes(nodes), 5);

    console.info('video frame mapping', { referenceMs, optimizedMs });
    expect(optimizedMs).toBeLessThan(referenceMs * 0.5);
  });

  it('indexes nodes once for batch movement', () => {
    const referenceNodes = makeSparseCanvas(10_000, 0);
    const optimizedNodes = makeSparseCanvas(10_000, 0);
    const moves = Array.from({ length: 2_500 }, (_, index) => ({
      id: `node-${index * 3 + 1}`,
      position: { x: index, y: -index },
    }));
    const referenceMs = medianMs(() => referenceMove(referenceNodes, moves));
    const optimizedMs = medianMs(() => indexedMove(optimizedNodes, moves));

    console.info('batch movement', { referenceMs, optimizedMs });
    expect(optimizedMs).toBeLessThan(referenceMs * 0.5);
  });
});
