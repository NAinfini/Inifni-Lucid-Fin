import { expect, it } from 'vitest';
import type { BackdropNodeData, CanvasNode } from '@lucid-fin/contracts';
import { computeBackdropContainment } from './backdrop-containment.js';

function fixture(): CanvasNode[] {
  const backdrops = Array.from({ length: 2_000 }, (_, index) => ({
    id: `backdrop-${index}`,
    type: 'backdrop' as const,
    title: `Backdrop ${index}`,
    position: { x: (index % 100) * 600, y: Math.floor(index / 100) * 400 },
    width: 420,
    height: 240,
    data: { collapsed: index % 7 === 0 },
    bypassed: false,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
  }));
  const children = Array.from({ length: 18_000 }, (_, index) => ({
    id: `node-${index}`,
    type: 'image' as const,
    title: `Node ${index}`,
    position: {
      x: (index % 100) * 600 + (index % 3) * 80,
      y: (Math.floor(index / 100) % 20) * 400 + (index % 2) * 50,
    },
    width: 100,
    height: 80,
    data: {},
    bypassed: false,
    locked: false,
    createdAt: 1,
    updatedAt: 1,
  }));
  return [...backdrops, ...children] as CanvasNode[];
}

function referenceContainment(nodes: readonly CanvasNode[]) {
  const backdrops = nodes.filter((entry) => entry.type === 'backdrop');
  const counts = new Map(backdrops.map((entry) => [entry.id, 0]));
  const hidden = new Set<string>();
  for (const entry of nodes) {
    if (entry.type === 'backdrop') continue;
    const centerX = entry.position.x + (entry.width ?? 200) / 2;
    const centerY = entry.position.y + (entry.height ?? 100) / 2;
    for (const backdrop of backdrops) {
      const inside =
        centerX >= backdrop.position.x &&
        centerX <= backdrop.position.x + (backdrop.width ?? 420) &&
        centerY >= backdrop.position.y &&
        centerY <= backdrop.position.y + (backdrop.height ?? 240);
      if (!inside) continue;
      counts.set(backdrop.id, (counts.get(backdrop.id) ?? 0) + 1);
      if ((backdrop.data as BackdropNodeData).collapsed) hidden.add(entry.id);
    }
  }
  return { counts, hidden };
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

it('indexes large backdrop containment without changing results', () => {
  const nodes = fixture();
  computeBackdropContainment(nodes);
  referenceContainment(nodes.slice(0, 250));

  const indexedSamples: number[] = [];
  const referenceSamples: number[] = [];
  let indexed = computeBackdropContainment(nodes);
  let reference = referenceContainment(nodes);
  for (let iteration = 0; iteration < 3; iteration++) {
    let started = performance.now();
    indexed = computeBackdropContainment(nodes);
    indexedSamples.push(performance.now() - started);
    started = performance.now();
    reference = referenceContainment(nodes);
    referenceSamples.push(performance.now() - started);
  }

  const indexedMs = median(indexedSamples);
  const referenceMs = median(referenceSamples);
  console.info('Canvas backdrop containment', { nodes: nodes.length, indexedMs, referenceMs });
  expect(Object.fromEntries(indexed.backdropChildCounts)).toEqual(Object.fromEntries(reference.counts));
  expect([...indexed.hiddenNodeIds]).toEqual([...reference.hidden]);
  expect(indexedMs).toBeLessThan(referenceMs * 0.5);
});
