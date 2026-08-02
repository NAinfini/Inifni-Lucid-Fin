import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

import { CanvasService } from './canvas.service.js';
import { NotFoundError, ValidationError } from './errors.js';
import type { CanvasStore } from '../ipc/handlers/canvas.handlers.js';

function createMockStore(): CanvasStore & {
  _data: Map<string, import('@lucid-fin/contracts').Canvas>;
} {
  const data = new Map<string, import('@lucid-fin/contracts').Canvas>();
  return {
    _data: data,
    get: vi.fn((id: string) => data.get(id)),
    save: vi.fn((canvas: import('@lucid-fin/contracts').Canvas) => {
      data.set(canvas.id, canvas);
    }),
    delete: vi.fn((id: string) => {
      data.delete(id);
    }),
    list: vi.fn(() =>
      [...data.values()].map((c) => ({ id: c.id, name: c.name, updatedAt: c.updatedAt })),
    ),
  };
}

describe('CanvasService', () => {
  let store: ReturnType<typeof createMockStore>;
  let service: CanvasService;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createMockStore();
    service = new CanvasService(store);
  });

  describe('createCanvas', () => {
    it('creates a canvas with correct defaults', () => {
      const canvas = service.createCanvas('My Canvas');
      expect(canvas.name).toBe('My Canvas');
      expect(canvas.nodes).toEqual([]);
      expect(canvas.edges).toEqual([]);
      expect(canvas.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
      expect(canvas.id).toBeTypeOf('string');
      expect(store.save).toHaveBeenCalledWith(canvas);
    });

    it('trims whitespace from name', () => {
      const canvas = service.createCanvas('  Spaced Name  ');
      expect(canvas.name).toBe('Spaced Name');
    });

    it('throws ValidationError for empty name', () => {
      expect(() => service.createCanvas('')).toThrow(ValidationError);
      expect(() => service.createCanvas('   ')).toThrow(ValidationError);
    });
  });

  describe('loadCanvas', () => {
    it('returns existing canvas', () => {
      const created = service.createCanvas('Test');
      const loaded = service.loadCanvas(created.id);
      expect(loaded.id).toBe(created.id);
    });

    it('throws NotFoundError for missing canvas', () => {
      expect(() => service.loadCanvas('nonexistent')).toThrow(NotFoundError);
    });

    it('throws ValidationError for invalid id', () => {
      expect(() => service.loadCanvas(undefined as unknown as string)).toThrow(ValidationError);
    });
  });

  describe('saveCanvas', () => {
    it('persists canvas and updates timestamp', () => {
      const created = service.createCanvas('Test');
      const originalUpdatedAt = created.updatedAt;

      // Advance time slightly
      vi.spyOn(Date, 'now').mockReturnValue(originalUpdatedAt + 1000);

      service.saveCanvas(created);
      expect(created.updatedAt).toBe(originalUpdatedAt + 1000);
      expect(store.save).toHaveBeenCalledWith(created);

      vi.restoreAllMocks();
    });

    it('throws ValidationError for missing data', () => {
      expect(() => service.saveCanvas(null as never)).toThrow(ValidationError);
    });
  });

  describe('deleteCanvas', () => {
    it('deletes existing canvas', () => {
      const created = service.createCanvas('Test');
      service.deleteCanvas(created.id);
      expect(store.delete).toHaveBeenCalledWith(created.id);
    });

    it('throws ValidationError for invalid id', () => {
      expect(() => service.deleteCanvas(undefined as unknown as string)).toThrow(ValidationError);
    });
  });

  describe('renameCanvas', () => {
    it('renames existing canvas', () => {
      const created = service.createCanvas('Old Name');
      service.renameCanvas(created.id, 'New Name');
      expect(created.name).toBe('New Name');
    });

    it('throws NotFoundError for missing canvas', () => {
      expect(() => service.renameCanvas('nonexistent', 'Name')).toThrow(NotFoundError);
    });

    it('throws ValidationError for missing args', () => {
      expect(() => service.renameCanvas(undefined as unknown as string, 'Name')).toThrow(
        ValidationError,
      );
    });
  });

  describe('patchCanvas', () => {
    it('applies name change patch', () => {
      const created = service.createCanvas('Original');
      service.patchCanvas(created.id, {
        canvasId: created.id,
        timestamp: Date.now(),
        nameChange: 'Patched',
      });
      expect(created.name).toBe('Patched');
    });

    it('adds and removes nodes', () => {
      const created = service.createCanvas('Test');
      const node = {
        id: 'n1',
        type: 'scene' as const,
        position: { x: 0, y: 0 },
        data: {},
      } as import('@lucid-fin/contracts').CanvasNode;

      service.patchCanvas(created.id, {
        canvasId: created.id,
        timestamp: Date.now(),
        addedNodes: [node],
      });
      expect(created.nodes).toHaveLength(1);

      service.patchCanvas(created.id, {
        canvasId: created.id,
        timestamp: Date.now(),
        removedNodeIds: ['n1'],
      });
      expect(created.nodes).toHaveLength(0);
    });

    it('throws NotFoundError for missing canvas', () => {
      expect(() =>
        service.patchCanvas('nonexistent', {
          canvasId: 'nonexistent',
          timestamp: Date.now(),
        }),
      ).toThrow(NotFoundError);
    });
  });

  describe('listCanvases', () => {
    it('returns list from store', () => {
      service.createCanvas('A');
      service.createCanvas('B');
      const list = service.listCanvases();
      expect(list).toHaveLength(2);
    });
  });
});
