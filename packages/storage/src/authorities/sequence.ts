import {
  EntityIdSchema,
  SequenceDocumentSchema,
  SequenceRefSchema,
  WireSuccessV1Schema,
  canonicalJson,
  parseCanonical,
  parseRequestV1,
  strictObject,
  z,
  type SequenceDocument,
  type SequenceItem,
  type SequenceItemRef,
  type SequenceRef,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';
import type { Store } from '../kernel/store.js';
import { executeWireMutation, type CommandContext } from '../internal/command.js';
import { decodeCursor, encodeCursor } from '../internal/cursor.js';
import { getStoreDatabase } from '../internal/database-access.js';
import type { StorageEnvironment } from '../internal/environment.js';
import { hashCanonical } from '../internal/hashes.js';
import { appendProjectEvent } from '../internal/project-events.js';
import { loadGeneratedResultRecord } from '../internal/operation-owner-records.js';
import { loadProductionObject } from '../internal/production-records.js';
import {
  createEmptySequence,
  finalizeSequence,
  finalizeSequenceItem,
  insertSequence,
  loadSequenceDocument,
  replaceSequence,
} from '../internal/sequence-records.js';

type RequestMap = {
  [Method in WireRequestV1['method']]: Extract<WireRequestV1, { method: Method }>;
};
type SuccessMap = {
  [Method in WireSuccessV1['method']]: Extract<WireSuccessV1, { method: Method }>;
};
type Request<Method extends keyof RequestMap> = RequestMap[Method];
type Success<Method extends keyof SuccessMap> = SuccessMap[Method];
type SequenceCommand = Request<'sequence.apply'>['input']['command'];

const SequenceListCursorSchema = strictObject({
  filterHash: z.string().regex(/^[a-f0-9]{64}$/),
  updatedAt: z.string().datetime(),
  id: EntityIdSchema,
});

function invalid(message: string): StorageError {
  return new StorageError('INVALID_REQUEST', message);
}

function exactRequest<Method extends WireRequestV1['method']>(
  value: Request<Method>,
  method: Method,
): Request<Method> {
  const request = parseRequestV1(value);
  if (request.method !== method) throw invalid(`Expected Wire method ${method}`);
  return request as Request<Method>;
}

function success<Method extends WireRequestV1['method']>(
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

function requireProject(database: DatabaseSync, projectId: string): void {
  const project = database.prepare('SELECT lifecycle FROM projects WHERE id = ?').get(projectId) as
    | { lifecycle: string }
    | undefined;
  if (project === undefined) throw new StorageError('NOT_FOUND', `Project ${projectId} was not found`);
  if (project.lifecycle !== 'active') throw invalid(`Project ${projectId} is not active`);
}

function requireExactSequence(database: DatabaseSync, ref: SequenceRef): SequenceDocument {
  const sequence = loadSequenceDocument(database, ref.id);
  if (
    sequence.revision !== ref.revision ||
    sequence.contentHash !== ref.contentHash
  ) {
    throw new StorageError('REVISION_CONFLICT', `Sequence ${sequence.id} changed`);
  }
  return sequence;
}

function requireExactItem(sequence: SequenceDocument, ref: SequenceItemRef): SequenceItem {
  const item = sequence.items.find((entry) => entry.id === ref.id);
  if (item === undefined) throw new StorageError('NOT_FOUND', `Sequence item ${ref.id} was not found`);
  if (item.revision !== ref.revision || item.contentHash !== ref.contentHash) {
    throw new StorageError('REVISION_CONFLICT', `Sequence item ${item.id} changed`);
  }
  return item;
}

function siblings(sequence: SequenceDocument, parentItemId: string | null): SequenceItem[] {
  return sequence.items
    .filter((item) => item.parentItemId === parentItemId)
    .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id));
}

function assertParent(sequence: SequenceDocument, item: SequenceItem, parentItemId: string | null): void {
  if (item.kind === 'scene') {
    if (parentItemId !== null) throw invalid('Scene items must remain root items');
    return;
  }
  if (parentItemId === null) throw invalid(`${item.kind} items require a parent`);
  const parent = sequence.items.find((entry) => entry.id === parentItemId);
  if (parent === undefined) throw new StorageError('NOT_FOUND', `Sequence parent ${parentItemId} was not found`);
  if (item.kind === 'shot' && parent.kind !== 'scene') {
    throw invalid('Shot items require a Scene parent');
  }
  if (item.kind === 'clip' && parent.kind !== 'shot') {
    throw invalid('Clip items require a Shot parent');
  }
}

