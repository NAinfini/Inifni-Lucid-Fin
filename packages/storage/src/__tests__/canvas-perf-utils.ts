/**
 * Synthetic canvas data generator for performance benchmarks.
 *
 * Generates realistic canvas data with mixed node types, realistic
 * `data_json` sizes, and edge connections (avg 2 edges per node).
 *
 * Uses BetterSqlite3 directly (same as the repository tests) to insert
 * test data into the `canvases` and `canvas_nodes` tables.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { CanvasNode, CanvasEdge } from '@lucid-fin/contracts';
import type { NodeKind } from '@lucid-fin/contracts';

// ---------------------------------------------------------------------------
// Node type distribution — roughly mimics real cinematic storyboards
// ---------------------------------------------------------------------------

const NODE_TYPE_WEIGHTS: Array<{ type: NodeKind; weight: number }> = [
  { type: 'image', weight: 0.4 },
  { type: 'video', weight: 0.25 },
  { type: 'audio', weight: 0.1 },
  { type: 'text', weight: 0.15 },
  { type: 'backdrop', weight: 0.1 },
];

function pickNodeType(rand: number): NodeKind {
  let cumulative = 0;
  for (const entry of NODE_TYPE_WEIGHTS) {
    cumulative += entry.weight;
    if (rand < cumulative) return entry.type;
  }
  return 'image';
}

// ---------------------------------------------------------------------------
// Deterministic pseudo-random (Mulberry32) — repeatable benchmarks
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Realistic data_json builders per node type
// ---------------------------------------------------------------------------

function buildImageData(): Record<string, unknown> {
  return {
    assetHash: 'sha256-' + 'a'.repeat(60),
    status: 'done',
    prompt:
      'A cinematic wide shot of a futuristic cityscape at dusk with neon lights reflecting off wet streets, cyberpunk aesthetic with high contrast lighting',
    negativePrompt: 'text, watermark, blurry, low quality',
    width: 1920,
    height: 1080,
    seed: 42,
    seedLocked: false,
    variants: ['sha256-v1', 'sha256-v2'],
    selectedVariantIndex: 0,
    providerId: 'gemini-3-pro',
    variantCount: 2,
    cost: 0.05,
    generationTimeMs: 3200,
    characterRefs: [{ id: 'char-1', name: 'Hero' }],
    equipmentRefs: [],
    locationRefs: [{ id: 'loc-1', name: 'City Street' }],
    generationHistory: [
      {
        assetHash: 'sha256-v1',
        prompt: 'test prompt',
        providerId: 'gemini-3-pro',
        createdAt: Date.now(),
      },
    ],
  };
}

function buildVideoData(): Record<string, unknown> {
  return {
    assetHash: 'sha256-' + 'b'.repeat(60),
    status: 'done',
    width: 1920,
    height: 1080,
    duration: 4.0,
    fps: 24,
    prompt: 'Camera slowly pans across a rainy street with atmospheric fog, cinematic movement',
    seed: 123,
    variants: ['sha256-vid1'],
    selectedVariantIndex: 0,
    providerId: 'veo-2',
    cost: 0.15,
    generationTimeMs: 45000,
    firstFrameAssetHash: 'sha256-ff1',
    lastFrameAssetHash: 'sha256-lf1',
    audio: false,
    quality: 'standard',
  };
}

function buildAudioData(): Record<string, unknown> {
  return {
    assetHash: 'sha256-' + 'c'.repeat(60),
    status: 'done',
    audioType: 'sfx',
    duration: 3.5,
    prompt: 'Rain and thunder ambient city sounds',
    variants: ['sha256-aud1'],
    selectedVariantIndex: 0,
    providerId: 'elevenlabs',
    cost: 0.02,
  };
}

function buildTextData(): Record<string, unknown> {
  return {
    content:
      'Scene 1: EXT. CITY STREET - NIGHT\n\nThe camera reveals a sprawling metropolis bathed in neon light. Rain falls steadily, creating reflections on the wet asphalt.',
  };
}

function buildBackdropData(): Record<string, unknown> {
  return {
    color: '#1a1a2e',
    padding: 40,
    opacity: 0.8,
    collapsed: false,
    borderStyle: 'dashed',
    titleSize: 'md',
    lockChildren: false,
  };
}

function buildDataForType(type: NodeKind): Record<string, unknown> {
  switch (type) {
    case 'image':
      return buildImageData();
    case 'video':
      return buildVideoData();
    case 'audio':
      return buildAudioData();
    case 'text':
      return buildTextData();
    case 'backdrop':
      return buildBackdropData();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SyntheticCanvasResult {
  canvasId: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/**
 * Generate a synthetic canvas with `nodeCount` nodes and ~2 edges per node,
 * inserted directly into the database via raw SQL (bypassing repository Zod
 * validation for speed).
 *
 * @param db       Open BetterSqlite3 database with canvases + canvas_nodes tables
 * @param nodeCount Number of nodes to generate
 * @param seed      PRNG seed for deterministic output (default 12345)
 * @returns         The canvas ID, generated nodes, and generated edges
 */
