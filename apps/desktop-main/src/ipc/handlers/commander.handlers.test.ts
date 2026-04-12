import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Canvas } from '@lucid-fin/contracts';
import { SqliteIndex } from '@lucid-fin/storage';
import { clearCurrentProject, setCurrentProject } from '../project-context.js';

vi.mock('../../logger.js', () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };

  return {
    default: logger,
    log: vi.fn(),
    debug: logger.debug,
    info: logger.info,
    warn: logger.warn,
    error: logger.error,
    fatal: logger.fatal,
  };
});

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
    expect(entityMutatingToolNames.has('equipment.refImage')).toBe(true);
  });

  it('includes reference image tools for all entity types', () => {
    expect(entityMutatingToolNames.has('character.refImage')).toBe(true);
    expect(entityMutatingToolNames.has('equipment.refImage')).toBe(true);
    expect(entityMutatingToolNames.has('location.refImage')).toBe(true);
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

  it('builds lazy canvas context with only ids for selected nodes', () => {
    const context = buildContext(
      makeCanvas(),
      [],
      Array.from({ length: 12 }, (_, index) => `node-${index + 1}`),
      db,
    );

    const extra = context.extra as Record<string, unknown>;
    expect(extra).toEqual({
      canvasId: 'canvas-1',
      nodeCount: 12,
      edgeCount: 2,
      selectedNodeIds: Array.from({ length: 10 }, (_, index) => `node-${index + 1}`),
    });
  });

  it('does not inject project entities into commander context', () => {
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
    expect(extra).not.toHaveProperty('characters');
    expect(extra).not.toHaveProperty('locations');
  });

  it('does not inject prompt guide content into commander context', () => {
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
    expect(extra).not.toHaveProperty('promptGuides');
  });
});