function requireProduction(
  database: DatabaseSync,
  projectId: string,
  ref: { id: string; revision: number; contentHash: string },
  type: 'scene' | 'shot',
) {
  const production = loadProductionObject(database, ref.id);
  if (
    production.projectId !== projectId ||
    production.type !== type ||
    production.lifecycle !== 'active'
  ) {
    throw invalid(`Sequence ${type} target ${ref.id} is not active in this Project`);
  }
  if (production.revision !== ref.revision || production.contentHash !== ref.contentHash) {
    throw new StorageError('REVISION_CONFLICT', `Production ${ref.id} changed`);
  }
  return production;
}

function requireClipResult(
  database: DatabaseSync,
  projectId: string,
  resultRef: Extract<SequenceItem, { kind: 'clip' }>['result'],
  shotItem: Extract<SequenceItem, { kind: 'shot' }>,
): void {
  const result = loadGeneratedResultRecord(database, resultRef.id);
  if (
    result.projectId !== projectId ||
    result.revision !== resultRef.revision ||
    result.contentHash !== resultRef.contentHash ||
    result.mediaKind !== 'video' ||
    result.technicalValidation.state !== 'valid' ||
    result.targetProductionObjectId !== shotItem.shot.id
  ) {
    throw invalid(`Sequence clip result ${resultRef.id} is not a valid video for this Shot`);
  }
}

function replaceItems(
  sequence: SequenceDocument,
  changed: ReadonlyMap<string, SequenceItem>,
  removed: ReadonlySet<string>,
): SequenceItem[] {
  return sequence.items
    .filter((item) => !removed.has(item.id))
    .map((item) => changed.get(item.id) ?? item);
}

function updateSiblingOrdinals(
  sequence: SequenceDocument,
  parentItemId: string | null,
  orderedIds: readonly string[],
  now: string,
  changed: Map<string, SequenceItem>,
): void {
  for (const [ordinal, id] of orderedIds.entries()) {
    const current = changed.get(id) ?? sequence.items.find((item) => item.id === id);
    if (current === undefined) throw new StorageError('NOT_FOUND', `Sequence item ${id} was not found`);
    if (current.parentItemId === parentItemId && current.ordinal === ordinal) continue;
    changed.set(
      id,
      finalizeSequenceItem({
        ...current,
        parentItemId,
        ordinal,
        revision: current.revision + 1,
        updatedAt: now,
      }),
    );
  }
}

function finalizeRevision(sequence: SequenceDocument, items: readonly SequenceItem[], now: string): SequenceDocument {
  return finalizeSequence({
    ...sequence,
    revision: sequence.revision + 1,
    items,
    updatedAt: now,
  });
}