export function generateSyntheticCanvas(
  db: BetterSqlite3.Database,
  nodeCount: number,
  seed = 12345,
): SyntheticCanvasResult {
  const rng = mulberry32(seed);
  const canvasId = `perf-canvas-${nodeCount}-${seed}`;
  const now = Date.now();

  // 1. Insert the canvas row
  db.prepare(
    `INSERT OR REPLACE INTO canvases
       (id, name, nodes, edges, viewport, notes, created_at, updated_at)
     VALUES (?, ?, '[]', ?, '{"x":0,"y":0,"zoom":1}', '[]', ?, ?)`,
  ).run(canvasId, `Perf Test Canvas (${nodeCount} nodes)`, '[]', now, now);

  // 2. Generate nodes
  const nodes: CanvasNode[] = [];
  const insertNode = db.prepare(
    `INSERT OR REPLACE INTO canvas_nodes
       (id, canvas_id, type, position_x, position_y, width, height,
        data_json, z_index, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const insertMany = db.transaction(() => {
    for (let i = 0; i < nodeCount; i++) {
      const type = pickNodeType(rng());
      const nodeId = `node-${i.toString().padStart(5, '0')}`;
      const posX = rng() * 10000;
      const posY = rng() * 10000;
      const width = type === 'backdrop' ? 600 + rng() * 400 : 256 + rng() * 256;
      const height = type === 'backdrop' ? 400 + rng() * 300 : 256 + rng() * 256;

      const data = buildDataForType(type);
      const augmented: Record<string, unknown> = { ...data };
      augmented['__node_title'] = `${type} node ${i}`;
      augmented['__node_bypassed'] = false;
      augmented['__node_locked'] = false;
      augmented['__node_createdAt'] = now - i * 1000;
      augmented['__node_updatedAt'] = now;

      const dataJson = JSON.stringify(augmented);
      const isoNow = new Date(now).toISOString();

      insertNode.run(
        nodeId,
        canvasId,
        type,
        posX,
        posY,
        width,
        height,
        dataJson,
        i,
        isoNow,
        isoNow,
      );

      nodes.push({
        id: nodeId,
        type,
        position: { x: posX, y: posY },
        data: data as CanvasNode['data'],
        title: `${type} node ${i}`,
        bypassed: false,
        locked: false,
        width,
        height,
        createdAt: now - i * 1000,
        updatedAt: now,
      });
    }
  });
  insertMany();

  // 3. Generate edges — avg 2 edges per node, so total = nodeCount * 2
  const edgeCount = nodeCount * 2;
  const edges: CanvasEdge[] = [];
  const usedPairs = new Set<string>();

  for (let i = 0; i < edgeCount; i++) {
    let sourceIdx: number;
    let targetIdx: number;
    let pairKey: string;

    // Avoid duplicate edges and self-loops
    let attempts = 0;
    do {
      sourceIdx = Math.floor(rng() * nodeCount);
      targetIdx = Math.floor(rng() * nodeCount);
      pairKey = `${sourceIdx}-${targetIdx}`;
      attempts++;
    } while ((sourceIdx === targetIdx || usedPairs.has(pairKey)) && attempts < 20);

    if (sourceIdx === targetIdx || usedPairs.has(pairKey)) continue;
    usedPairs.add(pairKey);

    edges.push({
      id: `edge-${i.toString().padStart(5, '0')}`,
      source: nodes[sourceIdx].id,
      target: nodes[targetIdx].id,
      data: { status: 'idle' },
    });
  }

  // 4. Update the canvases.edges column with the generated edges
  db.prepare(`UPDATE canvases SET edges = ? WHERE id = ?`).run(JSON.stringify(edges), canvasId);

  return { canvasId, nodes, edges };
}
