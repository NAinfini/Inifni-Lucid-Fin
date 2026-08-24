import {
  legacyClassificationSourceKey,
  type LegacyClassificationEntryInput,
} from './classification-report.js';
import type { LegacyClassificationRow } from './classification-subjects.js';

const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const MAXIMUM_TIMESTAMP_MILLISECONDS = 8_640_000_000_000_000n;

interface FolderState {
  readonly row: LegacyClassificationRow;
  readonly id: string | null;
  readonly parentId: string | null;
  blockerCode: string | null;
}

function safeInteger(value: unknown): value is bigint {
  return (
    typeof value === 'bigint' &&
    value >= BigInt(Number.MIN_SAFE_INTEGER) &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
  );
}

function validTimestamp(value: unknown): value is bigint {
  return typeof value === 'bigint' && value >= 0n && value <= MAXIMUM_TIMESTAMP_MILLISECONDS;
}

function initialState(row: LegacyClassificationRow): FolderState {
  if (row.database !== 'main' || row.table !== 'asset_folders' || row.subject.path !== '$') {
    throw new TypeError(
      `GlobalMediaFolder classifier received ${row.database}.${row.table}:${row.subject.path}`,
    );
  }
  const id = row.values.id;
  const parentId = row.values.parent_id;
  const normalizedId = typeof id === 'string' && ENTITY_ID_PATTERN.test(id) ? id : null;
  const normalizedParentId =
    parentId === null
      ? null
      : typeof parentId === 'string' && ENTITY_ID_PATTERN.test(parentId)
        ? parentId
        : null;
  let blockerCode: string | null = null;
  if (normalizedId === null) blockerCode = 'invalid_global_media_folder_id';
  else if (parentId !== null && normalizedParentId === null) {
    blockerCode = 'invalid_global_media_folder_parent_id';
  } else if (normalizedParentId === normalizedId) {
    blockerCode = 'self_referencing_global_media_folder';
  } else {
    const name = row.values.name;
    if (
      typeof name !== 'string' ||
      name.length === 0 ||
      name.length > 240 ||
      name.trim() !== name
    ) {
      blockerCode = 'invalid_global_media_folder_name';
    } else if (!safeInteger(row.values.sort_order)) {
      blockerCode = 'invalid_global_media_folder_sort_order';
    } else if (!validTimestamp(row.values.created_at) || !validTimestamp(row.values.updated_at)) {
      blockerCode = 'invalid_global_media_folder_timestamp';
    } else if (row.values.updated_at < row.values.created_at) {
      blockerCode = 'global_media_folder_timestamp_order';
    }
  }
  return { row, id: normalizedId, parentId: normalizedParentId, blockerCode };
}

function blockingEntry(state: FolderState): LegacyClassificationEntryInput {
  if (state.blockerCode === null) throw new Error('Global Media Folder blocker is missing');
  return {
    subject: state.row.subject,
    disposition: 'blocking_error',
    reasonCode: state.blockerCode,
    targetRefs: [],
    exportRef: null,
    blockerCode: state.blockerCode,
  };
}

function markCycles(statesById: ReadonlyMap<string, FolderState>): void {
  const complete = new Set<string>();
  for (const start of statesById.values()) {
    if (start.blockerCode !== null || start.id === null || complete.has(start.id)) continue;
    const path: FolderState[] = [];
    const positions = new Map<string, number>();
    let current: FolderState | undefined = start;
    while (
      current !== undefined &&
      current.id !== null &&
      current.blockerCode === null &&
      !complete.has(current.id)
    ) {
      const cycleStart = positions.get(current.id);
      if (cycleStart !== undefined) {
        for (const member of path.slice(cycleStart)) {
          member.blockerCode = 'cyclic_global_media_folder_hierarchy';
        }
        break;
      }
      positions.set(current.id, path.length);
      path.push(current);
      current = current.parentId === null ? undefined : statesById.get(current.parentId);
    }
    for (const member of path) {
      if (member.id !== null) complete.add(member.id);
    }
  }
}

export function classifyLegacyGlobalMediaFolderRows(
  rows: readonly LegacyClassificationRow[],
): readonly LegacyClassificationEntryInput[] {
  const states = rows.map(initialState);
  const identityCounts = new Map<string, number>();
  for (const { id } of states) {
    if (id !== null) identityCounts.set(id, (identityCounts.get(id) ?? 0) + 1);
  }
  for (const state of states) {
    if (state.id !== null && identityCounts.get(state.id) !== 1) {
      state.blockerCode = 'duplicate_global_media_folder_id';
    }
  }
  const statesById = new Map(
    states.flatMap((state) =>
      state.id !== null && identityCounts.get(state.id) === 1 ? [[state.id, state] as const] : [],
    ),
  );
  for (const state of states) {
    if (state.blockerCode !== null || state.parentId === null) continue;
    const parentCount = identityCounts.get(state.parentId) ?? 0;
    if (parentCount === 0) state.blockerCode = 'missing_global_media_folder_parent';
    else if (parentCount > 1) state.blockerCode = 'ambiguous_global_media_folder_parent';
  }
  markCycles(statesById);

  let changed = true;
  while (changed) {
    changed = false;
    for (const state of states) {
      if (state.blockerCode !== null || state.parentId === null) continue;
      const parent = statesById.get(state.parentId);
      if (parent !== undefined && parent.blockerCode !== null) {
        state.blockerCode = 'unmigratable_global_media_folder_parent';
        changed = true;
      }
    }
  }

  return states
    .map((state): LegacyClassificationEntryInput =>
      state.blockerCode === null && state.id !== null
        ? {
            subject: state.row.subject,
            disposition: 'migrated_current_state',
            reasonCode: 'legacy_global_media_folder_identity',
            targetRefs: [{ authority: 'global_media_folder', id: state.id, projectId: null }],
            exportRef: null,
            blockerCode: null,
          }
        : blockingEntry(state),
    )
    .sort((left, right) =>
      legacyClassificationSourceKey(left.subject).localeCompare(
        legacyClassificationSourceKey(right.subject),
      ),
    );
}
