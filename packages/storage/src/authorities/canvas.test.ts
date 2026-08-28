import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MediaCas, MediaImportCapabilityResolver } from '../kernel/media-cas.js';
import { getStoreDatabase } from '../internal/database-access.js';
import { createDataAccess } from '../kernel/data-access.js';
import { createStore } from '../kernel/store.js';
import { plannedCanvasMutationIds } from './canvas.js';

const NOW = '2026-08-15T12:00:00.000Z';
const directories: string[] = [];
const context = {
  actor: 'commander' as const,
  causation: { kind: 'run' as const, runId: 'run.canvas.1' },
  correlationId: 'correlation.canvas.1',
};
const unusedMediaCas: MediaCas = {
  putVerified: async () => {
    throw new Error('unused');
  },
  stat: async () => null,
  verify: async () => {
    throw new Error('unused');
  },
};
const unusedCapabilities: MediaImportCapabilityResolver = {
  resolve: async () => {
    throw new Error('unused');
  },
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function deterministicIds() {
  const counts = new Map<string, number>();
  return (kind: string) => {
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    return `${kind}.${count}`;
  };
}

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-canvas-'));
  directories.push(directory);
  const store = await createStore(join(directory, 'project.sqlite'));
  let tick = 0;
  const data = createDataAccess(store, {
    now: () => new Date(Date.parse(NOW) + tick++ * 1000).toISOString(),
    createId: deterministicIds(),
    mediaCas: unusedMediaCas,
    mediaImportCapabilities: unusedCapabilities,
  });
  const project = data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.project.canvas',
      method: 'project.create',
      input: {
        name: 'Film',
        permissionMode: 'reversible',
        budget: {
          costUsd: { state: 'known', value: '20', currency: 'USD' },
          maxGenerationCount: 12,
          maxInputTokens: 100_000,
          maxOutputTokens: 20_000,
        },
        formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
      },
    },
    { ...context, actor: 'user', causation: { kind: 'direct_ui', actionId: 'create.project' } },
  ).result.project;
  const production = data.production.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.production.canvas',
      method: 'production.apply',
      input: {
        action: 'create',
        projectId: project.id,
        expectedProjectRevision: project.revision,
        value: { objectType: 'story', content: { title: 'Story', premise: 'P', synopsis: 'S' } },
        relations: [],
      },
    },
    context,
  ).result.object;
  return { store, data, database: getStoreDatabase(store), project, production };
}

function apply(
  data: Awaited<ReturnType<typeof harness>>['data'],
  projectId: string,
  revision: number,
  requestId: string,
  command: Parameters<typeof data.canvas.apply>[0]['input']['command'],
) {
  return data.canvas.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId,
      method: 'canvas.apply',
      input: { projectId, expectedCanvasRevision: revision, command },
    },
    context,
  ).result;
}

function mutateTool(
  data: Awaited<ReturnType<typeof harness>>['data'],
  projectId: string,
  input: Parameters<Awaited<ReturnType<typeof harness>>['data']['canvas']['mutateTool']>[1],
  dispatchOperationId: string,
) {
  return data.canvas.mutateTool(projectId, input, context, {
    occurredAt: NOW,
    dispatchOperationId,
  });
}

function getCanvas(
  data: Awaited<ReturnType<typeof harness>>['data'],
  projectId: string,
  requestId: string,
) {
  return data.canvas.get({
    wireVersion: 1,
    kind: 'request',
    requestId,
    method: 'canvas.get',
    input: { projectId },
  }).result;
}

