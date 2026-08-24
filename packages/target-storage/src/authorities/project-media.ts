import {
  EntityIdSchema,
  IsoTimestampSchema,
  ProjectMediaLinkInputSchema,
  ProjectMediaLinkSuccessSchema,
  ProjectMediaRefSchema,
  Sha256Schema,
  WireSuccessV1Schema,
  canonicalJson,
  parseCanonical,
  parseRequestV1,
  strictObject,
  z,
  type CausationRef,
  type ProjectMediaRef,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import {
  decodeProjectMediaCollections,
  decodeProjectMediaRoles,
  encodeProjectMediaCollections,
  encodeProjectMediaRoles,
} from '../internal/canonical-codecs.js';
import { causationFromColumns } from '../internal/causation.js';
import {
  TargetCommandContextSchema,
  executeWireMutation,
  type TargetCommandContext,
} from '../internal/command.js';
import {
  decodeCursor as decodeOpaqueCursor,
  encodeCursor as encodeOpaqueCursor,
} from '../internal/cursor.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import type { TargetStorageEnvironment } from '../internal/environment.js';
import { hashCanonical, hashContentObject } from '../internal/hashes.js';
import {
  findProjectMediaRecordByAsset,
  insertProjectMediaRecord,
  loadGlobalMediaAsset,
} from '../internal/media-records.js';
import { loadProductionObject } from '../internal/production-records.js';
import { appendProjectEvent } from '../internal/project-events.js';
import { upsertProjectSearchDocument } from '../internal/search-projection.js';
import { TargetStorageError } from '../kernel/errors.js';
import type { TargetStore } from '../kernel/store.js';

type RequestMap = {
  [Method in WireRequestV1['method']]: Extract<WireRequestV1, { method: Method }>;
};
type SuccessMap = {
  [Method in WireSuccessV1['method']]: Extract<WireSuccessV1, { method: Method }>;
};
type Request<Method extends keyof RequestMap> = RequestMap[Method];
type Success<Method extends keyof SuccessMap> = SuccessMap[Method];

const ProjectMediaListCursorSchema = strictObject({
  kind: z.literal('project_media_list'),
  filterHash: Sha256Schema,
  updatedAt: IsoTimestampSchema,
  id: EntityIdSchema,
});

interface ProjectMediaRow {
  id: string;
  project_id: string;
  global_asset_id: string;
  revision: number;
  content_hash: string;
  lifecycle: ProjectMediaRef['lifecycle'];
  detached_at: string | null;
  label: string;
  collections_v1_json: string;
  roles_v1_json: string;
  notes: string;
  created_by_kind: CausationRef['kind'];
  created_by_id: string;
  created_at: string;
  updated_at: string;
}

interface ProjectMediaLinkRow {
  production_object_id: string;
  relation: ProjectMediaRef['productionLinks'][number]['relation'];
}

interface OrderedRow {
  id: string;
  updated_at: string;
}

function exactRequest<Method extends WireRequestV1['method']>(
  value: Request<Method>,
  method: Method,
): Request<Method> {
  const request = parseRequestV1(value);
  if (request.method !== method) {
    throw new TargetStorageError('INVALID_REQUEST', `Expected Wire method ${method}`);
  }
  return request as Request<Method>;
}

function success<Method extends WireSuccessV1['method']>(
  request: Request<Method>,
  result: unknown,
): Success<Method> {
  return parseCanonical(WireSuccessV1Schema, {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result,
  }) as Success<Method>;
}

function encodeCursor(value: unknown): string {
  return encodeOpaqueCursor('media.project.list', canonicalJson(value));
}

function decodeCursor(cursor: string): z.output<typeof ProjectMediaListCursorSchema> {
  try {
    const key = decodeOpaqueCursor(cursor, 'media.project.list');
    if (key === null) throw new Error('Missing cursor key');
    return parseCanonical(ProjectMediaListCursorSchema, JSON.parse(key) as unknown);
  } catch (cause) {
    throw new TargetStorageError('INVALID_REQUEST', 'Project Media cursor is invalid', { cause });
  }
}

function linksForRef(
  database: DatabaseSync,
  projectMediaRefId: string,
): ProjectMediaRef['productionLinks'] {
  const rows = database
    .prepare(
      `SELECT production_object_id, relation
       FROM project_media_links
       WHERE project_media_ref_id = ?
       ORDER BY production_object_id, relation`,
    )
    .all(projectMediaRefId) as unknown as ProjectMediaLinkRow[];
  return rows.map((row) => ({
    productionObjectId: row.production_object_id,
    relation: row.relation,
  }));
}

function projectMediaFromRow(database: DatabaseSync, row: ProjectMediaRow): ProjectMediaRef {
  const object = parseCanonical(ProjectMediaRefSchema, {
    authority: 'project_media_ref',
    id: row.id,
    projectId: row.project_id,
    globalAssetId: row.global_asset_id,
    revision: row.revision,
    contentHash: row.content_hash,
    lifecycle: row.lifecycle,
    detachedAt: row.detached_at,
    label: row.label,
    collections: decodeProjectMediaCollections(row.collections_v1_json),
    roles: decodeProjectMediaRoles(row.roles_v1_json),
    notes: row.notes,
    productionLinks: linksForRef(database, row.id),
    createdBy: causationFromColumns(row.created_by_kind, row.created_by_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
  if (hashContentObject(object) !== object.contentHash) {
    throw new TargetStorageError(
      'CORRUPT_DATA',
      `Project Media reference ${object.id} content hash does not match`,
    );
  }
  return object;
}

function findProjectMediaRef(
  database: DatabaseSync,
  projectMediaRefId: string,
): ProjectMediaRef | undefined {
  const id = parseCanonical(EntityIdSchema, projectMediaRefId);
  const row = database
    .prepare('SELECT * FROM project_media_refs WHERE id = ?')
    .get(id) as unknown as ProjectMediaRow | undefined;
  return row === undefined ? undefined : projectMediaFromRow(database, row);
}

function loadProjectMediaRef(database: DatabaseSync, projectMediaRefId: string): ProjectMediaRef {
  const object = findProjectMediaRef(database, projectMediaRefId);
  if (object === undefined) {
    throw new TargetStorageError(
      'NOT_FOUND',
      `Project Media reference was not found: ${projectMediaRefId}`,
    );
  }
  return object;
}

function requireProjectRevision(
  database: DatabaseSync,
  projectId: string,
  expectedRevision: number,
): void {
  const project = database
    .prepare('SELECT revision FROM projects WHERE id = ?')
    .get(projectId) as unknown as { revision: number } | undefined;
  if (project === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Project was not found: ${projectId}`);
  }
  if (project.revision !== expectedRevision) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Project ${projectId} revision does not match`,
    );
  }
}

function requireAssetBlob(database: DatabaseSync, globalAssetId: string): string {
  return loadGlobalMediaAsset(database, globalAssetId).blobHash;
}

function relationship(
  database: DatabaseSync,
  projectId: string,
  globalAssetId: string,
): ProjectMediaRef | undefined {
  return findProjectMediaRecordByAsset(database, projectId, globalAssetId);
}

function mediaSearchText(object: ProjectMediaRef): string {
  return [object.label, ...object.collections, ...object.roles, object.notes].join('\n');
}

function requirePublicLinkContext(context: TargetCommandContext): void {
  if (
    (context.actor === 'user' && context.causation.kind === 'direct_ui') ||
    (context.actor === 'commander' && context.causation.kind === 'run')
  ) {
    return;
  }
  throw new TargetStorageError(
    'INVALID_REQUEST',
    'Project Media links require a direct user action or Commander Run',
  );
}

function canonicalProductionLinks(
  links: ProjectMediaRef['productionLinks'],
): ProjectMediaRef['productionLinks'] {
  return [...links].sort(
    (left, right) =>
      (left.productionObjectId < right.productionObjectId
        ? -1
        : left.productionObjectId > right.productionObjectId
          ? 1
          : 0) || (left.relation < right.relation ? -1 : left.relation > right.relation ? 1 : 0),
  );
}

function changedPaths(before: ProjectMediaRef | undefined, after: ProjectMediaRef): string[] {
  if (before === undefined) return ['project_media_ref'];
  const paths: string[] = [];
  if (canonicalJson(before.collections) !== canonicalJson(after.collections))
    paths.push('collections');
  if (before.detachedAt !== after.detachedAt) paths.push('detachedAt');
  if (before.label !== after.label) paths.push('label');
  if (before.lifecycle !== after.lifecycle) paths.push('lifecycle');
  if (before.notes !== after.notes) paths.push('notes');
  if (canonicalJson(before.roles) !== canonicalJson(after.roles)) paths.push('roles');
  return paths.length === 0 ? ['revision'] : paths;
}

export function attachProjectMediaInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  requestValue: Request<'media.project.attach'>,
  contextValue: TargetCommandContext,
  committedAtValue: string,
): Success<'media.project.attach'>['result'] {
  if (!database.isTransaction) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Project Media attachment requires an immediate transaction',
    );
  }
  const request = exactRequest(requestValue, 'media.project.attach');
  const context = parseCanonical(TargetCommandContextSchema, contextValue);
  const committedAt = parseCanonical(IsoTimestampSchema, committedAtValue);
  requireProjectRevision(database, request.input.projectId, request.input.expectedProjectRevision);
  const blobHash = requireAssetBlob(database, request.input.globalAssetId);
  const before = relationship(database, request.input.projectId, request.input.globalAssetId);
  const expected = request.input.expectedExistingRef;
  if (
    (expected === null && before !== undefined) ||
    (expected !== null &&
      (before === undefined ||
        before.id !== expected.id ||
        before.revision !== expected.expectedRevision ||
        before.contentHash !== expected.expectedContentHash))
  ) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      'Project Media relationship does not match expectedExistingRef',
    );
  }
  if (
    before?.lifecycle === 'active' &&
    before.label === request.input.label &&
    canonicalJson(before.collections) === canonicalJson(request.input.collections) &&
    canonicalJson(before.roles) === canonicalJson(request.input.roles) &&
    before.notes === request.input.notes
  ) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      `Project Media reference ${before.id} is already attached with the requested metadata`,
    );
  }

  const objectWithoutHash = {
    authority: 'project_media_ref' as const,
    id: before?.id ?? environment.createId('project_media_ref'),
    projectId: request.input.projectId,
    globalAssetId: request.input.globalAssetId,
    revision: before === undefined ? 0 : before.revision + 1,
    contentHash: '',
    lifecycle: 'active' as const,
    detachedAt: null,
    label: request.input.label,
    collections: request.input.collections,
    roles: request.input.roles,
    notes: request.input.notes,
    productionLinks: before?.productionLinks ?? [],
    createdBy: before?.createdBy ?? context.causation,
    createdAt: before?.createdAt ?? committedAt,
    updatedAt: committedAt,
  };
  const object = parseCanonical(ProjectMediaRefSchema, {
    ...objectWithoutHash,
    contentHash: hashContentObject(objectWithoutHash),
  });

  if (before === undefined) {
    insertProjectMediaRecord(database, object);
  } else {
    const update = database
      .prepare(
        `UPDATE project_media_refs
           SET revision = ?, content_hash = ?, lifecycle = 'active', detached_at = NULL,
               label = ?, collections_v1_json = ?, roles_v1_json = ?, notes = ?, updated_at = ?
           WHERE id = ? AND revision = ? AND content_hash = ?`,
      )
      .run(
        object.revision,
        object.contentHash,
        object.label,
        encodeProjectMediaCollections(object.collections),
        encodeProjectMediaRoles(object.roles),
        object.notes,
        object.updatedAt,
        before.id,
        before.revision,
        before.contentHash,
      );
    if (Number(update.changes) !== 1) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        `Project Media reference ${before.id} changed concurrently`,
      );
    }
  }

  const event = appendProjectEvent(database, {
    eventId: environment.createId('project_event'),
    projectId: object.projectId,
    occurredAt: committedAt,
    actor: context.actor,
    subject: { authority: 'project_media_ref', id: object.id },
    causation: context.causation,
    correlationId: context.correlationId,
    idempotencyKey: request.requestId,
    payload: {
      type: 'media_attached',
      projectMediaRefId: object.id,
      globalAssetId: object.globalAssetId,
      blobHash,
    },
  });
  upsertProjectSearchDocument(
    database,
    environment,
    object.projectId,
    {
      kind: 'project_media_ref',
      ref: {
        authority: 'project_media_ref',
        id: object.id,
        revision: object.revision,
        contentHash: object.contentHash,
      },
    },
    'current',
    mediaSearchText(object),
    object.updatedAt,
  );
  return success<'media.project.attach'>(request, {
    object,
    previousRevision: before?.revision ?? null,
    eventId: event.id,
    changedPaths: changedPaths(before, object),
    undoRef: null,
  }).result;
}