function mutateSequence(
  database: DatabaseSync,
  environment: StorageEnvironment,
  request: Request<'sequence.apply'>,
  context: CommandContext,
): Success<'sequence.apply'> {
  const now = environment.now();
  return executeWireMutation(database, request, context, now, () => {
    const before = requireExactSequence(database, request.input.sequence);
    const command: SequenceCommand = request.input.command;
    let after: SequenceDocument;
    if (command.action === 'rename') {
      if (before.name === command.name) return { projectId: before.projectId, response: success(request, before) };
      after = finalizeRevision(before, before.items, now);
      after = finalizeSequence({ ...after, name: command.name });
    } else if (command.action === 'archive' || command.action === 'restore') {
      const lifecycle = command.action === 'archive' ? 'archived' : 'active';
      if (before.lifecycle === lifecycle) return { projectId: before.projectId, response: success(request, before) };
      after = finalizeSequence({
        ...before,
        revision: before.revision + 1,
        lifecycle,
        updatedAt: now,
        archivedAt: lifecycle === 'archived' ? now : null,
      });
    } else {
      if (before.lifecycle !== 'active') throw invalid(`Sequence ${before.id} is archived`);
      if (command.action === 'append_scene') {
        requireProduction(database, before.projectId, command.scene, 'scene');
        const item = finalizeSequenceItem({
          id: environment.createId('sequence_item'),
          kind: 'scene',
          parentItemId: null,
          ordinal: siblings(before, null).length,
          revision: 0,
          scene: command.scene,
          createdAt: now,
          updatedAt: now,
        });
        after = finalizeRevision(before, [...before.items, item], now);
      } else if (command.action === 'append_shot') {
        const scene = requireExactItem(before, command.sceneItem);
        if (scene.kind !== 'scene') throw invalid('Sequence Shot parent must be a Scene item');
        requireProduction(database, before.projectId, command.shot, 'shot');
        const item = finalizeSequenceItem({
          id: environment.createId('sequence_item'),
          kind: 'shot',
          parentItemId: scene.id,
          ordinal: siblings(before, scene.id).length,
          revision: 0,
          shot: command.shot,
          createdAt: now,
          updatedAt: now,
        });
        after = finalizeRevision(before, [...before.items, item], now);
      } else if (command.action === 'append_clip') {
        const shot = requireExactItem(before, command.shotItem);
        if (shot.kind !== 'shot') throw invalid('Sequence Clip parent must be a Shot item');
        requireClipResult(database, before.projectId, command.result, shot);
        const item = finalizeSequenceItem({
          id: environment.createId('sequence_item'),
          kind: 'clip',
          parentItemId: shot.id,
          ordinal: siblings(before, shot.id).length,
          revision: 0,
          result: command.result,
          trim: command.trim,
          audioPolicy: command.audioPolicy,
          transition: command.transition,
          reviewState: command.reviewState,
          createdAt: now,
          updatedAt: now,
        });
        after = finalizeRevision(before, [...before.items, item], now);
      } else if (command.action === 'update_clip') {
        const current = requireExactItem(before, command.item);
        if (current.kind !== 'clip') throw invalid('Only Clip items can be updated as clips');
        const parent = before.items.find((item) => item.id === current.parentItemId);
        if (parent?.kind !== 'shot') throw new StorageError('CORRUPT_DATA', 'Sequence Clip parent is invalid');
        requireClipResult(database, before.projectId, command.result, parent);
        const item = finalizeSequenceItem({
          ...current,
          revision: current.revision + 1,
          result: command.result,
          trim: command.trim,
          audioPolicy: command.audioPolicy,
          transition: command.transition,
          reviewState: command.reviewState,
          updatedAt: now,
        });
        after = finalizeRevision(before, replaceItems(before, new Map([[item.id, item]]), new Set()), now);
      } else if (command.action === 'move') {
        const current = requireExactItem(before, command.item);
        assertParent(before, current, command.parentItemId);
        const targetParent =
          command.parentItemId === null
            ? null
            : before.items.find((item) => item.id === command.parentItemId);
        if (current.kind === 'clip') {
          if (targetParent?.kind !== 'shot') throw invalid('Clip items require a Shot parent');
          requireClipResult(database, before.projectId, current.result, targetParent);
        }
        const sourceIds = siblings(before, current.parentItemId)
          .filter((item) => item.id !== current.id)
          .map((item) => item.id);
        const targetIds =
          current.parentItemId === command.parentItemId
            ? sourceIds
            : siblings(before, command.parentItemId).map((item) => item.id);
        if (command.index > targetIds.length) throw invalid('Sequence move index is out of range');
        targetIds.splice(command.index, 0, current.id);
        const changed = new Map<string, SequenceItem>();
        if (current.parentItemId !== command.parentItemId) {
          updateSiblingOrdinals(before, current.parentItemId, sourceIds, now, changed);
        }
        updateSiblingOrdinals(before, command.parentItemId, targetIds, now, changed);
        after = finalizeRevision(before, replaceItems(before, changed, new Set()), now);
      } else if (command.action === 'reorder') {
        const current = siblings(before, command.parentItemId);
        const currentIds = current.map((item) => item.id);
        const ordered = command.orderedItems.map((item) => {
          const currentItem = requireExactItem(before, item);
          if (currentItem.parentItemId !== command.parentItemId) {
            throw invalid('Sequence reorder items must share the specified parent');
          }
          return currentItem.id;
        });
        if (
          ordered.length !== currentIds.length ||
          [...ordered].sort().join('\u0000') !== [...currentIds].sort().join('\u0000')
        ) {
          throw invalid('Sequence reorder must name every current sibling exactly once');
        }
        const changed = new Map<string, SequenceItem>();
        updateSiblingOrdinals(before, command.parentItemId, ordered, now, changed);
        if (changed.size === 0) return { projectId: before.projectId, response: success(request, before) };
        after = finalizeRevision(before, replaceItems(before, changed, new Set()), now);
      } else {
        const current = requireExactItem(before, command.item);
        const removed = new Set<string>([current.id]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const item of before.items) {
            if (item.parentItemId !== null && removed.has(item.parentItemId) && !removed.has(item.id)) {
              removed.add(item.id);
              changed = true;
            }
          }
        }
        const remainingSiblingIds = siblings(before, current.parentItemId)
          .filter((item) => !removed.has(item.id))
          .map((item) => item.id);
        const updates = new Map<string, SequenceItem>();
        updateSiblingOrdinals(before, current.parentItemId, remainingSiblingIds, now, updates);
        after = finalizeRevision(before, replaceItems(before, updates, removed), now);
      }
    }
    replaceSequence(database, before, after);
    appendProjectEvent(database, {
      eventId: environment.createId('project_event'),
      projectId: after.projectId,
      occurredAt: now,
      actor: context.actor,
      subject: { authority: 'sequence', id: after.id },
      causation: context.causation,
      correlationId: context.correlationId,
      idempotencyKey: request.requestId,
      payload: {
        type: 'object_revision_changed',
        beforeRevision: before.revision,
        afterRevision: after.revision,
        beforeHash: before.contentHash,
        afterHash: after.contentHash,
      },
    });
    return { projectId: after.projectId, response: success(request, after) };
  });
}

