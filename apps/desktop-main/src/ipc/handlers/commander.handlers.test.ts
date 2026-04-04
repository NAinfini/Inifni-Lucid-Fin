import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Canvas } from '@lucid-fin/contracts';
import { SqliteIndex } from '@lucid-fin/storage';
import { clearCurrentProject, setCurrentProject } from '../project-context.js';
import { buildContext, entityMutatingToolNames } from './commander.handlers.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-commander-ipc-'));
}

function makeCanvas(nodeCount = 12): Canvas {
  const now = Date.now();

  return {
    id: 'canvas-1',
    projectId: 'project-1',
    name: 'Storyboard',
    nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: `node-${index + 1}`,
      type: 'text',
      position: { x: index * 10, y: index * 20 },
      data: { content: `Node ${index + 1}` },
      title: `Node ${index + 1}`,
      status: 'idle',
      bypassed: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
    })),
    edges: [
      {
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
        data: { status: 'idle', label: 'first' },
      },
      {
        id: 'edge-2',
        source: 'node-2',
        target: 'node-3',
        data: { status: 'idle', label: 'second' },
      },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: now,
    updatedAt: now,
  };
}

describe('entityMutatingToolNames', () => {
  it('includes equipment mutating tools', () => {
    expect(entityMutatingToolNames.has('equipment.create')).toBe(true);
    expect(entityMutatingToolNames.has('equipment.update')).toBe(true);
    expect(entityMutatingToolNames.has('equipment.delete')).toBe(true);
    expect(entityMutatingToolNames.has('equipment.deleteReferenceImage')).toBe(true);
  });

  it('includes reference image delete tools for all entity types', () => {
    expect(entityMutatingToolNames.has('character.deleteReferenceImage')).toBe(true);
    expect(entityMutatingToolNames.has('equipment.deleteReferenceImage')).toBe(true);
    expect(entityMutatingToolNames.has('location.deleteReferenceImage')).toBe(true);
  });
});

describe('buildContext', () => {
  let base: string;
  let db: SqliteIndex;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
    setCurrentProject('project-1', path.join(base, 'project'));
  });

  afterEach(() => {
    clearCurrentProject();
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('builds a minimal canvas snapshot and caps selected nodes to ten entries', () => {
    const context = buildContext(
      makeCanvas(),
      [],
      Array.from({ length: 12 }, (_, index) => `node-${index + 1}`),
      db,
    );

    const extra = context.extra as Record<string, unknown>;
    const snapshot = extra.canvasSnapshot as {
      name: string;
      nodeCount: number;
      edgeCount: number;
      selectedNodes: Array<{ id: string; type: string; title: string }>;
      nodes?: unknown[];
      edges?: unknown[];
    };

    expect(snapshot).toEqual({
      name: 'Storyboard',
      nodeCount: 12,
      edgeCount: 2,
      selectedNodes: Array.from({ length: 10 }, (_, index) => ({
        id: `node-${index + 1}`,
        type: 'text',
        title: `Node ${index + 1}`,
      })),
    });
    expect(snapshot.nodes).toBeUndefined();
    expect(snapshot.edges).toBeUndefined();
  });

  it('truncates character and location descriptions and removes nonessential fields', () => {
    db.upsertCharacter({
      id: 'char-1',
      projectId: 'project-1',
      name: 'Hero',
      role: 'protagonist',
      description: `${'c'.repeat(150)}CHAR-TAIL`,
    });
    db.upsertLocation({
      id: 'loc-1',
      projectId: 'project-1',
      name: 'Warehouse',
      type: 'interior',
      description: `${'l'.repeat(150)}LOC-TAIL`,
      mood: 'tense',
      weather: 'rain',
      lighting: 'neon',
    });

    const context = buildContext(makeCanvas(2), [], ['node-1'], db);
    const extra = context.extra as Record<string, unknown>;
    const characters = extra.characters as Array<Record<string, unknown>>;
    const locations = extra.locations as Array<Record<string, unknown>>;

    expect(characters).toHaveLength(1);
    expect(characters[0]).toEqual({
      id: 'char-1',
      name: 'Hero',
      role: 'protagonist',
      description: expect.any(String),
    });
    expect((characters[0]?.description as string).length).toBeLessThanOrEqual(120);
    expect(characters[0]?.description).not.toContain('CHAR-TAIL');

    expect(locations).toHaveLength(1);
    expect(locations[0]).toEqual({
      id: 'loc-1',
      name: 'Warehouse',
      type: 'interior',
      description: expect.any(String),
    });
    expect((locations[0]?.description as string).length).toBeLessThanOrEqual(120);
    expect(locations[0]?.description).not.toContain('LOC-TAIL');
    expect(locations[0]).not.toHaveProperty('mood');
    expect(locations[0]).not.toHaveProperty('weather');
    expect(locations[0]).not.toHaveProperty('lighting');
  });

  it('limits prompt guides to three entries and truncates each guide body', () => {
    const context = buildContext(
      makeCanvas(2),
      [],
      ['node-1'],
      db,
      Array.from({ length: 4 }, (_, index) => ({
        id: `guide-${index + 1}`,
        name: `Guide ${index + 1}`,
        content: `body-${index + 1}-${'x'.repeat(650)}-TAIL-${index + 1}`,
      })),
    );

    const extra = context.extra as Record<string, unknown>;
    const promptGuides = extra.promptGuides as string;

    expect(promptGuides).toContain('Guide 1');
    expect(promptGuides).toContain('Guide 2');
    expect(promptGuides).toContain('Guide 3');
    expect(promptGuides).not.toContain('Guide 4');
    expect(promptGuides).not.toContain('TAIL-1');
    expect(promptGuides).not.toContain('TAIL-2');
    expect(promptGuides).not.toContain('TAIL-3');
    expect(promptGuides).not.toContain('TAIL-4');
  });
});
