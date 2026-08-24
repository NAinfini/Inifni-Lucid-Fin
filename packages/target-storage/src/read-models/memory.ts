import {
  EntityIdSchema,
  IsoTimestampSchema,
  MemoryQueryDefinition,
  MemorySourceSchema,
  ProjectMemoryIndexEntrySchema,
  ProjectMemoryIndexSchema,
  RevisionSchema,
  canonicalJson,
  parseCanonical,
  strictObject,
  z,
  type MemorySource,
  type ProjectMemoryIndex,
  type ProjectMemoryIndexEntry,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { hashCanonical, hashContentObject } from '../internal/hashes.js';
import { TargetStorageError } from '../kernel/errors.js';
import type { TargetStore } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';

type MemoryQueryInput = ReturnType<typeof MemoryQueryDefinition.parseInput>;
type MemoryQueryOutput = ReturnType<typeof MemoryQueryDefinition.parseSuccess>;

const MemorySourcesSchema = z.array(MemorySourceSchema).min(1).max(100);
const MemoryTopicsSchema = z.array(z.string().trim().min(1).max(120)).max(100);
const PublishMemoryHeadInputSchema = strictObject({
  projectId: EntityIdSchema,
  memoryVersionId: EntityIdSchema,
  expectedHeadRevision: RevisionSchema.nullable(),
  updatedAt: IsoTimestampSchema,
});
const memoryHeadFields = {
  index: ProjectMemoryIndexSchema,
  headRevision: RevisionSchema,
  activeHistoryWatermark: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).finite(),
} as const;
const ProjectMemoryHeadSchema = z.union([
  strictObject({ state: z.literal('ready'), ...memoryHeadFields }).refine(
    (head) => head.activeHistoryWatermark === head.index.historyWatermark,
    { path: ['activeHistoryWatermark'], message: 'Ready Memory must match History' },
  ),
  strictObject({ state: z.literal('stale'), ...memoryHeadFields }).refine(
    (head) => head.activeHistoryWatermark > head.index.historyWatermark,
    { path: ['activeHistoryWatermark'], message: 'Stale Memory must trail History' },
  ),
]);

export type ProjectMemoryHead = z.output<typeof ProjectMemoryHeadSchema>;
export type PublishMemoryHeadInput = z.input<typeof PublishMemoryHeadInputSchema>;

interface MemoryVersionRow {
  id: string;
  project_id: string;
  derivation_version: string;
  source_schema_version: string;
  history_watermark: number;
  source_set_hash: string;
  completeness: ProjectMemoryIndex['completeness'];
  created_at: string;
}

interface MemoryItemRow {
  id: string;
  category: ProjectMemoryIndexEntry['category'];
  sources_v1_json: string;
  state: ProjectMemoryIndexEntry['state'];
  tentative: number;
  topics_v1_json: string;
  searchable_text: string;
  content_hash: string;
}

interface MemoryHeadRow {
  memory_version_id: string;
  revision: number;
}

