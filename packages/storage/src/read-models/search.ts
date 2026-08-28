import {
  EntityIdSchema,
  ProjectSearchDefinition,
  parseCanonical,
  strictObject,
  z,
  type ProjectSearchSourceV1,
} from '@lucid-fin/contracts';
import type { Store } from '../kernel/store.js';
import { StorageError } from '../kernel/errors.js';
import { decodeProjectSearchSource } from '../internal/canonical-codecs.js';
import { decodeCursor, encodeCursor } from '../internal/cursor.js';
import { getStoreDatabase } from '../internal/database-access.js';
import { hashCanonical } from '../internal/hashes.js';
import { projectSearchSourceIdentity } from '../internal/search-projection.js';

const SearchCursorKeySchema = strictObject({
  filterHash: z.string().regex(/^[a-f0-9]{64}$/),
  rank: z.number().finite(),
  searchDocumentId: z.number().int().positive(),
});

export type ProjectSearchQueryInput = ReturnType<typeof ProjectSearchDefinition.parseInput>;
export type ProjectSearchReadPage = ReturnType<typeof ProjectSearchDefinition.parseSuccess>;
export type ProjectSearchReadHit = ProjectSearchReadPage['items'][number];

interface RankedSearchRow {
  search_document_id: number;
  source_kind: ProjectSearchSourceV1['kind'];
  source_id: string;
  source_revision: number | null;
  source_hash: string;
  source_v1_json: string;
  search_text: string;
  rank: number;
}

function sourceFromRow(row: RankedSearchRow): ProjectSearchSourceV1 {
  const source = decodeProjectSearchSource(row.source_v1_json);
  const identity = projectSearchSourceIdentity(source);
  if (
    identity.kind !== row.source_kind ||
    identity.id !== row.source_id ||
    identity.revision !== row.source_revision ||
    identity.hash !== row.source_hash
  ) {
    throw new StorageError(
      'CORRUPT_DATA',
      `Project search document ${row.search_document_id} source columns do not match its typed source`,
    );
  }
  return source;
}

function encodeSearchCursor(value: z.input<typeof SearchCursorKeySchema>): string {
  const cursor = parseCanonical(SearchCursorKeySchema, value);
  return encodeCursor('project.search', JSON.stringify(cursor));
}

function decodeSearchCursor(cursor: string | null) {
  const value = decodeCursor(cursor, 'project.search');
  if (value === null) return null;
  try {
    return parseCanonical(SearchCursorKeySchema, JSON.parse(value) as unknown);
  } catch (cause) {
    throw new StorageError('INVALID_REQUEST', 'Project search cursor is invalid', { cause });
  }
}

function quoteFtsPhrase(query: string): string {
  return `"${query.replaceAll('"', '""')}"`;
}

function hitFromRow(row: RankedSearchRow): ProjectSearchReadHit {
  const source = sourceFromRow(row);
  const text = row.search_text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
  const firstLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  const sourceId = source.kind === 'message' ? source.messageId : source.ref.id;
  return {
    source,
    label: (firstLine ?? `${source.kind}:${sourceId}`).slice(0, 500),
    excerpt: text.slice(0, 4_000),
    score: 1 / (1 + Math.exp(row.rank)),
  };
}

export interface ProjectSearchReadModel {
  query(projectId: string, input: ProjectSearchQueryInput): ProjectSearchReadPage;
}

export function createProjectSearchReadModel(store: Store): ProjectSearchReadModel {
  return Object.freeze({
    query(projectIdInput: string, inputValue: ProjectSearchQueryInput) {
      const projectId = parseCanonical(EntityIdSchema, projectIdInput);
      const input = ProjectSearchDefinition.parseInput(inputValue);
      const cursor = decodeSearchCursor(input.page.cursor);
      const filterHash = hashCanonical({
        projectId,
        query: input.query,
        kinds: input.kinds,
        state: input.state,
      });
      if (cursor !== null && cursor.filterHash !== filterHash) {
        throw new StorageError('INVALID_REQUEST', 'Project search cursor belongs to another query');
      }

      const database = getStoreDatabase(store);
      if (database.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId) === undefined) {
        throw new StorageError('NOT_FOUND', `Project ${projectId} was not found`);
      }
      const kindClause =
        input.kinds.length === 0
          ? ''
          : ` AND document.source_kind IN (${input.kinds.map(() => '?').join(', ')})`;
      const stateClause = input.state === 'any' ? '' : ' AND document.source_state = ?';
      const cursorClause =
        cursor === null ? '' : ' WHERE rank > ? OR (rank = ? AND search_document_id > ?)';
      const parameters: Array<string | number> = [
        quoteFtsPhrase(input.query),
        projectId,
        ...input.kinds,
        ...(input.state === 'any' ? [] : [input.state]),
        ...(cursor === null ? [] : [cursor.rank, cursor.rank, cursor.searchDocumentId]),
        input.page.limit + 1,
      ];
      const rows = database
        .prepare(
          `WITH ranked AS (
             SELECT document.search_document_id, document.source_kind, document.source_id,
                    document.source_revision, document.source_hash, document.source_v1_json,
                    document.search_text, bm25(project_search_fts) AS rank
             FROM project_search_fts
             JOIN project_search_documents AS document
               ON document.search_document_id = project_search_fts.rowid
             WHERE project_search_fts MATCH ? AND document.project_id = ?${kindClause}${stateClause}
           )
           SELECT * FROM ranked${cursorClause}
           ORDER BY rank, search_document_id
           LIMIT ?`,
        )
        .all(...parameters) as unknown as RankedSearchRow[];
      const hasMore = rows.length > input.page.limit;
      const pageRows = rows.slice(0, input.page.limit);
      const last = pageRows.at(-1);
      return ProjectSearchDefinition.parseSuccess({
        items: pageRows.map(hitFromRow),
        nextCursor:
          hasMore && last !== undefined
            ? encodeSearchCursor({
                filterHash,
                rank: last.rank,
                searchDocumentId: last.search_document_id,
              })
            : null,
      });
    },
  });
}
