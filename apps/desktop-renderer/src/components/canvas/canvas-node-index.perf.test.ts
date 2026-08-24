import { expect, it } from 'vitest';
import type { CanvasNode, ImageNodeData, VideoNodeData } from '@lucid-fin/contracts';

function fixture(): CanvasNode[] {
  const images = Array.from({ length: 15_000 }, (_, index) => ({
    id: `image-${index}`,
    type: 'image' as const,
    title: `Image ${index}`,
    position: { x: index, y: 0 },
    data: { assetHash: `hash-${index}` },
    bypassed: false,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
  }));
  const videos = Array.from({ length: 5_000 }, (_, index) => ({
    id: `video-${index}`,
    type: 'video' as const,
    title: `Video ${index}`,
    position: { x: index, y: 100 },
    data: {
      firstFrameNodeId: `image-${index * 2}`,
      lastFrameNodeId: `image-${index * 2 + 1}`,
    },
    bypassed: false,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
  }));
  return [...images, ...videos] as CanvasNode[];
}

function withLinearFind(nodes: CanvasNode[]): string[] {
  return nodes
    .filter((node) => node.type === 'video')
    .flatMap((node) => {
      const data = node.data as VideoNodeData;
      return [data.firstFrameNodeId, data.lastFrameNodeId].map((id) => {
        const frame = nodes.find((candidate) => candidate.id === id);
        return frame?.type === 'image' ? ((frame.data as ImageNodeData).assetHash ?? '') : '';
      });
    });
}

function withIndex(nodes: CanvasNode[]): string[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  return nodes
    .filter((node) => node.type === 'video')
    .flatMap((node) => {
      const data = node.data as VideoNodeData;
      return [data.firstFrameNodeId, data.lastFrameNodeId].map((id) => {
        const frame = id ? nodesById.get(id) : undefined;
        return frame?.type === 'image' ? ((frame.data as ImageNodeData).assetHash ?? '') : '';
      });
    });
}

function median(run: () => unknown): number {
  const samples: number[] = [];
  for (let sample = 0; sample < 3; sample++) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  return samples.sort((left, right) => left - right)[1] ?? 0;
}

it('indexes large-canvas video frame lookups while preserving results', () => {
  const nodes = fixture();
  const indexed = withIndex(nodes);
  const linear = withLinearFind(nodes);
  expect(indexed).toEqual(linear);

  const indexedMs = median(() => withIndex(nodes));
  const linearMs = median(() => withLinearFind(nodes));
  console.info('Canvas video frame lookup', { nodes: nodes.length, indexedMs, linearMs });
  expect(indexedMs).toBeLessThan(linearMs * 0.5);
});
