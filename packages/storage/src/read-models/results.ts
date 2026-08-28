import {
  EntityIdSchema,
  GeneratedResultQueryViewSchema,
  IsoTimestampSchema,
  ResultQueryDefinition,
  Sha256Schema,
  assertGeneratedResultQueryProjection,
  canonicalJson,
  parseCanonical,
  strictObject,
  type GeneratedResult,
  z,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { decodeProjectSearchSource } from '../internal/canonical-codecs.js';
import { decodeCursor, encodeCursor } from '../internal/cursor.js';
import { getStoreDatabase } from '../internal/database-access.js';
import { hashCanonical } from '../internal/hashes.js';
import { artifactForMediaBlob } from '../internal/media-records.js';
import {
  loadGeneratedResultRecord,
  loadGenerationOwner,
  loadOperationOwnerRecord,
} from '../internal/operation-owner-records.js';
import {
  projectSearchSourceIdentity,
  type ProjectSearchSourceState,
} from '../internal/search-projection.js';
import { StorageError } from '../kernel/errors.js';
import type { Store } from '../kernel/store.js';

type ResultQueryInput = ReturnType<typeof ResultQueryDefinition.parseInput>;
type ResultQuerySuccess = ReturnType<typeof ResultQueryDefinition.parseSuccess>;

const ResultsCursorSchema = strictObject({
  filterHash: Sha256Schema,
  createdAt: IsoTimestampSchema,
  resultId: EntityIdSchema,
});

interface ResultRow {
  id: string;
  created_at: string;
}

interface SearchRow {
  project_id: string;
  source_kind: string;
  source_id: string;
  source_revision: number | null;
  source_hash: string;
  source_state: ProjectSearchSourceState;
  source_v1_json: string;
}

function corrupt(message: string, cause?: unknown): StorageError {
  return new StorageError('CORRUPT_DATA', message, cause === undefined ? undefined : { cause });
}

function requireProject(database: DatabaseSync, value: string): string {
  const projectId = parseCanonical(EntityIdSchema, value);
  if (database.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId) === undefined) {
    throw new StorageError('NOT_FOUND', `Project was not found: ${projectId}`);
  }
  return projectId;
}

function decodeResultsCursor(cursor: string | null) {
  const value = decodeCursor(cursor, 'result.query');
  if (value === null) return null;
  try {
    return parseCanonical(ResultsCursorSchema, JSON.parse(value) as unknown);
  } catch (cause) {
    throw new StorageError('INVALID_REQUEST', 'Result query cursor is invalid', { cause });
  }
}

function searchAssociation(database: DatabaseSync, result: GeneratedResult): void {
  const row = database
    .prepare(
      `SELECT project_id, source_kind, source_id, source_revision, source_hash, source_state,
              source_v1_json
       FROM project_search_documents
       WHERE project_id = ? AND source_kind = 'generated_result' AND source_id = ?`,
    )
    .get(result.projectId, result.id) as unknown as SearchRow | undefined;
  if (row === undefined) {
    throw corrupt(`Generated Result ${result.id} has no Project search association`);
  }
  const source = decodeProjectSearchSource(row.source_v1_json);
  const identity = projectSearchSourceIdentity(source);
  const expected = {
    kind: 'generated_result' as const,
    ref: {
      authority: 'generated_result' as const,
      id: result.id,
      revision: result.revision,
      contentHash: result.contentHash,
    },
  };
  if (
    canonicalJson(source) !== canonicalJson(expected) ||
    row.project_id !== result.projectId ||
    row.source_kind !== identity.kind ||
    row.source_id !== identity.id ||
    row.source_revision !== identity.revision ||
    row.source_hash !== identity.hash ||
    row.source_state !== 'current'
  ) {
    throw corrupt(`Generated Result ${result.id} Project search association does not match`);
  }
}

function requestForResult(database: DatabaseSync, result: GeneratedResult) {
  const owner = loadGenerationOwner(database, result.generationAttemptId);
  if (
    owner.view.authority !== 'generation_attempt' ||
    owner.projectId !== result.projectId ||
    owner.runId !== result.runId ||
    owner.view.state !== 'succeeded' ||
    owner.view.request.id !== result.generationRequestId ||
    owner.view.request.projectId !== result.projectId ||
    owner.view.request.runId !== result.runId ||
    owner.view.request.spec.target.id !== result.targetProductionObjectId ||
    owner.view.request.spec.prompt !== result.submittedPrompt ||
    owner.view.request.spec.negativePrompt !== result.submittedNegativePrompt ||
    owner.view.request.spec.seed !== result.seed ||
    canonicalJson(owner.view.provider) !== canonicalJson(result.provider)
  ) {
    throw corrupt(`Generated Result ${result.id} does not match its frozen Request and Attempt`);
  }
  return owner.view.request;
}