function corrupt(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'CORRUPT_DATA',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function decodeJson<Schema extends z.ZodType>(
  label: string,
  schema: Schema,
  json: string,
): z.output<Schema> {
  try {
    return parseCanonical(schema, JSON.parse(json));
  } catch (cause) {
    throw corrupt(`${label} is invalid`, cause);
  }
}

function requireProject(database: DatabaseSync, projectIdValue: string): string {
  const projectId = parseCanonical(EntityIdSchema, projectIdValue);
  if (database.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId) === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Project was not found: ${projectId}`);
  }
  return projectId;
}

function currentHistoryWatermark(database: DatabaseSync, projectId: string): number {
  const row = database
    .prepare(
      'SELECT COALESCE(MAX(sequence), 0) AS watermark FROM project_events WHERE project_id = ?',
    )
    .get(projectId) as unknown as { watermark: number };
  return parseCanonical(
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).finite(),
    row.watermark,
  );
}

function encodeSources(sources: readonly MemorySource[]): string {
  return canonicalJson(parseCanonical(MemorySourcesSchema, sources));
}

function encodeTopics(topics: readonly string[]): string {
  return canonicalJson(parseCanonical(MemoryTopicsSchema, topics));
}

export function computeProjectMemorySourceSetHash(
  entries: readonly ProjectMemoryIndexEntry[],
): string {
  const canonicalSources = new Map<string, MemorySource>();
  for (const entry of entries) {
    const parsedEntry = parseCanonical(ProjectMemoryIndexEntrySchema, entry);
    for (const source of parsedEntry.sources) canonicalSources.set(canonicalJson(source), source);
  }
  const sortedSources = [...canonicalSources.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, source]) => source);
  return hashCanonical(sortedSources);
}

function assertItemHash(entry: ProjectMemoryIndexEntry): void {
  if (hashContentObject(entry) !== entry.contentHash) {
    throw corrupt(`Project Memory item ${entry.id} content hash does not match`);
  }
}

function assertDomainSource(
  database: DatabaseSync,
  projectId: string,
  source: Extract<MemorySource, { kind: 'domain_object' }>,
): void {
  const { ref } = source;
  const row =
    ref.authority === 'project'
      ? (database
          .prepare(
            `SELECT id AS project_id, revision, content_hash
             FROM projects WHERE id = ?`,
          )
          .get(ref.id) as unknown as
          { project_id: string; revision: number; content_hash: string } | undefined)
      : ref.authority === 'project_media_ref'
        ? (database
            .prepare(
              `SELECT project_id, revision, content_hash
               FROM project_media_refs WHERE id = ?`,
            )
            .get(ref.id) as unknown as
            { project_id: string; revision: number; content_hash: string } | undefined)
        : ref.authority === 'production'
          ? (database
              .prepare(
                `SELECT project_id, revision, content_hash
                 FROM production_objects WHERE id = ?`,
              )
              .get(ref.id) as unknown as
              { project_id: string; revision: number; content_hash: string } | undefined)
          : (database
              .prepare(
                `SELECT project_id, revision, content_hash
                 FROM delivery_plans WHERE id = ?`,
              )
              .get(ref.id) as unknown as
              { project_id: string; revision: number; content_hash: string } | undefined);
  if (row === undefined) {
    throw new TargetStorageError(
      'NOT_FOUND',
      `Memory source was not found: ${ref.authority}:${ref.id}`,
    );
  }
  if (
    row.project_id !== projectId ||
    row.revision !== ref.revision ||
    row.content_hash !== ref.contentHash
  ) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Memory source no longer matches: ${ref.authority}:${ref.id}`,
    );
  }
}

function assertMemorySource(database: DatabaseSync, projectId: string, source: MemorySource): void {
  switch (source.kind) {
    case 'domain_object':
      assertDomainSource(database, projectId, source);
      return;
    case 'message': {
      const row = database
        .prepare(
          `SELECT project_id, chat_id, sequence, content_hash
           FROM messages WHERE id = ?`,
        )
        .get(source.messageId) as unknown as
        { project_id: string; chat_id: string; sequence: number; content_hash: string } | undefined;
      if (row === undefined) {
        throw new TargetStorageError(
          'NOT_FOUND',
          `Memory Message source was not found: ${source.messageId}`,
        );
      }
      if (
        row.project_id !== projectId ||
        row.chat_id !== source.chatId ||
        row.sequence !== source.sequence ||
        row.content_hash !== source.contentHash
      ) {
        throw new TargetStorageError(
          'REVISION_CONFLICT',
          `Memory Message source no longer matches: ${source.messageId}`,
        );
      }
      return;
    }
    case 'user_choice': {
      const row = database
        .prepare('SELECT project_id FROM user_choices WHERE id = ?')
        .get(source.choiceId) as unknown as { project_id: string } | undefined;
      if (row === undefined) {
        throw new TargetStorageError(
          'NOT_FOUND',
          `Memory UserChoice source was not found: ${source.choiceId}`,
        );
      }
      if (row.project_id !== projectId) {
        throw new TargetStorageError(
          'INVALID_REQUEST',
          `Memory UserChoice source belongs to another Project: ${source.choiceId}`,
        );
      }
      return;
    }
    case 'committed_run_change': {
      const run = database
        .prepare('SELECT project_id FROM runs WHERE id = ?')
        .get(source.runId) as unknown as { project_id: string } | undefined;
      const event = database
        .prepare(
          `SELECT project_id, sequence, event_hash
           FROM project_events WHERE id = ?`,
        )
        .get(source.projectEventId) as unknown as
        { project_id: string; sequence: number; event_hash: string } | undefined;
      if (run === undefined || event === undefined) {
        throw new TargetStorageError(
          'NOT_FOUND',
          `Committed Run change source was not found: ${source.runId}:${source.projectEventId}`,
        );
      }
      if (
        run.project_id !== projectId ||
        event.project_id !== projectId ||
        event.sequence !== source.projectEventSequence ||
        event.event_hash !== source.projectEventHash
      ) {
        throw new TargetStorageError(
          'REVISION_CONFLICT',
          `Committed Run change source no longer matches: ${source.projectEventId}`,
        );
      }
      return;
    }
    case 'generated_result': {
      const row = database
        .prepare(
          `SELECT project_id, revision, content_hash
           FROM generated_results WHERE id = ?`,
        )
        .get(source.ref.id) as unknown as
        { project_id: string; revision: number; content_hash: string } | undefined;
      if (row === undefined) {
        throw new TargetStorageError(
          'NOT_FOUND',
          `Memory GeneratedResult source was not found: ${source.ref.id}`,
        );
      }
      if (
        row.project_id !== projectId ||
        row.revision !== source.ref.revision ||
        row.content_hash !== source.ref.contentHash
      ) {
        throw new TargetStorageError(
          'REVISION_CONFLICT',
          `Memory GeneratedResult source no longer matches: ${source.ref.id}`,
        );
      }
    }
  }
}