function attachProjectMedia(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  request: Request<'media.project.attach'>,
  context: TargetCommandContext,
): Success<'media.project.attach'> {
  const committedAt = environment.now();
  return executeWireMutation(database, request, context, committedAt, () => {
    const result = attachProjectMediaInTransaction(
      database,
      environment,
      request,
      context,
      committedAt,
    );
    return {
      projectId: result.object.projectId,
      response: success<'media.project.attach'>(request, result),
    };
  });
}

function detachProjectMedia(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  request: Request<'media.project.detach'>,
  context: TargetCommandContext,
): Success<'media.project.detach'> {
  const committedAt = environment.now();
  return executeWireMutation(database, request, context, committedAt, () => {
    const before = loadProjectMediaRef(database, request.input.projectMediaRefId);
    if (
      before.revision !== request.input.expectedRevision ||
      before.contentHash !== request.input.expectedContentHash
    ) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        `Project Media reference ${before.id} does not match`,
      );
    }
    if (before.lifecycle === 'detached') {
      throw new TargetStorageError(
        'INVALID_REQUEST',
        `Project Media reference ${before.id} is already detached`,
      );
    }
    const objectWithoutHash = {
      ...before,
      revision: before.revision + 1,
      contentHash: '',
      lifecycle: 'detached' as const,
      detachedAt: committedAt,
      updatedAt: committedAt,
    };
    const object = parseCanonical(ProjectMediaRefSchema, {
      ...objectWithoutHash,
      contentHash: hashContentObject(objectWithoutHash),
    });
    const update = database
      .prepare(
        `UPDATE project_media_refs
         SET revision = ?, content_hash = ?, lifecycle = 'detached', detached_at = ?, updated_at = ?
         WHERE id = ? AND revision = ? AND content_hash = ?`,
      )
      .run(
        object.revision,
        object.contentHash,
        object.detachedAt,
        object.updatedAt,
        object.id,
        before.revision,
        before.contentHash,
      );
    if (Number(update.changes) !== 1) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        `Project Media reference ${before.id} changed concurrently`,
      );
    }
    const event = appendProjectEvent(database, {
      eventId: environment.createId('project_event'),
      projectId: object.projectId,
      occurredAt: committedAt,
      actor: context.actor,
      subject: { authority: 'project_media_ref', id: object.id },
      causation: context.causation,
      correlationId: context.correlationId,
      idempotencyKey: request.requestId,
      payload: {
        type: 'media_detached',
        projectMediaRefId: object.id,
        globalAssetId: object.globalAssetId,
        revision: object.revision,
        contentHash: object.contentHash,
      },
    });
    upsertProjectSearchDocument(
      database,
      environment,
      object.projectId,
      {
        kind: 'project_media_ref',
        ref: {
          authority: 'project_media_ref',
          id: object.id,
          revision: object.revision,
          contentHash: object.contentHash,
        },
      },
      'historical',
      mediaSearchText(object),
      object.updatedAt,
    );
    return {
      projectId: object.projectId,
      response: success<'media.project.detach'>(request, {
        object,
        previousRevision: before.revision,
        eventId: event.id,
        changedPaths: ['detachedAt', 'lifecycle'],
        undoRef: null,
      }),
    };
  });
}