function createSequence(
  database: DatabaseSync,
  environment: StorageEnvironment,
  request: Request<'sequence.create'>,
  context: CommandContext,
): Success<'sequence.create'> {
  const now = environment.now();
  return executeWireMutation(database, request, context, now, () => {
    requireProject(database, request.input.projectId);
    const sequence = createEmptySequence(
      request.input.projectId,
      environment.createId('sequence'),
      request.input.name,
      now,
    );
    insertSequence(database, sequence);
    appendProjectEvent(database, {
      eventId: environment.createId('project_event'),
      projectId: sequence.projectId,
      occurredAt: now,
      actor: context.actor,
      subject: { authority: 'sequence', id: sequence.id },
      causation: context.causation,
      correlationId: context.correlationId,
      idempotencyKey: request.requestId,
      payload: { type: 'object_created', revision: 0, contentHash: sequence.contentHash },
    });
    return { projectId: sequence.projectId, response: success(request, sequence) };
  });
}

function listSequences(
  database: DatabaseSync,
  request: Request<'sequence.list'>,
): Success<'sequence.list'> {
  const filterHash = hashCanonical({
    projectId: request.input.projectId,
    lifecycle: [...request.input.lifecycle].sort(),
  });
  const cursor =
    request.input.page.cursor === null
      ? null
      : (() => {
          const key = decodeCursor(request.input.page.cursor, 'sequence.list');
          if (key === null) throw invalid('Sequence list cursor is invalid');
          return parseCanonical(SequenceListCursorSchema, JSON.parse(key) as unknown);
        })();
  if (cursor !== null && cursor.filterHash !== filterHash) {
    throw invalid('Sequence list cursor belongs to another query');
  }
  requireProject(database, request.input.projectId);
  const lifecycleClause =
    request.input.lifecycle.length === 0
      ? ''
      : ` AND lifecycle IN (${request.input.lifecycle.map(() => '?').join(', ')})`;
  const cursorClause =
    cursor === null ? '' : ' AND (updated_at < ? OR (updated_at = ? AND id < ?))';
  const params: Array<string | number> = [request.input.projectId, ...request.input.lifecycle];
  if (cursor !== null) params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
  params.push(request.input.page.limit + 1);
  const rows = database
    .prepare(
      `SELECT id, updated_at FROM sequence_documents
       WHERE project_id = ?${lifecycleClause}${cursorClause}
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
    )
    .all(...params) as unknown as Array<{ id: string; updated_at: string }>;
  const pageRows = rows.slice(0, request.input.page.limit);
  const last = pageRows.at(-1);
  return success(request, {
    items: pageRows.map((row) => loadSequenceDocument(database, row.id)),
    nextCursor:
      rows.length > pageRows.length && last !== undefined
        ? encodeCursor(
            'sequence.list',
            canonicalJson({ filterHash, updatedAt: last.updated_at, id: last.id }),
          )
        : null,
  });
}

export interface SequenceAuthority {
  readonly create: (
    request: Request<'sequence.create'>,
    context: CommandContext,
  ) => Success<'sequence.create'>;
  readonly apply: (
    request: Request<'sequence.apply'>,
    context: CommandContext,
  ) => Success<'sequence.apply'>;
  readonly get: (request: Request<'sequence.get'>) => Success<'sequence.get'>;
  readonly list: (request: Request<'sequence.list'>) => Success<'sequence.list'>;
  readonly getDocument: (sequenceId: string) => SequenceDocument;
}

export function createSequenceAuthority(
  store: Store,
  environment: StorageEnvironment,
): SequenceAuthority {
  const database = () => getStoreDatabase(store);
  return Object.freeze({
    create(request, context) {
      return createSequence(database(), environment, exactRequest(request, 'sequence.create'), context);
    },
    apply(request, context) {
      return mutateSequence(database(), environment, exactRequest(request, 'sequence.apply'), context);
    },
    get(request) {
      const parsed = exactRequest(request, 'sequence.get');
      return success(parsed, loadSequenceDocument(database(), parsed.input.sequenceId));
    },
    list(request) {
      return listSequences(database(), exactRequest(request, 'sequence.list'));
    },
    getDocument(sequenceId) {
      return loadSequenceDocument(database(), sequenceId);
    },
  });
}
