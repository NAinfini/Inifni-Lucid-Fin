import {
  EntityIdSchema,
  PROVIDER_CONTINUATION_UNAVAILABLE,
  RunInspectDefinition,
  parseCanonical,
  type CapabilityCatalogSnapshotV1,
  type ContextManifest,
  type ProviderContinuationUnavailable,
  type Run,
  type RunActivation,
  type RunEvent,
  type RunInboxMessage,
  type TaskList,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import {
  assertCompactionJournalProjection,
  loadCompactionTransactions,
  loadCompactionViews,
  type CompactionTransactionRecord,
  type CompactionViewRecord,
} from '../internal/compaction-records.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { formatExactDecimal } from '../internal/exact-decimal.js';
import { hashCanonical } from '../internal/hashes.js';
import { loadRunActivations } from '../internal/run-activation-records.js';
import { loadRunBudgetExposure } from '../internal/run-budget.js';
import { listRunInbox } from '../internal/run-inbox.js';
import { loadRunEvents } from '../internal/run-journal.js';
import { loadRun } from '../internal/run-records.js';
import {
  loadRunResourceEntries,
  type RunResourceEntry,
  type RunResourceKind,
} from '../internal/run-resource-ledger.js';
import { loadRunSnapshots } from '../internal/run-snapshots.js';
import { loadTaskList } from '../internal/task-list-records.js';
import { TargetStorageError } from '../kernel/errors.js';
import type { TargetStore } from '../kernel/store.js';

export interface RunReplayProjection {
  readonly projectionHash: string;
  readonly run: Run;
  readonly manifest: ContextManifest;
  readonly catalog: CapabilityCatalogSnapshotV1;
  readonly inbox: readonly RunInboxMessage[];
  readonly activations: readonly RunActivation[];
  readonly journal: readonly RunEvent[];
  readonly taskList: TaskList | null;
  readonly compactionTransactions: readonly CompactionTransactionRecord[];
  readonly compactionViews: readonly CompactionViewRecord[];
  readonly providerContinuation: ProviderContinuationUnavailable;
}

export type RunInspectInput = ReturnType<typeof RunInspectDefinition.parseInput>;
export type RunInspectView = ReturnType<typeof RunInspectDefinition.parseSuccess>;
type RunInspectSection = RunInspectView['sections'][number];

interface CandidateRow {
  id: string;
  parent_run_id: string | null;
  accepted_at: string;
  status: Run['status'];
}

function projection(database: DatabaseSync, runId: string): RunReplayProjection {
  const run = loadRun(database, runId);
  const { manifest, catalog } = loadRunSnapshots(database, run);
  assertCompactionJournalProjection(database, run.id);
  const withoutHash = {
    run,
    manifest,
    catalog,
    inbox: listRunInbox(database, run.id),
    activations: loadRunActivations(database, run.id),
    journal: loadRunEvents(database, run.id),
    taskList: loadTaskList(database, run.id),
    compactionTransactions: loadCompactionTransactions(database, run.id),
    compactionViews: loadCompactionViews(database, run.id),
    providerContinuation: PROVIDER_CONTINUATION_UNAVAILABLE,
  };
  return Object.freeze({ projectionHash: hashCanonical(withoutHash), ...withoutHash });
}

function resourceState(
  entries: readonly RunResourceEntry[],
  kind: RunResourceKind,
  unknown: boolean,
): 'known' | 'estimated' | 'unknown' {
  if (unknown) return 'unknown';
  return entries.some((entry) => entry.kind === kind && entry.amount.state === 'estimated')
    ? 'estimated'
    : 'known';
}

function countExposure(
  entries: readonly RunResourceEntry[],
  runId: string,
  kind: 'input_tokens' | 'output_tokens',
  value: bigint | null,
): Extract<RunInspectSection, { section: 'resources' }>['inputTokens'] {
  const state = resourceState(entries, kind, value === null);
  if (state === 'unknown') return { state };
  if (value === null || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TargetStorageError('CORRUPT_DATA', `Run ${runId} ${kind} exposure is invalid`);
  }
  return { state, value: Number(value) };
}

function inspectProjection(
  database: DatabaseSync,
  runIdValue: string,
  inputValue: RunInspectInput,
): RunInspectView {
  const runId = parseCanonical(EntityIdSchema, runIdValue);
  const input = RunInspectDefinition.parseInput(inputValue);
  const run = loadRun(database, runId);
  const { manifest, catalog } = loadRunSnapshots(database, run);
  const sections = input.include.map((section): RunInspectSection => {
    switch (section) {
      case 'manifest':
        return {
          section,
          manifestId: run.contextManifestId,
          manifestHash: run.contextManifestHash,
          acceptedSource: run.acceptedSource,
        };
      case 'inputs':
        return manifest.acceptedSource.kind === 'message'
          ? {
              section,
              messageIds: [manifest.acceptedSource.messageId],
              messageHashes: [manifest.acceptedSource.contentHash],
            }
          : { section, messageIds: [], messageHashes: [] };
      case 'selections':
        return { section, refs: manifest.selectedContext };
      case 'attachments':
        return {
          section,
          acceptedAttachmentIds: manifest.attachments.map(
            ({ projectMediaRefId }) => projectMediaRefId,
          ),
        };
      case 'authority_refs':
        return { section, refs: manifest.selectedContext.map(({ ref }) => ref) };
      case 'catalogs':
        return {
          section,
          capabilityCatalogHash: catalog.catalogHash,
          skillCatalogDigest: catalog.skillCatalogDigest,
        };
      case 'permissions': {
        const canWrite = run.permissionMode !== 'read_only';
        return { section, mode: run.permissionMode, canGenerate: canWrite, canWrite };
      }
      case 'resources': {
        const entries = loadRunResourceEntries(database, run.id);
        const exposure = loadRunBudgetExposure(database, run, entries);
        const costState = resourceState(entries, 'cost', exposure.cost === null);
        return {
          section,
          inputTokens: countExposure(entries, run.id, 'input_tokens', exposure.inputTokens),
          outputTokens: countExposure(entries, run.id, 'output_tokens', exposure.outputTokens),
          cost:
            costState === 'unknown' || exposure.cost === null
              ? { state: 'unknown', currency: exposure.costCurrency }
              : {
                  state: costState,
                  value: formatExactDecimal(exposure.cost),
                  currency: exposure.costCurrency,
                },
        };
      }
    }
  });
  return RunInspectDefinition.parseSuccess({ runState: run.status, sections });
}

function recoveryCandidates(database: DatabaseSync, projectIdValue: string): Run[] {
  const projectId = parseCanonical(EntityIdSchema, projectIdValue);
  if (database.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId) === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Project was not found: ${projectId}`);
  }
  const rows = database
    .prepare(
      `SELECT id, parent_run_id, accepted_at, status
       FROM runs WHERE project_id = ?`,
    )
    .all(projectId) as unknown as CandidateRow[];
  const children = new Map<string | null, CandidateRow[]>();
  for (const row of rows) {
    const siblings = children.get(row.parent_run_id) ?? [];
    siblings.push(row);
    children.set(row.parent_run_id, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort(
      (left, right) =>
        left.accepted_at.localeCompare(right.accepted_at) || left.id.localeCompare(right.id),
    );
  }
  const ordered: CandidateRow[] = [];
  const visit = (parentId: string | null) => {
    for (const row of children.get(parentId) ?? []) {
      ordered.push(row);
      visit(row.id);
    }
  };
  visit(null);
  if (ordered.length !== rows.length) {
    throw new TargetStorageError('CORRUPT_DATA', `Project ${projectId} Run lineage is invalid`);
  }
  return ordered
    .filter(({ status }) => status === 'running' || status === 'recovering')
    .map(({ id }) => loadRun(database, id));
}

export interface RunReplayReadModel {
  readonly get: (runId: string) => RunReplayProjection;
  readonly inspect: (runId: string, input: RunInspectInput) => RunInspectView;
  readonly listRecoveryCandidates: (projectId: string) => Run[];
}

export function createRunReplayReadModel(store: TargetStore): RunReplayReadModel {
  const readModel: RunReplayReadModel = {
    get(runId) {
      return projection(getTargetStoreDatabase(store), runId);
    },
    inspect(runId, input) {
      return inspectProjection(getTargetStoreDatabase(store), runId, input);
    },
    listRecoveryCandidates(projectId) {
      return recoveryCandidates(getTargetStoreDatabase(store), projectId);
    },
  };
  return Object.freeze(readModel);
}