export function linkProjectMediaInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  inputValue: Request<'media.project.link'>['input'],
  contextValue: TargetCommandContext,
  committedAtValue: string,
  idempotencyKeyValue: string,
): Success<'media.project.link'>['result'] {
  if (!database.isTransaction) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Project Media link mutation requires an immediate transaction',
    );
  }
  const input = parseCanonical(ProjectMediaLinkInputSchema, inputValue);
  const context = parseCanonical(TargetCommandContextSchema, contextValue);
  const committedAt = parseCanonical(IsoTimestampSchema, committedAtValue);
  const idempotencyKey = parseCanonical(EntityIdSchema, idempotencyKeyValue);
  requirePublicLinkContext(context);
  const before = loadProjectMediaRef(database, input.mediaRef.id);
  if (
    before.revision !== input.mediaRef.revision ||
    before.contentHash !== input.mediaRef.contentHash
  ) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Project Media reference ${before.id} does not match`,
    );
  }
  if (before.lifecycle !== 'active') {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      `Project Media reference ${before.id} is not active`,
    );
  }

  const target = loadProductionObject(database, input.target.id);
  if (target.projectId !== before.projectId) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Project Media and Production target belong to different Projects',
    );
  }
  if (target.lifecycle !== 'active') {
    throw new TargetStorageError('INVALID_REQUEST', `Production object ${target.id} is not active`);
  }
  if (
    target.revision !== input.target.revision ||
    target.contentHash !== input.target.contentHash
  ) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Production object ${target.id} does not match`,
    );
  }

  const matches = (link: ProjectMediaRef['productionLinks'][number]) =>
    link.productionObjectId === target.id && link.relation === input.relation;
  const existing = before.productionLinks.some(matches);
  if ((input.mode === 'link') === existing) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      existing ? 'Project Media link already exists' : 'Project Media link does not exist',
    );
  }
  const productionLinks = canonicalProductionLinks(
    input.mode === 'link'
      ? [...before.productionLinks, { productionObjectId: target.id, relation: input.relation }]
      : before.productionLinks.filter((link) => !matches(link)),
  );
  const objectWithoutHash = {
    ...before,
    revision: before.revision + 1,
    contentHash: '',
    productionLinks,
    updatedAt: committedAt,
  };
  const object = parseCanonical(ProjectMediaRefSchema, {
    ...objectWithoutHash,
    contentHash: hashContentObject(objectWithoutHash),
  });

  if (input.mode === 'link') {
    database
      .prepare(
        `INSERT INTO project_media_links (
             id, project_media_ref_id, production_object_id, relation, created_at
           ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        hashCanonical({
          projectMediaRefId: before.id,
          productionObjectId: target.id,
          relation: input.relation,
        }),
        before.id,
        target.id,
        input.relation,
        committedAt,
      );
  } else {
    const removed = database
      .prepare(
        `DELETE FROM project_media_links
           WHERE project_media_ref_id = ? AND production_object_id = ? AND relation = ?`,
      )
      .run(before.id, target.id, input.relation);
    if (Number(removed.changes) !== 1) {
      throw new TargetStorageError('REVISION_CONFLICT', 'Project Media link changed concurrently');
    }
  }
  const updated = database
    .prepare(
      `UPDATE project_media_refs
         SET revision = ?, content_hash = ?, updated_at = ?
         WHERE id = ? AND revision = ? AND content_hash = ?`,
    )
    .run(
      object.revision,
      object.contentHash,
      object.updatedAt,
      before.id,
      before.revision,
      before.contentHash,
    );
  if (Number(updated.changes) !== 1) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Project Media reference ${before.id} changed concurrently`,
    );
  }
  const event = appendProjectEvent(database, {
    eventId: environment.createId('project_event'),
    projectId: object.projectId,
    occurredAt: committedAt,
    actor: context.actor,
    subject: { authority: 'project_media_ref', id: object.id },
    causation: context.causation,
    correlationId: context.correlationId,
    idempotencyKey,
    payload: {
      type: 'object_revision_changed',
      beforeRevision: before.revision,
      afterRevision: object.revision,
      beforeHash: before.contentHash,
      afterHash: object.contentHash,
    },
  });
  upsertProjectSearchDocument(
    database,
    environment,
    object.projectId,
    {
      kind: 'project_media_ref',
      ref: {
        authority: 'project_media_ref',
        id: object.id,
        revision: object.revision,
        contentHash: object.contentHash,
      },
    },
    'current',
    mediaSearchText(object),
    object.updatedAt,
  );
  return parseCanonical(ProjectMediaLinkSuccessSchema, {
    object,
    previousRevision: before.revision,
    eventId: event.id,
    changedPaths: ['productionLinks'],
    undoRef: null,
  });
}