describe('Canvas authority', () => {
  it('loads the project Canvas, binds live targets, mutates placements, and receipts no-ops', async () => {
    const { store, data, database, project, production } = await harness();
    try {
      const empty = data.canvas.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.canvas.get',
        method: 'canvas.get',
        input: { projectId: project.id },
      }).result;
      expect(empty).toMatchObject({
        authority: 'canvas',
        id: 'canvas.1',
        projectId: project.id,
        revision: 0,
        placements: [],
        groups: [],
        edges: [],
        annotations: [],
        savedViews: [],
        viewport: { center: { x: 0, y: 0 }, zoom: 1 },
        nextZIndex: 0,
      });
      const placed = apply(data, project.id, 0, 'request.canvas.place', {
        action: 'place',
        target: { targetType: 'production', targetId: production.id },
        position: { x: 10, y: 20 },
        size: { width: 320, height: 180 },
        zIndex: 4,
      });
      expect(placed).toMatchObject({
        revision: 1,
        nextZIndex: 5,
        placements: [
          {
            id: 'canvas_placement.1',
            target: {
              targetType: 'production',
              targetId: production.id,
              targetRevision: production.revision,
              targetContentHash: production.contentHash,
            },
            revision: 0,
          },
        ],
      });
      const beforeEvents = database.prepare('SELECT count(*) AS count FROM project_events').get();
      const noop = apply(data, project.id, 1, 'request.canvas.move.noop', {
        action: 'move',
        placementId: placed.placements[0]!.id,
        position: placed.placements[0]!.position,
      });
      expect(noop).toEqual(placed);
      expect(database.prepare('SELECT count(*) AS count FROM project_events').get()).toEqual(
        beforeEvents,
      );
      expect(() =>
        apply(data, project.id, 0, 'request.canvas.stale', {
          action: 'resize',
          placementId: placed.placements[0]!.id,
          size: { width: 1, height: 1 },
        }),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    } finally {
      store.close();
    }
  });

  it('upserts groups, edges, annotations and views, then removes placements coherently', async () => {
    const { store, data, project, production } = await harness();
    try {
      let canvas = apply(data, project.id, 0, 'request.canvas.place.a', {
        action: 'place',
        target: { targetType: 'production', targetId: production.id },
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        zIndex: 0,
      });
      canvas = apply(data, project.id, canvas.revision, 'request.canvas.place.b', {
        action: 'place',
        target: { targetType: 'production', targetId: production.id },
        position: { x: 200, y: 0 },
        size: { width: 100, height: 100 },
        zIndex: 1,
      });
      const [first, second] = canvas.placements;
      canvas = apply(data, project.id, canvas.revision, 'request.canvas.group', {
        action: 'group',
        groupId: 'group.story',
        title: 'Story',
        placementIds: [second!.id, first!.id],
      });
      canvas = apply(data, project.id, canvas.revision, 'request.canvas.connect', {
        action: 'connect',
        edgeId: 'edge.story',
        sourcePlacementId: first!.id,
        targetPlacementId: second!.id,
        label: 'next',
      });
      canvas = apply(data, project.id, canvas.revision, 'request.canvas.annotate', {
        action: 'annotate',
        annotationId: 'annotation.story',
        placementId: first!.id,
        text: 'Keep this note',
        geometry: null,
      });
      canvas = apply(data, project.id, canvas.revision, 'request.canvas.save-view', {
        action: 'save_view',
        viewId: 'view.story',
        name: 'Story view',
        viewport: { center: { x: 100, y: 50 }, zoom: 2 },
      });
      canvas = apply(data, project.id, canvas.revision, 'request.canvas.restore-view', {
        action: 'restore_view',
        viewId: 'view.story',
      });
      expect(canvas.viewport).toEqual({ center: { x: 100, y: 50 }, zoom: 2 });
      expect(canvas.groups[0]!.placementIds).toEqual([first!.id, second!.id]);

      const removed = apply(data, project.id, canvas.revision, 'request.canvas.remove', {
        action: 'remove',
        placementIds: [first!.id],
      });
      expect(removed.placements.map(({ id }) => id)).toEqual([second!.id]);
      expect(removed.edges).toEqual([]);
      expect(removed.groups).toMatchObject([
        { id: 'group.story', placementIds: [second!.id], revision: 1 },
      ]);
      expect(removed.annotations).toMatchObject([
        { id: 'annotation.story', placementId: null, text: 'Keep this note', revision: 1 },
      ]);
      expect(removed.nextZIndex).toBe(canvas.nextZIndex);
    } finally {
      store.close();
    }
  });

  it('queries Canvas subgraphs with bounds and follows dependent objects', async () => {
    const { store, data, project, production } = await harness();
    try {
      let canvas = apply(data, project.id, 0, 'request.canvas.query.place.first', {
        action: 'place',
        target: { targetType: 'production', targetId: production.id },
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        zIndex: 0,
      });
      canvas = apply(data, project.id, canvas.revision, 'request.canvas.query.place.second', {
        action: 'place',
        target: { targetType: 'production', targetId: production.id },
        position: { x: 300, y: 0 },
        size: { width: 100, height: 100 },
        zIndex: 1,
      });
      const [first, second] = canvas.placements;
      canvas = apply(data, project.id, canvas.revision, 'request.canvas.query.group', {
        action: 'group',
        groupId: 'group.story',
        title: 'Story',
        placementIds: [first!.id],
      });
      canvas = apply(data, project.id, canvas.revision, 'request.canvas.query.connect', {
        action: 'connect',
        edgeId: 'edge.story',
        sourcePlacementId: first!.id,
        targetPlacementId: second!.id,
        label: 'next',
      });
      canvas = apply(data, project.id, canvas.revision, 'request.canvas.query.annotate.first', {
        action: 'annotate',
        annotationId: 'annotation.attached.first',
        placementId: first!.id,
        text: 'First',
        geometry: null,
      });
      canvas = apply(data, project.id, canvas.revision, 'request.canvas.query.annotate.second', {
        action: 'annotate',
        annotationId: 'annotation.attached.second',
        placementId: second!.id,
        text: 'Second',
        geometry: null,
      });
      canvas = apply(data, project.id, canvas.revision, 'request.canvas.query.annotate.boundary', {
        action: 'annotate',
        annotationId: 'annotation.standalone.boundary',
        placementId: null,
        text: 'Boundary',
        geometry: { position: { x: 100, y: 100 }, size: { width: 20, height: 20 } },
      });
      canvas = apply(data, project.id, canvas.revision, 'request.canvas.query.annotate.none', {
        action: 'annotate',
        annotationId: 'annotation.standalone.none',
        placementId: null,
        text: 'No geometry',
        geometry: null,
      });
      apply(data, project.id, canvas.revision, 'request.canvas.query.view', {
        action: 'save_view',
        viewId: 'view.story',
        name: 'Story',
        viewport: { center: { x: 100, y: 50 }, zoom: 2 },
      });

      const allIncludes: Parameters<typeof data.canvas.queryTool>[1]['include'] = [
        'placements',
        'groups',
        'edges',
        'annotations',
        'saved_views',
      ];
      const bounded = data.canvas.queryTool(project.id, {
        bounds: { position: { x: 100, y: 100 }, size: { width: 100, height: 100 } },
        targetRefs: [],
        groupIds: [],
        edgeIds: [],
        include: allIncludes,
        page: { cursor: null, limit: 20 },
      });
      expect(bounded.page.items.map(({ object }) => `${object.kind}:${object.id}`)).toEqual([
        `placement:${first!.id}`,
        'group:group.story',
        'annotation:annotation.attached.first',
        'annotation:annotation.standalone.boundary',
        'saved_view:view.story',
      ]);

      const targetRef = {
        authority: 'production' as const,
        id: production.id,
        revision: production.revision,
        contentHash: production.contentHash,
      };
      const graph = data.canvas.queryTool(project.id, {
        bounds: null,
        targetRefs: [targetRef],
        groupIds: ['group.story'],
        edgeIds: ['edge.story'],
        include: allIncludes,
        page: { cursor: null, limit: 20 },
      });
      expect(graph.page.items.map(({ object }) => `${object.kind}:${object.id}`)).toEqual([
        `placement:${first!.id}`,
        'group:group.story',
        'annotation:annotation.attached.first',
      ]);
      expect(
        data.canvas.queryTool(project.id, {
          bounds: null,
          targetRefs: [{ ...targetRef, contentHash: 'f'.repeat(64) }],
          groupIds: [],
          edgeIds: [],
          include: ['placements'],
          page: { cursor: null, limit: 20 },
        }).page.items,
      ).toEqual([]);
    } finally {
      store.close();
    }
  });

  it('paginates Canvas query results and rejects changed cursors', async () => {
    const { store, data, project, production } = await harness();
    try {
      let canvas = apply(data, project.id, 0, 'request.canvas.cursor.place.first', {
        action: 'place',
        target: { targetType: 'production', targetId: production.id },
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        zIndex: 0,
      });
      canvas = apply(data, project.id, canvas.revision, 'request.canvas.cursor.place.second', {
        action: 'place',
        target: { targetType: 'production', targetId: production.id },
        position: { x: 200, y: 0 },
        size: { width: 100, height: 100 },
        zIndex: 1,
      });
      const firstPage = data.canvas.queryTool(project.id, {
        bounds: null,
        targetRefs: [],
        groupIds: [],
        edgeIds: [],
        include: ['placements'],
        page: { cursor: null, limit: 1 },
      });
      const cursor = firstPage.page.nextCursor;
      expect(cursor).not.toBeNull();
      const secondPage = data.canvas.queryTool(project.id, {
        bounds: null,
        targetRefs: [],
        groupIds: [],
        edgeIds: [],
        include: ['placements'],
        page: { cursor, limit: 1 },
      });
      expect(
        [...firstPage.page.items, ...secondPage.page.items].map(({ object }) => object.id),
      ).toEqual(canvas.placements.map(({ id }) => id));
      expect(() =>
        data.canvas.queryTool(project.id, {
          bounds: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 } },
          targetRefs: [],
          groupIds: [],
          edgeIds: [],
          include: ['placements'],
          page: { cursor, limit: 1 },
        }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

      apply(data, project.id, canvas.revision, 'request.canvas.cursor.move', {
        action: 'move',
        placementId: canvas.placements[1]!.id,
        position: { x: 250, y: 0 },
      });
      expect(() =>
        data.canvas.queryTool(project.id, {
          bounds: null,
          targetRefs: [],
          groupIds: [],
          edgeIds: [],
          include: ['placements'],
          page: { cursor, limit: 1 },
        }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      store.close();
    }
  });

  it('executes all Canvas tool mutation actions through the shared mutation core', async () => {
    const { store, data, project, production } = await harness();
    try {
      let revision = 0;
      const firstPlaced = mutateTool(
        data,
        project.id,
        {
          action: 'place',
          target: { targetType: 'production', targetId: production.id },
          geometry: { position: { x: 0, y: 0 }, size: { width: 100, height: 100 } },
          expectedCanvasRevision: revision,
        },
        'dispatch.canvas.tool.place.first',
      );
      revision = firstPlaced.canvasRevision;
      const secondPlaced = mutateTool(
        data,
        project.id,
        {
          action: 'place',
          target: { targetType: 'production', targetId: production.id },
          geometry: { position: { x: 200, y: 0 }, size: { width: 80, height: 60 } },
          expectedCanvasRevision: revision,
        },
        'dispatch.canvas.tool.place.second',
      );
      revision = secondPlaced.canvasRevision;
      let canvas = getCanvas(data, project.id, 'request.canvas.tool.after-place');
      const [first, second] = canvas.placements;
      expect([first!.zIndex, second!.zIndex]).toEqual([0, 1]);

      const moved = mutateTool(
        data,
        project.id,
        {
          action: 'move',
          placementId: first!.id,
          geometry: { position: { x: 50, y: 80 }, size: { width: 1, height: 1 } },
          expectedCanvasRevision: revision,
          expectedPlacementRevision: first!.revision,
        },
        'dispatch.canvas.tool.move',
      );
      revision = moved.canvasRevision;
      canvas = getCanvas(data, project.id, 'request.canvas.tool.after-move');
      expect(canvas.placements.find(({ id }) => id === first!.id)).toMatchObject({
        position: { x: 50, y: 80 },
        size: { width: 100, height: 100 },
        revision: 1,
      });

      const resized = mutateTool(
        data,
        project.id,
        {
          action: 'resize',
          placementId: first!.id,
          geometry: { position: { x: 999, y: 999 }, size: { width: 120, height: 90 } },
          expectedCanvasRevision: revision,
          expectedPlacementRevision: 1,
        },
        'dispatch.canvas.tool.resize',
      );
      revision = resized.canvasRevision;
      canvas = getCanvas(data, project.id, 'request.canvas.tool.after-resize');
      const resizedFirst = canvas.placements.find(({ id }) => id === first!.id)!;
      const currentSecond = canvas.placements.find(({ id }) => id === second!.id)!;
      expect(resizedFirst).toMatchObject({
        position: { x: 50, y: 80 },
        size: { width: 120, height: 90 },
        revision: 2,
      });

      const grouped = mutateTool(
        data,
        project.id,
        {
          action: 'group',
          placements: [
            { placementId: currentSecond.id, revision: currentSecond.revision },
            { placementId: resizedFirst.id, revision: resizedFirst.revision },
          ],
          title: 'Sequence',
          expectedCanvasRevision: revision,
        },
        'dispatch.canvas.tool.group',
      );
      revision = grouped.canvasRevision;
      const groupId = grouped.receipts[0]!.object.id;

      const connected = mutateTool(
        data,
        project.id,
        {
          action: 'connect',
          sourcePlacementId: resizedFirst.id,
          targetPlacementId: currentSecond.id,
          label: 'next',
          expectedCanvasRevision: revision,
        },
        'dispatch.canvas.tool.connect',
      );
      revision = connected.canvasRevision;
      const edgeId = connected.receipts[0]!.object.id;

      const annotated = mutateTool(
        data,
        project.id,
        {
          action: 'annotate',
          placementId: resizedFirst.id,
          text: 'Keep this framing',
          geometry: null,
          expectedCanvasRevision: revision,
        },
        'dispatch.canvas.tool.annotate',
      );
      revision = annotated.canvasRevision;

      const arranged = mutateTool(
        data,
        project.id,
        {
          action: 'arrange',
          placements: [
            { placementId: resizedFirst.id, revision: resizedFirst.revision },
            { placementId: currentSecond.id, revision: currentSecond.revision },
          ],
          layout: 'row',
          spacing: 10,
          expectedCanvasRevision: revision,
        },
        'dispatch.canvas.tool.arrange',
      );
      revision = arranged.canvasRevision;
      expect(arranged.receipts).toHaveLength(1);
      canvas = getCanvas(data, project.id, 'request.canvas.tool.after-arrange');
      expect(canvas.placements.find(({ id }) => id === currentSecond.id)).toMatchObject({
        position: { x: 180, y: 80 },
        revision: 1,
      });

      const saved = mutateTool(
        data,
        project.id,
        {
          action: 'save_view',
          viewId: null,
          name: 'Story view',
          viewport: { center: { x: 80, y: 40 }, zoom: 2 },
          expectedCanvasRevision: revision,
        },
        'dispatch.canvas.tool.save-view',
      );
      revision = saved.canvasRevision;
      const viewId = saved.receipts[0]!.object.id;

      const restored = mutateTool(
        data,
        project.id,
        {
          action: 'restore_view',
          viewId,
          expectedCanvasRevision: revision,
          expectedViewRevision: 0,
        },
        'dispatch.canvas.tool.restore-view',
      );
      revision = restored.canvasRevision;
      expect(restored.receipts[0]).toMatchObject({
        object: { kind: 'saved_view', id: viewId, revision: 0 },
        previousRevision: 0,
        changedPaths: ['viewport'],
        undoRef: null,
      });

      const disconnected = mutateTool(
        data,
        project.id,
        {
          action: 'disconnect',
          edgeId,
          expectedCanvasRevision: revision,
          expectedEdgeRevision: 0,
        },
        'dispatch.canvas.tool.disconnect',
      );
      revision = disconnected.canvasRevision;
      expect(disconnected.receipts).toMatchObject([
        {
          object: { kind: 'edge', id: edgeId, revision: 1 },
          previousRevision: 0,
          changedPaths: ['deleted', 'sourcePlacementId', 'targetPlacementId'],
        },
      ]);

      const ungrouped = mutateTool(
        data,
        project.id,
        {
          action: 'ungroup',
          groupId,
          expectedCanvasRevision: revision,
          expectedGroupRevision: 0,
        },
        'dispatch.canvas.tool.ungroup',
      );
      revision = ungrouped.canvasRevision;
      expect(ungrouped.receipts).toMatchObject([
        {
          object: { kind: 'group', id: groupId, revision: 1 },
          previousRevision: 0,
          changedPaths: ['deleted', 'placementIds'],
        },
      ]);

      const removed = mutateTool(
        data,
        project.id,
        {
          action: 'remove',
          placements: [{ placementId: resizedFirst.id, revision: resizedFirst.revision }],
          expectedCanvasRevision: revision,
        },
        'dispatch.canvas.tool.remove',
      );
      expect(removed.canvasRevision).toBe(revision + 1);
      expect(removed.receipts.map(({ object }) => object.kind)).toEqual([
        'placement',
        'annotation',
      ]);
    } finally {
      store.close();
    }
  });

  it('uses the requested arrange order for row, column, timeline, and grid layouts', async () => {
    const { store, data, project, production } = await harness();
    try {
      let revision = 0;
      const positions = [
        { x: 0, y: 0 },
        { x: 100, y: 10 },
        { x: 200, y: 20 },
        { x: 300, y: 30 },
      ];
      const sizes = [
        { width: 10, height: 10 },
        { width: 20, height: 30 },
        { width: 30, height: 20 },
        { width: 40, height: 5 },
      ];
      for (const [index, position] of positions.entries()) {
        const placed = mutateTool(
          data,
          project.id,
          {
            action: 'place',
            target: { targetType: 'production', targetId: production.id },
            geometry: { position, size: sizes[index]! },
            expectedCanvasRevision: revision,
          },
          `dispatch.canvas.arrange.place.${index}`,
        );
        revision = placed.canvasRevision;
      }
      let canvas = getCanvas(data, project.id, 'request.canvas.arrange.initial');
      const orderedIds = canvas.placements.map(({ id }) => id);
      const arrange = (
        layout: 'row' | 'column' | 'timeline' | 'grid',
        spacing: number,
        dispatchOperationId: string,
      ) => {
        const result = mutateTool(
          data,
          project.id,
          {
            action: 'arrange',
            placements: orderedIds.map((placementId) => ({
              placementId,
              revision: canvas.placements.find(({ id }) => id === placementId)!.revision,
            })),
            layout,
            spacing,
            expectedCanvasRevision: revision,
          },
          dispatchOperationId,
        );
        revision = result.canvasRevision;
        canvas = getCanvas(data, project.id, `request.canvas.arrange.${layout}`);
        expect(result.receipts).toHaveLength(3);
      };

      arrange('row', 5, 'dispatch.canvas.arrange.row');
      expect(canvas.placements.map(({ position }) => position)).toEqual([
        { x: 0, y: 0 },
        { x: 15, y: 0 },
        { x: 40, y: 0 },
        { x: 75, y: 0 },
      ]);
      arrange('column', 5, 'dispatch.canvas.arrange.column');
      expect(canvas.placements.map(({ position }) => position)).toEqual([
        { x: 0, y: 0 },
        { x: 0, y: 15 },
        { x: 0, y: 50 },
        { x: 0, y: 75 },
      ]);
      arrange('timeline', 5, 'dispatch.canvas.arrange.timeline');
      expect(canvas.placements.map(({ position }) => position)).toEqual([
        { x: 0, y: 0 },
        { x: 15, y: 0 },
        { x: 40, y: 0 },
        { x: 75, y: 0 },
      ]);
      arrange('grid', 7, 'dispatch.canvas.arrange.grid');
      expect(canvas.placements.map(({ position }) => position)).toEqual([
        { x: 0, y: 0 },
        { x: 37, y: 0 },
        { x: 0, y: 37 },
        { x: 37, y: 37 },
      ]);
    } finally {
      store.close();
    }
  });

  it('rejects stale child CAS and semantic no-ops without writes', async () => {
    const { store, data, database, project, production } = await harness();
    try {
      const placed = mutateTool(
        data,
        project.id,
        {
          action: 'place',
          target: { targetType: 'production', targetId: production.id },
          geometry: { position: { x: 10, y: 20 }, size: { width: 100, height: 80 } },
          expectedCanvasRevision: 0,
        },
        'dispatch.canvas.rollback.place',
      );
      const placementId = placed.receipts[0]!.object.id;
      const eventCount = database.prepare('SELECT count(*) AS count FROM project_events').get();
      expect(() =>
        mutateTool(
          data,
          project.id,
          {
            action: 'move',
            placementId,
            geometry: { position: { x: 50, y: 50 }, size: { width: 100, height: 80 } },
            expectedCanvasRevision: placed.canvasRevision,
            expectedPlacementRevision: 99,
          },
          'dispatch.canvas.rollback.stale',
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(getCanvas(data, project.id, 'request.canvas.rollback.after-stale')).toMatchObject({
        revision: placed.canvasRevision,
        placements: [{ id: placementId, revision: 0, position: { x: 10, y: 20 } }],
      });
      expect(database.prepare('SELECT count(*) AS count FROM project_events').get()).toEqual(
        eventCount,
      );

      expect(() =>
        mutateTool(
          data,
          project.id,
          {
            action: 'move',
            placementId,
            geometry: { position: { x: 10, y: 20 }, size: { width: 1, height: 1 } },
            expectedCanvasRevision: placed.canvasRevision,
            expectedPlacementRevision: 0,
          },
          'dispatch.canvas.rollback.noop',
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(getCanvas(data, project.id, 'request.canvas.rollback.after-noop')).toMatchObject({
        revision: placed.canvasRevision,
        placements: [{ id: placementId, revision: 0, size: { width: 100, height: 80 } }],
      });
      expect(database.prepare('SELECT count(*) AS count FROM project_events').get()).toEqual(
        eventCount,
      );
    } finally {
      store.close();
    }
  });

  it('writes one event and complete cascade receipts for Canvas removal', async () => {
    const { store, data, database, project, production } = await harness();
    try {
      let revision = 0;
      const place = (position: { x: number; y: number }, dispatchOperationId: string) => {
        const result = mutateTool(
          data,
          project.id,
          {
            action: 'place',
            target: { targetType: 'production', targetId: production.id },
            geometry: { position, size: { width: 100, height: 80 } },
            expectedCanvasRevision: revision,
          },
          dispatchOperationId,
        );
        revision = result.canvasRevision;
      };
      place({ x: 0, y: 0 }, 'dispatch.canvas.cascade.place.first');
      place({ x: 200, y: 0 }, 'dispatch.canvas.cascade.place.second');
      let canvas = getCanvas(data, project.id, 'request.canvas.cascade.placements');
      const [first, second] = canvas.placements;
      const grouped = mutateTool(
        data,
        project.id,
        {
          action: 'group',
          placements: [
            { placementId: first!.id, revision: first!.revision },
            { placementId: second!.id, revision: second!.revision },
          ],
          title: 'Remove together',
          expectedCanvasRevision: revision,
        },
        'dispatch.canvas.cascade.group',
      );
      revision = grouped.canvasRevision;
      const connected = mutateTool(
        data,
        project.id,
        {
          action: 'connect',
          sourcePlacementId: first!.id,
          targetPlacementId: second!.id,
          label: 'bridge',
          expectedCanvasRevision: revision,
        },
        'dispatch.canvas.cascade.connect',
      );
      revision = connected.canvasRevision;
      const annotated = mutateTool(
        data,
        project.id,
        {
          action: 'annotate',
          placementId: first!.id,
          text: 'Detached when removed',
          geometry: null,
          expectedCanvasRevision: revision,
        },
        'dispatch.canvas.cascade.annotate',
      );
      revision = annotated.canvasRevision;
      canvas = getCanvas(data, project.id, 'request.canvas.cascade.before-remove');
      const beforeEvents = database.prepare('SELECT count(*) AS count FROM project_events').get();
      const removed = mutateTool(
        data,
        project.id,
        {
          action: 'remove',
          placements: canvas.placements.map(({ id, revision: placementRevision }) => ({
            placementId: id,
            revision: placementRevision,
          })),
          expectedCanvasRevision: revision,
        },
        'dispatch.canvas.cascade.remove',
      );
      expect(removed.receipts).toHaveLength(5);
      expect(new Set(removed.receipts.map(({ eventId }) => eventId))).toEqual(
        new Set([removed.receipts[0]!.eventId]),
      );
      expect(removed.receipts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            object: expect.objectContaining({ kind: 'placement', id: first!.id, revision: 1 }),
            previousRevision: 0,
            changedPaths: ['deleted'],
            undoRef: null,
          }),
          expect.objectContaining({
            object: expect.objectContaining({ kind: 'group', revision: 1 }),
            previousRevision: 0,
            changedPaths: ['placementIds'],
          }),
          expect.objectContaining({
            object: expect.objectContaining({ kind: 'edge', revision: 1 }),
            previousRevision: 0,
            changedPaths: ['deleted', 'sourcePlacementId', 'targetPlacementId'],
          }),
          expect.objectContaining({
            object: expect.objectContaining({ kind: 'annotation', revision: 1 }),
            previousRevision: 0,
            changedPaths: ['placementId'],
          }),
        ]),
      );
      expect(database.prepare('SELECT count(*) AS count FROM project_events').get()).toEqual({
        count: (beforeEvents as { count: number }).count + 1,
      });
    } finally {
      store.close();
    }
  });

  it('derives Canvas tool IDs from the dispatch operation seed', async () => {
    const { store, data, project, production } = await harness();
    try {
      const input = {
        action: 'place' as const,
        target: { targetType: 'production' as const, targetId: production.id },
        geometry: { position: { x: 10, y: 20 }, size: { width: 100, height: 80 } },
        expectedCanvasRevision: 0,
      };
      const dispatchOperationId = 'dispatch.canvas.deterministic';
      const planned = plannedCanvasMutationIds(dispatchOperationId, input);
      const result = mutateTool(data, project.id, input, dispatchOperationId);
      expect(result.receipts[0]).toMatchObject({
        object: { kind: 'placement', id: planned.placementId, revision: 0 },
        eventId: planned.projectEventId,
      });
      expect(plannedCanvasMutationIds(dispatchOperationId, input)).toEqual(planned);
    } finally {
      store.close();
    }
  });
});
