import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MediaCas, MediaImportCapabilityResolver } from '../kernel/media-cas.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import { createTargetDataAccess } from '../kernel/data-access.js';
import { createTargetStore } from '../kernel/store.js';
import {
  commitPlannedProductionMutationInTransaction,
  planProductionMutationInTransaction,
  plannedProductionMutationIds,
  productionMutationIdsForVariant,
} from './production.js';

const NOW = '2026-08-15T12:00:00.000Z';
const LATER = '2026-08-15T13:00:00.000Z';
const directories: string[] = [];
const context = {
  actor: 'commander' as const,
  causation: { kind: 'run' as const, runId: 'run.production.1' },
  correlationId: 'correlation.production.1',
};
const budget = {
  costUsd: { state: 'known' as const, value: '20', currency: 'USD' },
  maxGenerationCount: 12,
  maxInputTokens: 100_000,
  maxOutputTokens: 20_000,
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
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-production-'));
  directories.push(directory);
  const store = await createTargetStore(join(directory, 'project.sqlite'));
  let now = NOW;
  const environment = {
    now: () => now,
    createId: deterministicIds(),
    mediaCas: unusedMediaCas,
    mediaImportCapabilities: unusedCapabilities,
  };
  const data = createTargetDataAccess(store, environment);
  const project = data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.project.production',
      method: 'project.create',
      input: {
        name: 'Film',
        permissionMode: 'reversible',
        budget,
        formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
      },
    },
    { ...context, actor: 'user', causation: { kind: 'direct_ui', actionId: 'create.project' } },
  ).result.project;
  return {
    store,
    data,
    database: getTargetStoreDatabase(store),
    environment,
    project,
    setNow: (value: string) => (now = value),
  };
}

function createStory(
  data: Awaited<ReturnType<typeof harness>>['data'],
  requestId: string,
  title: string,
) {
  return data.production.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId,
      method: 'production.apply',
      input: {
        action: 'create',
        projectId: 'project.1',
        expectedProjectRevision: 0,
        value: {
          objectType: 'story',
          content: { title, premise: 'Premise', synopsis: 'Synopsis' },
        },
        relations: [],
      },
    },
    context,
  ).result;
}

type ProductionFixture = Awaited<ReturnType<typeof harness>>;
type ProductionMutationInput = Parameters<typeof planProductionMutationInTransaction>[3];

function productionRef(object: {
  readonly id: string;
  readonly revision: number;
  readonly contentHash: string;
}) {
  return {
    authority: 'production' as const,
    id: object.id,
    revision: object.revision,
    contentHash: object.contentHash,
  };
}

function expectedProductionRef(object: {
  readonly id: string;
  readonly revision: number;
  readonly contentHash: string;
}) {
  return {
    ref: productionRef(object),
    expectedRevision: object.revision,
    expectedContentHash: object.contentHash,
  };
}

function storyValue(title: string) {
  return {
    objectType: 'story' as const,
    content: { title, premise: 'Premise', synopsis: 'Synopsis' },
  };
}

function projectRevision(fixture: ProductionFixture, projectId = fixture.project.id): number {
  return (
    fixture.database.prepare('SELECT revision FROM projects WHERE id = ?').get(projectId) as {
      revision: number;
    }
  ).revision;
}

function totalChanges(fixture: ProductionFixture): number {
  return Number(
    (
      fixture.database.prepare('SELECT total_changes() AS total').get() as {
        total: number;
      }
    ).total,
  );
}

function projectEventCount(fixture: ProductionFixture): number {
  return Number(
    (
      fixture.database.prepare('SELECT count(*) AS count FROM project_events').get() as {
        count: number;
      }
    ).count,
  );
}

function currentProduction(fixture: ProductionFixture, id: string) {
  return fixture.data.production.get(id).object;
}

function planToolMutation(
  fixture: ProductionFixture,
  input: ProductionMutationInput,
  dispatchOperationId: string,
  projectId = fixture.project.id,
) {
  const before = totalChanges(fixture);
  const planned = withImmediateTransaction(fixture.database, () =>
    planProductionMutationInTransaction(
      fixture.database,
      fixture.environment,
      projectId,
      input,
      NOW,
      plannedProductionMutationIds(dispatchOperationId, input),
    ),
  );
  expect(totalChanges(fixture)).toBe(before);
  return planned;
}