function assertRecordableIndex(database: DatabaseSync, index: ProjectMemoryIndex): void {
  requireProject(database, index.projectId);
  if (index.historyWatermark > currentHistoryWatermark(database, index.projectId)) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      `Project Memory ${index.id} cites a future History watermark`,
    );
  }
  if (computeProjectMemorySourceSetHash(index.entries) !== index.sourceSetHash) {
    throw corrupt(`Project Memory ${index.id} source-set hash does not match`);
  }
  const itemIds = new Set<string>();
  for (const entry of index.entries) {
    if (itemIds.has(entry.id)) {
      throw new TargetStorageError(
        'INVALID_REQUEST',
        `Project Memory ${index.id} contains duplicate item ${entry.id}`,
      );
    }
    itemIds.add(entry.id);
    assertItemHash(entry);
    for (const source of entry.sources) assertMemorySource(database, index.projectId, source);
  }
}

function memoryVersionRow(
  database: DatabaseSync,
  memoryVersionId: string,
): MemoryVersionRow | undefined {
  return database
    .prepare('SELECT * FROM project_memory_versions WHERE id = ?')
    .get(memoryVersionId) as unknown as MemoryVersionRow | undefined;
}

function loadMemoryIndex(database: DatabaseSync, memoryVersionId: string): ProjectMemoryIndex {
  const row = memoryVersionRow(database, memoryVersionId);
  if (row === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Project Memory was not found: ${memoryVersionId}`);
  }
  const itemRows = database
    .prepare(
      `SELECT id, category, sources_v1_json, state, tentative, topics_v1_json,
              searchable_text, content_hash
       FROM project_memory_items
       WHERE memory_version_id = ?
       ORDER BY id`,
    )
    .all(memoryVersionId) as unknown as MemoryItemRow[];
  const entries = itemRows.map((item) => {
    const entry = parseCanonical(ProjectMemoryIndexEntrySchema, {
      id: item.id,
      category: item.category,
      sources: decodeJson(
        `Project Memory item ${item.id} sources`,
        MemorySourcesSchema,
        item.sources_v1_json,
      ),
      state: item.state,
      tentative: item.tentative === 1,
      topics: decodeJson(
        `Project Memory item ${item.id} topics`,
        MemoryTopicsSchema,
        item.topics_v1_json,
      ),
      searchableText: item.searchable_text,
      contentHash: item.content_hash,
    });
    assertItemHash(entry);
    return entry;
  });
  const index = parseCanonical(ProjectMemoryIndexSchema, {
    authority: 'project_memory',
    id: row.id,
    projectId: row.project_id,
    derivationVersion: row.derivation_version,
    sourceSchemaVersion: row.source_schema_version,
    historyWatermark: row.history_watermark,
    sourceSetHash: row.source_set_hash,
    completeness: row.completeness,
    entries,
    createdAt: row.created_at,
  });
  if (computeProjectMemorySourceSetHash(index.entries) !== index.sourceSetHash) {
    throw corrupt(`Project Memory ${index.id} source-set hash does not match`);
  }
  return index;
}

export function loadHead(database: DatabaseSync, projectId: string): ProjectMemoryHead | null {
  const head = database
    .prepare(
      `SELECT memory_version_id, revision
       FROM project_memory_heads WHERE project_id = ?`,
    )
    .get(projectId) as unknown as MemoryHeadRow | undefined;
  if (head === undefined) return null;
  const index = loadMemoryIndex(database, head.memory_version_id);
  if (index.projectId !== projectId || index.completeness !== 'complete') {
    throw corrupt(`Project Memory head for ${projectId} does not reference a complete version`);
  }
  const activeHistoryWatermark = currentHistoryWatermark(database, projectId);
  if (activeHistoryWatermark < index.historyWatermark) {
    throw corrupt(`Project Memory head for ${projectId} is ahead of Project History`);
  }
  return parseCanonical(ProjectMemoryHeadSchema, {
    state: activeHistoryWatermark === index.historyWatermark ? 'ready' : 'stale',
    index,
    headRevision: head.revision,
    activeHistoryWatermark,
  });
}

function recordVersion(database: DatabaseSync, indexValue: ProjectMemoryIndex): ProjectMemoryIndex {
  const index = parseCanonical(ProjectMemoryIndexSchema, indexValue);
  return withImmediateTransaction(database, () => {
    assertRecordableIndex(database, index);
    if (memoryVersionRow(database, index.id) !== undefined) {
      throw new TargetStorageError(
        'INVALID_REQUEST',
        `Project Memory version already exists: ${index.id}`,
      );
    }
    const equivalent = database
      .prepare(
        `SELECT id FROM project_memory_versions
         WHERE project_id = ? AND derivation_version = ? AND history_watermark = ?
           AND source_set_hash = ?`,
      )
      .get(index.projectId, index.derivationVersion, index.historyWatermark, index.sourceSetHash);
    if (equivalent !== undefined) {
      throw new TargetStorageError(
        'INVALID_REQUEST',
        `Equivalent Project Memory version already exists for ${index.projectId}`,
      );
    }
    const duplicateItem = index.entries.find(
      (entry) =>
        database.prepare('SELECT 1 FROM project_memory_items WHERE id = ?').get(entry.id) !==
        undefined,
    );
    if (duplicateItem !== undefined) {
      throw new TargetStorageError(
        'INVALID_REQUEST',
        `Project Memory item already exists: ${duplicateItem.id}`,
      );
    }
    database
      .prepare(
        `INSERT INTO project_memory_versions (
           id, project_id, derivation_version, source_schema_version, history_watermark,
           source_set_hash, completeness, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        index.id,
        index.projectId,
        index.derivationVersion,
        index.sourceSchemaVersion,
        index.historyWatermark,
        index.sourceSetHash,
        index.completeness,
        index.createdAt,
      );
    const insertItem = database.prepare(
      `INSERT INTO project_memory_items (
         id, memory_version_id, category, sources_v1_json, state, tentative,
         topics_v1_json, searchable_text, content_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const entry of index.entries) {
      insertItem.run(
        entry.id,
        index.id,
        entry.category,
        encodeSources(entry.sources),
        entry.state,
        entry.tentative ? 1 : 0,
        encodeTopics(entry.topics),
        entry.searchableText,
        entry.contentHash,
      );
    }
    return loadMemoryIndex(database, index.id);
  });
}

function publishHead(
  database: DatabaseSync,
  inputValue: PublishMemoryHeadInput,
): ProjectMemoryHead {
  const input = parseCanonical(PublishMemoryHeadInputSchema, inputValue);
  return withImmediateTransaction(database, () => {
    requireProject(database, input.projectId);
    const index = loadMemoryIndex(database, input.memoryVersionId);
    if (index.projectId !== input.projectId) {
      throw new TargetStorageError(
        'INVALID_REQUEST',
        `Project Memory ${index.id} belongs to another Project`,
      );
    }
    if (index.completeness !== 'complete') {
      throw new TargetStorageError(
        'INVALID_REQUEST',
        `Only complete Project Memory versions can be published: ${index.id}`,
      );
    }
    const current = database
      .prepare(
        `SELECT memory_version_id, revision
         FROM project_memory_heads WHERE project_id = ?`,
      )
      .get(input.projectId) as unknown as MemoryHeadRow | undefined;
    if (
      (current === undefined && input.expectedHeadRevision !== null) ||
      (current !== undefined &&
        (input.expectedHeadRevision === null || current.revision !== input.expectedHeadRevision))
    ) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        `Project Memory head revision does not match for ${input.projectId}`,
      );
    }
    if (current !== undefined) {
      const currentIndex = loadMemoryIndex(database, current.memory_version_id);
      if (index.historyWatermark < currentIndex.historyWatermark) {
        throw new TargetStorageError(
          'REVISION_CONFLICT',
          `Project Memory ${index.id} is older than the current head`,
        );
      }
      if (current.memory_version_id !== index.id) {
        const update = database
          .prepare(
            `UPDATE project_memory_heads
             SET memory_version_id = ?, revision = revision + 1, updated_at = ?
             WHERE project_id = ? AND revision = ?`,
          )
          .run(index.id, input.updatedAt, input.projectId, current.revision);
        if (Number(update.changes) !== 1) {
          throw new TargetStorageError(
            'REVISION_CONFLICT',
            `Project Memory head changed concurrently for ${input.projectId}`,
          );
        }
      }
    } else {
      database
        .prepare(
          `INSERT INTO project_memory_heads (
             project_id, memory_version_id, completeness, revision, updated_at
           ) VALUES (?, ?, 'complete', 0, ?)`,
        )
        .run(input.projectId, index.id, input.updatedAt);
    }
    const published = loadHead(database, input.projectId);
    if (published === null) throw corrupt(`Project Memory head disappeared for ${input.projectId}`);
    return published;
  });
}

function queryMemory(
  database: DatabaseSync,
  projectIdValue: string,
  inputValue: MemoryQueryInput,
): MemoryQueryOutput {
  const input = MemoryQueryDefinition.parseInput(inputValue);
  const projectId = requireProject(database, projectIdValue);
  const current = loadHead(database, projectId);
  if (current === null) {
    const failed = database
      .prepare(
        `SELECT 1 FROM project_memory_versions
         WHERE project_id = ? AND completeness = 'failed'
         LIMIT 1`,
      )
      .get(projectId);
    return MemoryQueryDefinition.parseSuccess({
      state: 'unavailable',
      reason: failed === undefined ? 'not_built' : 'failed',
    });
  }
  const normalizedQuery = input.query.toLowerCase();
  const entries = current.index.entries
    .filter(
      (entry) =>
        (input.categories.length === 0 || input.categories.includes(entry.category)) &&
        (input.itemKeys.length === 0 || input.itemKeys.includes(entry.id)) &&
        entry.searchableText.toLowerCase().includes(normalizedQuery),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, input.limit);
  return MemoryQueryDefinition.parseSuccess({
    state: current.state,
    head: {
      memoryVersionId: current.index.id,
      headRevision: current.headRevision,
      derivationVersion: current.index.derivationVersion,
      sourceSchemaVersion: current.index.sourceSchemaVersion,
      historyWatermark: current.index.historyWatermark,
      sourceSetHash: current.index.sourceSetHash,
      completeness: 'complete',
      createdAt: current.index.createdAt,
    },
    activeHistoryWatermark: current.activeHistoryWatermark,
    items: entries.map((entry) => ({
      itemId: entry.id,
      category: entry.category,
      text: entry.searchableText,
      state: entry.state,
      tentative: entry.tentative,
      sources: entry.sources,
      contentHash: entry.contentHash,
    })),
  });
}

export interface ProjectMemoryReadModel {
  readonly recordVersion: (index: ProjectMemoryIndex) => ProjectMemoryIndex;
  readonly publishHead: (input: PublishMemoryHeadInput) => ProjectMemoryHead;
  readonly getHead: (projectId: string) => ProjectMemoryHead | null;
  readonly query: (projectId: string, input: MemoryQueryInput) => MemoryQueryOutput;
}

export function createProjectMemoryReadModel(store: TargetStore): ProjectMemoryReadModel {
  return Object.freeze({
    recordVersion(index: ProjectMemoryIndex) {
      return recordVersion(getTargetStoreDatabase(store), index);
    },
    publishHead(input: PublishMemoryHeadInput) {
      return publishHead(getTargetStoreDatabase(store), input);
    },
    getHead(projectIdValue: string) {
      const database = getTargetStoreDatabase(store);
      return loadHead(database, requireProject(database, projectIdValue));
    },
    query(projectId: string, input: MemoryQueryInput) {
      return queryMemory(getTargetStoreDatabase(store), projectId, input);
    },
  });
}