function assessmentIds(database: DatabaseSync, result: GeneratedResult): string[] {
  const rows = database
    .prepare(
      `SELECT DISTINCT subject.attempt_id AS id
       FROM result_assessment_subjects AS subject
       JOIN result_assessments AS assessment ON assessment.attempt_id = subject.attempt_id
       WHERE subject.authority = 'generated_result' AND subject.object_id = ?
       ORDER BY subject.attempt_id`,
    )
    .all(result.id) as unknown as Array<{ id: string }>;
  const expectedRef = {
    authority: 'generated_result' as const,
    id: result.id,
    revision: result.revision,
    contentHash: result.contentHash,
  };
  return rows.map(({ id }) => {
    const owner = loadOperationOwnerRecord(database, 'result_assessment_attempt', id);
    if (
      owner.view.authority !== 'result_assessment_attempt' ||
      owner.projectId !== result.projectId ||
      owner.view.state !== 'succeeded' ||
      owner.view.assessment === null ||
      !owner.view.assessment.subjects.some(
        ({ ref }) => canonicalJson(ref) === canonicalJson(expectedRef),
      )
    ) {
      throw corrupt(`Result Assessment ${id} does not match Generated Result ${result.id}`);
    }
    return id;
  });
}

function projectResultRows(database: DatabaseSync, projectId: string): ResultRow[] {
  return database
    .prepare(
      `SELECT id, created_at
       FROM generated_results
       WHERE project_id = ?
       ORDER BY created_at, id`,
    )
    .all(projectId) as unknown as ResultRow[];
}

function compareCursor(row: ResultRow, cursor: z.output<typeof ResultsCursorSchema>): number {
  return row.created_at.localeCompare(cursor.createdAt) || row.id.localeCompare(cursor.resultId);
}

function matchesFilters(
  input: ResultQueryInput,
  result: GeneratedResult,
  request: ReturnType<typeof requestForResult>,
): boolean {
  if (input.resultIds.length > 0 && !input.resultIds.includes(result.id)) return false;
  if (input.requestIds.length > 0 && !input.requestIds.includes(request.id)) return false;
  return (
    input.targetRefs.length === 0 ||
    input.targetRefs.some((target) => canonicalJson(target) === canonicalJson(request.spec.target))
  );
}

function resultView(
  database: DatabaseSync,
  input: ResultQueryInput,
  result: GeneratedResult,
  request: ReturnType<typeof requestForResult>,
): z.output<typeof GeneratedResultQueryViewSchema> {
  const include = new Set(input.include);
  const view = GeneratedResultQueryViewSchema.parse({
    resultRef: {
      authority: 'generated_result',
      id: result.id,
      revision: result.revision,
      contentHash: result.contentHash,
    },
    requestId: request.id,
    targetRef: request.spec.target,
    technicalValidation: result.technicalValidation,
    artifact: include.has('artifact')
      ? artifactForMediaBlob(database, result.id, result.mediaBlobHash, result.mediaKind)
      : null,
    submittedPrompt: include.has('prompt') ? result.submittedPrompt : null,
    referenceBindings: include.has('references') ? result.referenceBindings : null,
    provider: include.has('provider') ? result.provider : null,
    assessmentIds: include.has('assessments') ? assessmentIds(database, result) : null,
  });
  try {
    assertGeneratedResultQueryProjection(input, view);
  } catch (cause) {
    throw corrupt(`Generated Result ${result.id} projection does not match its include set`, cause);
  }
  return view;
}

export interface ProjectResultsReadModel {
  query(projectId: string, input: ResultQueryInput): ResultQuerySuccess;
}

export function createProjectResultsReadModel(store: Store): ProjectResultsReadModel {
  return Object.freeze({
    query(projectIdValue: string, inputValue: ResultQueryInput) {
      const input = ResultQueryDefinition.parseInput(inputValue);
      const database = getStoreDatabase(store);
      const projectId = requireProject(database, projectIdValue);
      const filterHash = hashCanonical({
        projectId,
        resultIds: input.resultIds,
        requestIds: input.requestIds,
        targetRefs: input.targetRefs,
        include: input.include,
      });
      const cursor = decodeResultsCursor(input.page.cursor);
      if (cursor !== null && cursor.filterHash !== filterHash) {
        throw new StorageError('INVALID_REQUEST', 'Result query cursor belongs to another query');
      }
      const matching = projectResultRows(database, projectId)
        .map((row) => {
          const result = loadGeneratedResultRecord(database, row.id);
          const request = requestForResult(database, result);
          searchAssociation(database, result);
          return { row, result, request };
        })
        .filter(
          ({ row, result, request }) =>
            (cursor === null || compareCursor(row, cursor) > 0) &&
            matchesFilters(input, result, request),
        );
      const page = matching.slice(0, input.page.limit);
      const last = page.at(-1);
      return ResultQueryDefinition.parseSuccess({
        items: page.map(({ result, request }) => resultView(database, input, result, request)),
        nextCursor:
          matching.length > page.length && last !== undefined
            ? encodeCursor(
                'result.query',
                canonicalJson({
                  filterHash,
                  createdAt: last.row.created_at,
                  resultId: last.row.id,
                }),
              )
            : null,
      });
    },
  });
}