function commitToolMutation(
  fixture: ProductionFixture,
  planned: ReturnType<typeof planProductionMutationInTransaction>,
) {
  const changesBefore = totalChanges(fixture);
  const eventsBefore = projectEventCount(fixture);
  const committed = withImmediateTransaction(fixture.database, () =>
    commitPlannedProductionMutationInTransaction(
      fixture.database,
      fixture.environment,
      planned,
      context,
    ),
  );
  if (committed.receipts.length === 0) {
    expect(totalChanges(fixture)).toBe(changesBefore);
    expect(projectEventCount(fixture)).toBe(eventsBefore);
    return committed;
  }
  expect(projectEventCount(fixture)).toBe(eventsBefore + committed.receipts.length);
  expect(totalChanges(fixture)).toBeGreaterThan(changesBefore);
  for (const receipt of committed.receipts) {
    expect(receipt.changedPaths.length).toBeGreaterThan(0);
    expect(receipt.undoRef).toBeNull();
    expect(
      fixture.database.prepare('SELECT id FROM project_events WHERE id = ?').get(receipt.eventId),
    ).toEqual({ id: receipt.eventId });
    expect(
      fixture.database
        .prepare(
          `SELECT source_revision, source_hash
           FROM project_search_documents
           WHERE project_id = ? AND source_kind = 'production' AND source_id = ?`,
        )
        .get(planned.projectId, receipt.object.id),
    ).toEqual({
      source_revision: receipt.object.revision,
      source_hash: receipt.object.contentHash,
    });
  }
  return committed;
}

function executeToolMutation(
  fixture: ProductionFixture,
  input: ProductionMutationInput,
  dispatchOperationId: string,
  projectId = fixture.project.id,
) {
  const planned = planToolMutation(fixture, input, dispatchOperationId, projectId);
  return { planned, committed: commitToolMutation(fixture, planned) };
}

function createRoot(
  fixture: ProductionFixture,
  title: string,
  dispatchOperationId: string,
  projectId = fixture.project.id,
) {
  const { planned, committed } = executeToolMutation(
    fixture,
    {
      action: 'create',
      expectedProjectRevision: projectRevision(fixture, projectId),
      parentRef: null,
      order: null,
      value: storyValue(title),
    },
    dispatchOperationId,
    projectId,
  );
  expect(committed.receipts).toHaveLength(1);
  return {
    planned,
    committed,
    object: currentProduction(fixture, committed.receipts[0]!.object.id),
  };
}

function relationMutation(
  mode: 'link' | 'unlink',
  relation: 'contains' | 'references',
  source: { readonly id: string; readonly revision: number; readonly contentHash: string },
  target: { readonly id: string; readonly revision: number; readonly contentHash: string },
  ordinal: number | null,
): ProductionMutationInput {
  return {
    action: 'relate',
    mode,
    relation,
    ordinal,
    source: expectedProductionRef(source),
    target: expectedProductionRef(target),
  };
}

function expectPlanFailureWithoutWrites(
  fixture: ProductionFixture,
  operation: () => unknown,
  code: 'INVALID_REQUEST' | 'REVISION_CONFLICT',
) {
  const before = totalChanges(fixture);
  expect(operation).toThrowError(expect.objectContaining({ code }));
  expect(totalChanges(fixture)).toBe(before);
}