function linkProjectMedia(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  request: Request<'media.project.link'>,
  context: TargetCommandContext,
): Success<'media.project.link'> {
  const committedAt = environment.now();
  return executeWireMutation(database, request, context, committedAt, () => {
    const result = linkProjectMediaInTransaction(
      database,
      environment,
      request.input,
      context,
      committedAt,
      request.requestId,
    );
    return {
      projectId: result.object.projectId,
      response: success<'media.project.link'>(request, result),
    };
  });
}

function ftsQuery(query: string): string {
  return query
    .split(/\s+/u)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(' AND ');
}

export interface ProjectMediaAuthority {
  readonly attach: (
    request: Request<'media.project.attach'>,
    context: TargetCommandContext,
  ) => Success<'media.project.attach'>;
  readonly detach: (
    request: Request<'media.project.detach'>,
    context: TargetCommandContext,
  ) => Success<'media.project.detach'>;
  readonly link: (
    request: Request<'media.project.link'>,
    context: TargetCommandContext,
  ) => Success<'media.project.link'>;
  readonly get: (projectMediaRefId: string) => ProjectMediaRef;
  readonly list: (request: Request<'media.project.list'>) => Success<'media.project.list'>;
}

export function createProjectMediaAuthority(
  store: TargetStore,
  environment: TargetStorageEnvironment,
): ProjectMediaAuthority {
  const authority: ProjectMediaAuthority = {
    attach(request, context) {
      const parsed = exactRequest(request, 'media.project.attach');
      return attachProjectMedia(getTargetStoreDatabase(store), environment, parsed, context);
    },
    detach(request, context) {
      const parsed = exactRequest(request, 'media.project.detach');
      return detachProjectMedia(getTargetStoreDatabase(store), environment, parsed, context);
    },
    link(request, context) {
      const parsed = exactRequest(request, 'media.project.link');
      return linkProjectMedia(getTargetStoreDatabase(store), environment, parsed, context);
    },
    get(projectMediaRefId) {
      return loadProjectMediaRef(getTargetStoreDatabase(store), projectMediaRefId);
    },
    list(request) {
      const parsed = exactRequest(request, 'media.project.list');
      const database = getTargetStoreDatabase(store);
      if (
        database.prepare('SELECT 1 FROM projects WHERE id = ?').get(parsed.input.projectId) ===
        undefined
      ) {
        throw new TargetStorageError(
          'NOT_FOUND',
          `Project was not found: ${parsed.input.projectId}`,
        );
      }
      const filterHash = hashCanonical({
        projectId: parsed.input.projectId,
        roles: parsed.input.roles,
        query: parsed.input.query,
      });
      const cursor =
        parsed.input.page.cursor === null ? null : decodeCursor(parsed.input.page.cursor);
      if (cursor !== null && cursor.filterHash !== filterHash) {
        throw new TargetStorageError(
          'INVALID_REQUEST',
          'Project Media cursor belongs to another query',
        );
      }
      const searchJoin =
        parsed.input.query.length === 0
          ? ''
          : ` JOIN project_search_documents AS search_document
                ON search_document.project_id = ref.project_id
               AND search_document.source_kind = 'project_media_ref'
               AND search_document.source_id = ref.id
               AND search_document.source_state = 'current'
              JOIN project_search_fts
                ON project_search_fts.rowid = search_document.search_document_id`;
      const searchClause = parsed.input.query.length === 0 ? '' : ' AND project_search_fts MATCH ?';
      const roleClause =
        parsed.input.roles.length === 0
          ? ''
          : ` AND EXISTS (
                SELECT 1 FROM json_each(ref.roles_v1_json)
                WHERE value IN (${parsed.input.roles.map(() => '?').join(', ')})
              )`;
      const cursorClause =
        cursor === null ? '' : ' AND (ref.updated_at < ? OR (ref.updated_at = ? AND ref.id < ?))';
      const parameters: Array<string | number> = [parsed.input.projectId];
      if (parsed.input.query.length > 0) parameters.push(ftsQuery(parsed.input.query));
      parameters.push(...parsed.input.roles);
      if (cursor !== null) parameters.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
      parameters.push(parsed.input.page.limit + 1);
      const rows = database
        .prepare(
          `SELECT ref.id, ref.updated_at
           FROM project_media_refs AS ref${searchJoin}
           WHERE ref.project_id = ? AND ref.lifecycle = 'active'${searchClause}${roleClause}${cursorClause}
           ORDER BY ref.updated_at DESC, ref.id DESC
           LIMIT ?`,
        )
        .all(...parameters) as unknown as OrderedRow[];
      const hasMore = rows.length > parsed.input.page.limit;
      const pageRows = rows.slice(0, parsed.input.page.limit);
      const last = pageRows.at(-1);
      return success<'media.project.list'>(parsed, {
        items: pageRows.map((row) => loadProjectMediaRef(database, row.id)),
        nextCursor:
          hasMore && last !== undefined
            ? encodeCursor({
                kind: 'project_media_list',
                filterHash,
                updatedAt: last.updated_at,
                id: last.id,
              })
            : null,
      });
    },
  };
  return Object.freeze(authority);
}