describe('Production authority', () => {
  it('allocates generated IDs from concrete wire variants without a mutation payload', () => {
    const calls: Array<[string, string]> = [];
    const nextId = (kind: string, role: string) => {
      calls.push([kind, role]);
      return `${kind}.${calls.length}`;
    };

    const created = productionMutationIdsForVariant('production_create', true, nextId);
    const updated = productionMutationIdsForVariant('production_update', false, nextId);
    const cited = productionMutationIdsForVariant('production_cite', false, nextId);

    expect(created).toEqual({
      tool: 'production.mutate',
      variant: 'production_create',
      productionObjectId: 'production.1',
      containmentRelationId: 'production_relation.2',
      objectEventId: 'project_event.3',
      parentEventId: 'project_event.4',
    });
    expect(updated).toEqual({
      tool: 'production.mutate',
      variant: 'production_update',
      objectEventId: 'project_event.5',
    });
    expect(cited).toEqual({
      tool: 'production.mutate',
      variant: 'production_cite',
      factSourceId: 'production_fact_source.6',
      objectEventId: 'project_event.7',
    });
    expect(calls).toEqual([
      ['production', 'production_object'],
      ['production_relation', 'containment_relation'],
      ['project_event', 'object_event'],
      ['project_event', 'parent_event'],
      ['project_event', 'object_event'],
      ['production_fact_source', 'fact_source'],
      ['project_event', 'object_event'],
    ]);
  });

  it('plans and commits deterministic Production tool creation receipts', async () => {
    const { store, database, environment, project } = await harness();
    try {
      const planned = withImmediateTransaction(database, () =>
        planProductionMutationInTransaction(
          database,
          environment,
          project.id,
          {
            action: 'create',
            expectedProjectRevision: project.revision,
            parentRef: null,
            order: null,
            value: {
              objectType: 'story',
              content: { title: 'Planned', premise: 'Premise', synopsis: 'Synopsis' },
            },
          },
          NOW,
          plannedProductionMutationIds('dispatch.production.create', 'create'),
        ),
      );
      const committed = withImmediateTransaction(database, () =>
        commitPlannedProductionMutationInTransaction(database, environment, planned, context),
      );
      expect(committed.receipts).toMatchObject([
        {
          object: { authority: 'production', id: planned.ids.productionObjectId, revision: 0 },
          previousRevision: null,
          eventId: planned.ids.objectEventId,
          changedPaths: ['content'],
          undoRef: null,
        },
      ]);
    } finally {
      store.close();
    }
  });

  it('creates canonical objects, validates relations, pages by type/id, and replays receipts', async () => {
    const { store, data, database } = await harness();
    try {
      const first = createStory(data, 'request.production.create.1', 'First');
      const request = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.production.create.2',
        method: 'production.apply' as const,
        input: {
          action: 'create' as const,
          projectId: 'project.1',
          expectedProjectRevision: 0,
          value: {
            objectType: 'scene' as const,
            content: { title: 'Scene', summary: 'Summary' },
          },
          relations: [
            {
              relation: 'contains' as const,
              targetType: 'story' as const,
              targetId: first.object.id,
              ordinal: 0,
            },
          ],
        },
      };
      const second = data.production.apply(request, context);
      expect(second.result.object).toMatchObject({
        authority: 'production',
        id: 'production.2',
        type: 'scene',
        revision: 0,
        lifecycle: 'active',
        createdBy: context.causation,
        updatedBy: context.causation,
      });
      expect(second.result.object.relations).toEqual([]);
      expect(data.production.apply(request, context)).toEqual(second);
      expect(database.prepare('SELECT count(*) AS count FROM production_objects').get()).toEqual({
        count: 2,
      });

      const page = data.production.query({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.production.query.1',
        method: 'production.query',
        input: {
          projectId: 'project.1',
          ids: [],
          types: [],
          includeArchived: false,
          includeFactSources: false,
          page: { cursor: null, limit: 1 },
        },
      });
      const next = data.production.query({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.production.query.2',
        method: 'production.query',
        input: {
          projectId: 'project.1',
          ids: [],
          types: [],
          includeArchived: false,
          includeFactSources: false,
          page: { cursor: page.result.nextCursor, limit: 1 },
        },
      });
      expect([...page.result.items, ...next.result.items].map(({ object }) => object.type)).toEqual(
        ['scene', 'story'],
      );
    } finally {
      store.close();
    }
  });

  it('projects CAS-bound production tool queries with direct parent links and typed sections', async () => {
    const { store, data } = await harness();
    try {
      const source = createStory(data, 'request.production.tool.source', 'Source story');
      const parent = createStory(data, 'request.production.tool.parent', 'Parent story');
      const child = data.production.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.production.tool.child',
          method: 'production.apply',
          input: {
            action: 'create',
            projectId: source.object.projectId,
            expectedProjectRevision: 0,
            value: {
              objectType: 'scene',
              content: { title: 'Child scene', summary: 'Child summary' },
            },
            relations: [
              {
                relation: 'contains',
                targetType: 'story',
                targetId: parent.object.id,
                ordinal: 0,
              },
              {
                relation: 'references',
                targetType: 'story',
                targetId: source.object.id,
                ordinal: null,
              },
            ],
          },
        },
        context,
      ).result;
      const cited = data.production.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.production.tool.cite',
          method: 'production.apply',
          input: {
            action: 'cite',
            projectId: child.object.projectId,
            ref: {
              authority: 'production',
              id: child.object.id,
              revision: child.object.revision,
              contentHash: child.object.contentHash,
            },
            field: 'summary',
            source: {
              authority: 'production',
              id: source.object.id,
              revision: source.object.revision,
              contentHash: source.object.contentHash,
            },
            relation: 'supports',
          },
        },
        context,
      ).result;
      data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.production.tool.protect',
          method: 'decision.protect',
          input: {
            mode: 'protect',
            owner: {
              authority: 'production',
              id: cited.object.id,
              revision: cited.object.revision,
              contentHash: cited.object.contentHash,
            },
            field: { owner: 'production', objectId: cited.object.id, field: 'content' },
            reason: 'Keep this scene.',
          },
        },
        {
          actor: 'user',
          causation: { kind: 'direct_ui', actionId: 'action.production.tool.protect' },
          correlationId: 'correlation.production.tool.protect',
        },
      );
      const currentChildView = data.production.get(child.object.id);
      const currentChild = currentChildView.object;
      const childRef = {
        authority: 'production' as const,
        id: currentChild.id,
        revision: currentChild.revision,
        contentHash: currentChild.contentHash,
      };
      const currentParent = data.production.get(parent.object.id).object;
      const parentRef = {
        authority: 'production' as const,
        id: currentParent.id,
        revision: currentParent.revision,
        contentHash: currentParent.contentHash,
      };

      const projected = data.production.queryTool(source.object.projectId, {
        refs: [childRef],
        kinds: ['scene'],
        parentRef,
        relation: 'references',
        include: ['content', 'relations', 'citations', 'protections'],
        page: { cursor: null, limit: 20 },
      });
      expect(projected).toEqual({
        items: [
          {
            ref: childRef,
            type: 'scene',
            lifecycle: 'active',
            title: 'Child scene',
            summary: 'Child summary',
            sections: [
              {
                section: 'content',
                content: { objectType: 'scene', content: currentChild.content },
              },
              { section: 'relations', relations: currentChild.relations },
              { section: 'citations', factSources: currentChildView.factSources },
              { section: 'protections', protections: currentChild.protections },
            ],
          },
        ],
        nextCursor: null,
      });
      expect(
        data.production
          .queryTool(source.object.projectId, {
            refs: [],
            kinds: ['scene'],
            parentRef: null,
            relation: 'references',
            include: [],
            page: { cursor: null, limit: 20 },
          })
          .items.map(({ ref }) => ref.id),
      ).toEqual([child.object.id]);
      expect(
        data.production.queryTool(source.object.projectId, {
          refs: [childRef],
          kinds: ['story'],
          parentRef: null,
          relation: null,
          include: [],
          page: { cursor: null, limit: 20 },
        }),
      ).toEqual({ items: [], nextCursor: null });
      expect(() =>
        data.production.queryTool(source.object.projectId, {
          refs: [
            {
              authority: 'production',
              id: child.object.id,
              revision: child.object.revision,
              contentHash: child.object.contentHash,
            },
          ],
          kinds: [],
          parentRef: null,
          relation: null,
          include: [],
          page: { cursor: null, limit: 20 },
        }),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));

      const first = data.production.queryTool(source.object.projectId, {
        refs: [],
        kinds: [],
        parentRef: null,
        relation: null,
        include: [],
        page: { cursor: null, limit: 1 },
      });
      expect(first.items.map(({ ref }) => ref.id)).toEqual([child.object.id]);
      expect(first.nextCursor).not.toBeNull();
      const next = data.production.queryTool(source.object.projectId, {
        refs: [],
        kinds: [],
        parentRef: null,
        relation: null,
        include: [],
        page: { cursor: first.nextCursor, limit: 20 },
      });
      expect(next.items.map(({ ref }) => ref.id)).toEqual([source.object.id, parent.object.id]);
      expect(next.items[0]).toMatchObject({ title: 'Source story', summary: 'Premise' });
      expect(() =>
        data.production.queryTool(source.object.projectId, {
          refs: [],
          kinds: [],
          parentRef: null,
          relation: null,
          include: ['content'],
          page: { cursor: first.nextCursor, limit: 1 },
        }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

      data.production.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.production.tool.delete',
          method: 'production.apply',
          input: {
            action: 'replace',
            projectId: source.object.projectId,
            ref: {
              authority: 'production',
              id: source.object.id,
              revision: source.object.revision,
              contentHash: source.object.contentHash,
            },
            value: { objectType: 'story', content: source.object.content },
            relations: source.object.relations,
            lifecycle: 'deleted',
          },
        },
        context,
      );
      expect(
        data.production
          .queryTool(source.object.projectId, {
            refs: [],
            kinds: [],
            parentRef: null,
            relation: null,
            include: [],
            page: { cursor: null, limit: 20 },
          })
          .items.map(({ ref }) => ref.id),
      ).not.toContain(source.object.id);
    } finally {
      store.close();
    }
  });

  it('uses dual CAS, receipts exact no-ops, enforces active protections, and records citations', async () => {
    const { store, data, database, setNow } = await harness();
    try {
      const source = createStory(data, 'request.production.source', 'Source');
      const target = createStory(data, 'request.production.target', 'Target');
      setNow(LATER);
      const replacement = data.production.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.production.replace',
          method: 'production.apply',
          input: {
            action: 'replace',
            projectId: target.object.projectId,
            ref: {
              authority: 'production',
              id: target.object.id,
              revision: target.object.revision,
              contentHash: target.object.contentHash,
            },
            lifecycle: 'active',
            value: {
              objectType: 'story',
              content: { ...target.object.content, synopsis: 'Revised' },
            },
            relations: [],
          },
        },
        context,
      ).result;
      expect(replacement.object).toMatchObject({ revision: 1, updatedAt: LATER });
      const events = database.prepare('SELECT count(*) AS count FROM project_events').get();
      const noop = data.production.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.production.noop',
          method: 'production.apply',
          input: {
            action: 'replace',
            projectId: replacement.object.projectId,
            ref: {
              authority: 'production',
              id: replacement.object.id,
              revision: replacement.object.revision,
              contentHash: replacement.object.contentHash,
            },
            lifecycle: replacement.object.lifecycle,
            value: { objectType: 'story', content: replacement.object.content },
            relations: replacement.object.relations,
          },
        },
        context,
      );
      expect(noop.result).toEqual(replacement);
      expect(database.prepare('SELECT count(*) AS count FROM project_events').get()).toEqual(
        events,
      );

      const cited = data.production.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.production.cite',
          method: 'production.apply',
          input: {
            action: 'cite',
            projectId: replacement.object.projectId,
            ref: {
              authority: 'production',
              id: replacement.object.id,
              revision: replacement.object.revision,
              contentHash: replacement.object.contentHash,
            },
            field: 'synopsis',
            source: {
              authority: 'production',
              id: source.object.id,
              revision: source.object.revision,
              contentHash: source.object.contentHash,
            },
            relation: 'supports',
          },
        },
        context,
      ).result;
      expect(cited).toMatchObject({
        object: { revision: 2 },
        factSources: [{ field: 'synopsis' }],
      });

      const protectedOwner = data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.production.protect',
          method: 'decision.protect',
          input: {
            mode: 'protect',
            owner: {
              authority: 'production',
              id: cited.object.id,
              revision: cited.object.revision,
              contentHash: cited.object.contentHash,
            },
            field: { owner: 'production', objectId: cited.object.id, field: 'content' },
            reason: 'Keep the approved story.',
          },
        },
        {
          actor: 'user',
          causation: { kind: 'direct_ui', actionId: 'action.production.protect' },
          correlationId: 'correlation.production.protect',
        },
      ).result.ownerAfter;
      expect(() =>
        data.production.apply(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.production.protected',
            method: 'production.apply',
            input: {
              action: 'replace',
              projectId: cited.object.projectId,
              ref: {
                authority: 'production',
                id: cited.object.id,
                revision: protectedOwner.revision,
                contentHash: protectedOwner.contentHash,
              },
              lifecycle: cited.object.lifecycle,
              value: {
                objectType: 'story',
                content: { ...cited.object.content, title: 'Blocked' },
              },
              relations: cited.object.relations,
            },
          },
          context,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      store.close();
    }
  });

  it('requires a transaction and creates root and ordered parent-to-child objects through one plan', async () => {
    const fixture = await harness();
    try {
      const rootInput: ProductionMutationInput = {
        action: 'create',
        expectedProjectRevision: projectRevision(fixture),
        parentRef: null,
        order: null,
        value: storyValue('Parent'),
      };
      const before = totalChanges(fixture);
      expect(() =>
        planProductionMutationInTransaction(
          fixture.database,
          fixture.environment,
          fixture.project.id,
          rootInput,
          NOW,
          plannedProductionMutationIds('dispatch.production.no-transaction', rootInput),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(totalChanges(fixture)).toBe(before);

      const parent = createRoot(fixture, 'Parent', 'dispatch.production.parent');
      expect(parent.committed.primaryEventId).toBe(parent.committed.receipts[0]!.eventId);
      expect(parent.committed.receipts[0]).toMatchObject({
        changedPaths: ['content'],
        undoRef: null,
      });

      const firstChild = executeToolMutation(
        fixture,
        {
          action: 'create',
          expectedProjectRevision: projectRevision(fixture),
          parentRef: productionRef(parent.object),
          order: 0,
          value: storyValue('First child'),
        },
        'dispatch.production.first-child',
      );
      const firstChildObject = currentProduction(
        fixture,
        firstChild.committed.receipts[0]!.object.id,
      );
      const parentAfterFirstChild = currentProduction(fixture, parent.object.id);

      const secondChild = executeToolMutation(
        fixture,
        {
          action: 'create',
          expectedProjectRevision: projectRevision(fixture),
          parentRef: productionRef(parentAfterFirstChild),
          order: 0,
          value: storyValue('Second child'),
        },
        'dispatch.production.second-child',
      );
      const secondChildObject = currentProduction(
        fixture,
        secondChild.committed.receipts[0]!.object.id,
      );
      const parentAfterSecondChild = currentProduction(fixture, parent.object.id);
      if (secondChild.planned.ids.variant !== 'production_create') {
        throw new Error('Expected production create IDs');
      }
      expect(secondChild.committed.receipts).toMatchObject([
        { object: { id: secondChildObject.id }, changedPaths: ['content'], undoRef: null },
        { object: { id: parent.object.id }, changedPaths: ['relations'], undoRef: null },
      ]);
      expect(secondChild.committed.receipts.map(({ eventId }) => eventId)).toEqual([
        secondChild.planned.ids.objectEventId,
        secondChild.planned.ids.parentEventId,
      ]);
      expect(secondChild.committed.primaryEventId).toBe(secondChild.planned.ids.parentEventId);
      expect(
        parentAfterSecondChild.relations.filter(({ relation }) => relation === 'contains'),
      ).toEqual([
        {
          relation: 'contains',
          targetType: 'story',
          targetId: secondChildObject.id,
          ordinal: 0,
        },
        {
          relation: 'contains',
          targetType: 'story',
          targetId: firstChildObject.id,
          ordinal: 1,
        },
      ]);
    } finally {
      fixture.store.close();
    }
  });

  it('updates content, maintains dense containment, and reorders only the exact current child set', async () => {
    const fixture = await harness();
    try {
      const parent = createRoot(fixture, 'Parent', 'dispatch.production.relation.parent');
      const first = createRoot(fixture, 'First', 'dispatch.production.relation.first');
      const second = createRoot(fixture, 'Second', 'dispatch.production.relation.second');
      const third = createRoot(fixture, 'Third', 'dispatch.production.relation.third');

      const updated = executeToolMutation(
        fixture,
        {
          action: 'update',
          ref: productionRef(first.object),
          expectedRevision: first.object.revision,
          expectedContentHash: first.object.contentHash,
          value: storyValue('First revised'),
        },
        'dispatch.production.update',
      );
      const firstAfterUpdate = currentProduction(fixture, first.object.id);
      expect(updated.committed.receipts).toMatchObject([{ changedPaths: ['content'] }]);
      const updateNoop = executeToolMutation(
        fixture,
        {
          action: 'update',
          ref: productionRef(firstAfterUpdate),
          expectedRevision: firstAfterUpdate.revision,
          expectedContentHash: firstAfterUpdate.contentHash,
          value: storyValue('First revised'),
        },
        'dispatch.production.update-noop',
      );
      expect(updateNoop.committed).toMatchObject({ receipts: [], primaryEventId: null });

      const firstLink = executeToolMutation(
        fixture,
        relationMutation('link', 'contains', parent.object, firstAfterUpdate, 0),
        'dispatch.production.link-first',
      );
      expect(firstLink.committed.receipts).toMatchObject([{ changedPaths: ['relations'] }]);
      const parentAfterFirstLink = currentProduction(fixture, parent.object.id);
      const secondLink = executeToolMutation(
        fixture,
        relationMutation('link', 'contains', parentAfterFirstLink, second.object, 0),
        'dispatch.production.link-second',
      );
      expect(secondLink.committed.receipts).toMatchObject([{ changedPaths: ['relations'] }]);
      let currentParent = currentProduction(fixture, parent.object.id);
      expect(currentParent.relations.filter(({ relation }) => relation === 'contains')).toEqual([
        {
          relation: 'contains',
          targetType: 'story',
          targetId: second.object.id,
          ordinal: 0,
        },
        {
          relation: 'contains',
          targetType: 'story',
          targetId: first.object.id,
          ordinal: 1,
        },
      ]);

      const existingLink = executeToolMutation(
        fixture,
        relationMutation('link', 'contains', currentParent, second.object, 0),
        'dispatch.production.link-existing',
      );
      expect(existingLink.committed).toMatchObject({ receipts: [], primaryEventId: null });

      const unlink = executeToolMutation(
        fixture,
        relationMutation('unlink', 'contains', currentParent, second.object, null),
        'dispatch.production.unlink-second',
      );
      expect(unlink.committed.receipts).toMatchObject([{ changedPaths: ['relations'] }]);
      currentParent = currentProduction(fixture, parent.object.id);
      expect(currentParent.relations.filter(({ relation }) => relation === 'contains')).toEqual([
        {
          relation: 'contains',
          targetType: 'story',
          targetId: first.object.id,
          ordinal: 0,
        },
      ]);
      const existingUnlink = executeToolMutation(
        fixture,
        relationMutation('unlink', 'contains', currentParent, second.object, null),
        'dispatch.production.unlink-existing',
      );
      expect(existingUnlink.committed).toMatchObject({ receipts: [], primaryEventId: null });

      const thirdLink = executeToolMutation(
        fixture,
        relationMutation('link', 'contains', currentParent, third.object, 1),
        'dispatch.production.link-third',
      );
      expect(thirdLink.committed.receipts).toMatchObject([{ changedPaths: ['relations'] }]);
      currentParent = currentProduction(fixture, parent.object.id);
      const reordered = executeToolMutation(
        fixture,
        {
          action: 'reorder',
          parent: expectedProductionRef(currentParent),
          orderedChildIds: [third.object.id, first.object.id],
        },
        'dispatch.production.reorder',
      );
      expect(reordered.committed.receipts).toMatchObject([{ changedPaths: ['relations'] }]);
      currentParent = currentProduction(fixture, parent.object.id);
      expect(currentParent.relations.filter(({ relation }) => relation === 'contains')).toEqual([
        {
          relation: 'contains',
          targetType: 'story',
          targetId: third.object.id,
          ordinal: 0,
        },
        {
          relation: 'contains',
          targetType: 'story',
          targetId: first.object.id,
          ordinal: 1,
        },
      ]);
      const reorderNoop = executeToolMutation(
        fixture,
        {
          action: 'reorder',
          parent: expectedProductionRef(currentParent),
          orderedChildIds: [third.object.id, first.object.id],
        },
        'dispatch.production.reorder-noop',
      );
      expect(reorderNoop.committed).toMatchObject({ receipts: [], primaryEventId: null });
      expectPlanFailureWithoutWrites(
        fixture,
        () =>
          planToolMutation(
            fixture,
            {
              action: 'reorder',
              parent: expectedProductionRef(currentParent),
              orderedChildIds: [first.object.id],
            },
            'dispatch.production.reorder-invalid',
          ),
        'INVALID_REQUEST',
      );
    } finally {
      fixture.store.close();
    }
  });

  it('archives, restores, and cites with exact semantic no-ops', async () => {
    const fixture = await harness();
    try {
      const source = createRoot(fixture, 'Source', 'dispatch.production.cite-source');
      const target = createRoot(fixture, 'Target', 'dispatch.production.cite-target');

      const archived = executeToolMutation(
        fixture,
        {
          action: 'archive',
          ref: productionRef(target.object),
          expectedRevision: target.object.revision,
          expectedContentHash: target.object.contentHash,
        },
        'dispatch.production.archive',
      );
      expect(archived.committed.receipts).toMatchObject([{ changedPaths: ['lifecycle'] }]);
      let currentTarget = currentProduction(fixture, target.object.id);
      const archiveNoop = executeToolMutation(
        fixture,
        {
          action: 'archive',
          ref: productionRef(currentTarget),
          expectedRevision: currentTarget.revision,
          expectedContentHash: currentTarget.contentHash,
        },
        'dispatch.production.archive-noop',
      );
      expect(archiveNoop.committed).toMatchObject({ receipts: [], primaryEventId: null });

      const restored = executeToolMutation(
        fixture,
        {
          action: 'restore',
          ref: productionRef(currentTarget),
          expectedRevision: currentTarget.revision,
          expectedContentHash: currentTarget.contentHash,
        },
        'dispatch.production.restore',
      );
      expect(restored.committed.receipts).toMatchObject([{ changedPaths: ['lifecycle'] }]);
      currentTarget = currentProduction(fixture, target.object.id);
      const restoreNoop = executeToolMutation(
        fixture,
        {
          action: 'restore',
          ref: productionRef(currentTarget),
          expectedRevision: currentTarget.revision,
          expectedContentHash: currentTarget.contentHash,
        },
        'dispatch.production.restore-noop',
      );
      expect(restoreNoop.committed).toMatchObject({ receipts: [], primaryEventId: null });

      const cited = executeToolMutation(
        fixture,
        {
          action: 'cite',
          ref: productionRef(currentTarget),
          expectedRevision: currentTarget.revision,
          expectedContentHash: currentTarget.contentHash,
          field: 'synopsis',
          sourceRef: productionRef(source.object),
          relation: 'supports',
        },
        'dispatch.production.cite',
      );
      expect(cited.committed.receipts).toMatchObject([{ changedPaths: ['citations'] }]);
      currentTarget = currentProduction(fixture, target.object.id);
      expect(fixture.data.production.get(target.object.id).factSources).toHaveLength(1);
      const citeNoop = executeToolMutation(
        fixture,
        {
          action: 'cite',
          ref: productionRef(currentTarget),
          expectedRevision: currentTarget.revision,
          expectedContentHash: currentTarget.contentHash,
          field: 'synopsis',
          sourceRef: productionRef(source.object),
          relation: 'supports',
        },
        'dispatch.production.cite-noop',
      );
      expect(citeNoop.committed).toMatchObject({ receipts: [], primaryEventId: null });
    } finally {
      fixture.store.close();
    }
  });

  it('rejects stale project and object plans, competing parents, cycles, and cross-project refs', async () => {
    const fixture = await harness();
    try {
      const staleRootInput: ProductionMutationInput = {
        action: 'create',
        expectedProjectRevision: projectRevision(fixture),
        parentRef: null,
        order: null,
        value: storyValue('Stale root'),
      };
      const staleRootPlan = planToolMutation(
        fixture,
        staleRootInput,
        'dispatch.production.stale-root',
      );
      fixture.data.projects.update(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.production.project-revision',
          method: 'project.update',
          input: {
            projectId: fixture.project.id,
            expectedRevision: projectRevision(fixture),
            name: 'Film revised after planning',
            lifecycle: null,
          },
        },
        context,
      );
      expectPlanFailureWithoutWrites(
        fixture,
        () =>
          withImmediateTransaction(fixture.database, () =>
            commitPlannedProductionMutationInTransaction(
              fixture.database,
              fixture.environment,
              staleRootPlan,
              context,
            ),
          ),
        'REVISION_CONFLICT',
      );

      const staleObject = createRoot(fixture, 'Stale object', 'dispatch.production.stale-object');
      const staleObjectPlan = planToolMutation(
        fixture,
        {
          action: 'update',
          ref: productionRef(staleObject.object),
          expectedRevision: staleObject.object.revision,
          expectedContentHash: staleObject.object.contentHash,
          value: storyValue('Frozen update'),
        },
        'dispatch.production.stale-object-plan',
      );
      executeToolMutation(
        fixture,
        {
          action: 'update',
          ref: productionRef(staleObject.object),
          expectedRevision: staleObject.object.revision,
          expectedContentHash: staleObject.object.contentHash,
          value: storyValue('Concurrent update'),
        },
        'dispatch.production.concurrent-object-update',
      );
      expectPlanFailureWithoutWrites(
        fixture,
        () =>
          withImmediateTransaction(fixture.database, () =>
            commitPlannedProductionMutationInTransaction(
              fixture.database,
              fixture.environment,
              staleObjectPlan,
              context,
            ),
          ),
        'REVISION_CONFLICT',
      );

      const firstParent = createRoot(fixture, 'First parent', 'dispatch.production.first-parent');
      const secondParent = createRoot(
        fixture,
        'Second parent',
        'dispatch.production.second-parent',
      );
      const child = createRoot(fixture, 'Shared child', 'dispatch.production.shared-child');
      const firstParentPlan = planToolMutation(
        fixture,
        relationMutation('link', 'contains', firstParent.object, child.object, 0),
        'dispatch.production.first-parent-link',
      );
      const secondParentPlan = planToolMutation(
        fixture,
        relationMutation('link', 'contains', secondParent.object, child.object, 0),
        'dispatch.production.second-parent-link',
      );
      commitToolMutation(fixture, firstParentPlan);
      expectPlanFailureWithoutWrites(
        fixture,
        () =>
          withImmediateTransaction(fixture.database, () =>
            commitPlannedProductionMutationInTransaction(
              fixture.database,
              fixture.environment,
              secondParentPlan,
              context,
            ),
          ),
        'REVISION_CONFLICT',
      );

      const currentFirstParent = currentProduction(fixture, firstParent.object.id);
      expectPlanFailureWithoutWrites(
        fixture,
        () =>
          planToolMutation(
            fixture,
            relationMutation(
              'link',
              'contains',
              currentProduction(fixture, child.object.id),
              currentFirstParent,
              0,
            ),
            'dispatch.production.cycle',
          ),
        'INVALID_REQUEST',
      );
      expectPlanFailureWithoutWrites(
        fixture,
        () =>
          planToolMutation(
            fixture,
            {
              action: 'update',
              ref: productionRef(firstParent.object),
              expectedRevision: firstParent.object.revision,
              expectedContentHash: firstParent.object.contentHash,
              value: storyValue('Stale parent update'),
            },
            'dispatch.production.stale-parent',
          ),
        'REVISION_CONFLICT',
      );

      const otherProject = fixture.data.projects.create(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.production.other-project',
          method: 'project.create',
          input: {
            name: 'Other film',
            permissionMode: 'reversible',
            budget,
            formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
          },
        },
        {
          ...context,
          actor: 'user',
          causation: { kind: 'direct_ui', actionId: 'create.other-project' },
        },
      ).result.project;
      const foreign = createRoot(
        fixture,
        'Foreign',
        'dispatch.production.foreign',
        otherProject.id,
      );
      expectPlanFailureWithoutWrites(
        fixture,
        () =>
          planToolMutation(
            fixture,
            relationMutation('link', 'references', secondParent.object, foreign.object, null),
            'dispatch.production.cross-project',
          ),
        'INVALID_REQUEST',
      );
    } finally {
      fixture.store.close();
    }
  });
});
