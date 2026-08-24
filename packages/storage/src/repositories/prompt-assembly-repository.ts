import type BetterSqlite3 from 'better-sqlite3';
import type {
  PromptAssemblyAuthor,
  PromptAssemblyInputV1,
  PromptAssemblyOutputV1,
  PromptAssemblyRecord,
} from '@lucid-fin/contracts';
import { col, defineTable } from '@lucid-fin/contracts-parse';

const PromptAssembliesTable = defineTable('prompt_assemblies', {
  id: col<string>('id'),
  canvasId: col<string>('canvas_id'),
  nodeId: col<string>('node_id'),
  nodeUpdatedAt: col<number>('node_updated_at'),
  mediaType: col<string>('media_type'),
  mode: col<string>('mode'),
  purpose: col<string>('purpose'),
  authorityJson: col<string>('authority_json'),
  sourcesJson: col<string>('sources_json'),
  conditioningManifestJson: col<string>('conditioning_manifest_json'),
  providerProfileJson: col<string>('provider_profile_json'),
  hostConstraintsJson: col<string>('host_constraints_json'),
  inputJson: col<string>('input_json'),
  inputHash: col<string>('input_hash'),
  outputJson: col<string | null>('output_json'),
  status: col<string>('status'),
  rowVersion: col<number>('row_version'),
  llmProviderId: col<string | null>('llm_provider_id'),
  llmModel: col<string | null>('llm_model'),
  taskListId: col<string | null>('task_list_id'),
  taskId: col<string | null>('task_id'),
  parentAssemblyId: col<string | null>('parent_assembly_id'),
  sourceAttemptId: col<string | null>('source_attempt_id'),
  sourceAssetHash: col<string | null>('source_asset_hash'),
  sourceEvaluationId: col<string | null>('source_evaluation_id'),
  errorText: col<string | null>('error_text'),
  createdAt: col<number>('created_at'),
  assembledAt: col<number | null>('assembled_at'),
  submittedAt: col<number | null>('submitted_at'),
  terminalAt: col<number | null>('terminal_at'),
  updatedAt: col<number>('updated_at'),
});

const TBL = PromptAssembliesTable.tableName;
const C = PromptAssembliesTable.cols;

type RawRow = Record<string, unknown>;

export interface AssemblePromptAssemblyInput {
  id: string;
  expectedRowVersion: number;
  inputHash: string;
  output: PromptAssemblyOutputV1;
  llmProviderId: string;
  llmModel?: string;
}

export interface PromptAssemblyTransitionInput {
  id: string;
  expectedRowVersion: number;
}

export interface FailPromptAssemblyInput extends PromptAssemblyTransitionInput {
  error: string;
}

export interface CancelPromptAssemblyInput extends PromptAssemblyTransitionInput {
  error?: string;
}

/**
 * Immutable input + monotonic lifecycle for a single Commander prompt assembly.
 * Provider parameters deliberately never live here: they remain host-owned.
 */
export class PromptAssemblyRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  prepare(input: PromptAssemblyInputV1, author: PromptAssemblyAuthor = {}): PromptAssemblyRecord {
    assertInput(input);
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO ${TBL} (
          ${C.id.sqlName}, ${C.canvasId.sqlName}, ${C.nodeId.sqlName}, ${C.nodeUpdatedAt.sqlName},
          ${C.mediaType.sqlName}, ${C.mode.sqlName}, ${C.purpose.sqlName},
          ${C.authorityJson.sqlName}, ${C.sourcesJson.sqlName}, ${C.conditioningManifestJson.sqlName},
          ${C.providerProfileJson.sqlName}, ${C.hostConstraintsJson.sqlName}, ${C.inputJson.sqlName},
          ${C.inputHash.sqlName}, ${C.status.sqlName}, ${C.rowVersion.sqlName},
          ${C.llmProviderId.sqlName}, ${C.llmModel.sqlName}, ${C.taskListId.sqlName},
          ${C.taskId.sqlName}, ${C.parentAssemblyId.sqlName}, ${C.sourceAttemptId.sqlName},
          ${C.sourceAssetHash.sqlName}, ${C.sourceEvaluationId.sqlName},
          ${C.createdAt.sqlName}, ${C.updatedAt.sqlName}
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.assemblyId,
        input.canvasId,
        input.nodeId,
        input.nodeUpdatedAt,
        input.mediaType,
        input.mode,
        input.purpose,
        JSON.stringify(input.authority),
        JSON.stringify(input.sources),
        JSON.stringify(input.conditioningManifest),
        JSON.stringify(input.providerProfile),
        JSON.stringify(input.hostConstraints),
        JSON.stringify(input),
        input.inputHash,
        author.llmProviderId ?? null,
        author.llmModel ?? null,
        author.taskListId ?? null,
        author.taskId ?? null,
        author.parentAssemblyId ?? null,
        author.sourceAttemptId ?? null,
        author.sourceAssetHash ?? null,
        author.sourceEvaluationId ?? null,
        now,
        now,
      );
    return this.require(input.assemblyId);
  }

  get(id: string): PromptAssemblyRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM ${TBL} WHERE ${C.id.sqlName} = ?`).get(id) as
      RawRow | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  listByNode(canvasId: string, nodeId: string, limit = 50): PromptAssemblyRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM ${TBL}
         WHERE ${C.canvasId.sqlName} = ? AND ${C.nodeId.sqlName} = ?
         ORDER BY ${C.createdAt.sqlName} DESC, ${C.id.sqlName} DESC
         LIMIT ?`,
      )
      .all(canvasId, nodeId, normalizeLimit(limit)) as RawRow[];
    return rows.map(rowToRecord);
  }

  assemble(input: AssemblePromptAssemblyInput): PromptAssemblyRecord {
    const current = this.require(input.id);
    if (current.inputHash !== input.inputHash || input.output.inputHash !== input.inputHash) {
      throw new Error(`Prompt assembly input hash mismatch: ${input.id}`);
    }
    if (input.output.version !== 1 || input.output.assemblyId !== input.id) {
      throw new Error(`Prompt assembly output identity mismatch: ${input.id}`);
    }
    if (!input.output.finalPrompt.trim()) {
      throw new Error(`Prompt assembly output requires a final prompt: ${input.id}`);
    }

    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE ${TBL}
         SET ${C.outputJson.sqlName} = ?, ${C.status.sqlName} = 'assembled',
             ${C.llmProviderId.sqlName} = ?, ${C.llmModel.sqlName} = ?,
             ${C.assembledAt.sqlName} = ?, ${C.updatedAt.sqlName} = ?,
             ${C.rowVersion.sqlName} = ${C.rowVersion.sqlName} + 1
         WHERE ${C.id.sqlName} = ? AND ${C.rowVersion.sqlName} = ?
           AND ${C.inputHash.sqlName} = ? AND ${C.status.sqlName} = 'prepared'`,
      )
      .run(
        JSON.stringify(input.output),
        input.llmProviderId,
        input.llmModel ?? null,
        now,
        now,
        input.id,
        input.expectedRowVersion,
        input.inputHash,
      );
    return this.requireChanged(input.id, result.changes, 'assemble');
  }

  markSubmitted(input: PromptAssemblyTransitionInput): PromptAssemblyRecord {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE ${TBL}
         SET ${C.status.sqlName} = 'submitted', ${C.submittedAt.sqlName} = ?,
             ${C.updatedAt.sqlName} = ?, ${C.rowVersion.sqlName} = ${C.rowVersion.sqlName} + 1
         WHERE ${C.id.sqlName} = ? AND ${C.rowVersion.sqlName} = ?
           AND ${C.status.sqlName} = 'assembled'`,
      )
      .run(now, now, input.id, input.expectedRowVersion);
    return this.requireChanged(input.id, result.changes, 'mark submitted');
  }

  markFailed(input: FailPromptAssemblyInput): PromptAssemblyRecord {
    if (!input.error.trim()) throw new Error('Prompt assembly failure requires an error');
    return this.markTerminal('failed', input.id, input.expectedRowVersion, input.error);
  }

  markCancelled(input: CancelPromptAssemblyInput): PromptAssemblyRecord {
    return this.markTerminal('cancelled', input.id, input.expectedRowVersion, input.error);
  }

  private markTerminal(
    status: 'failed' | 'cancelled',
    id: string,
    expectedRowVersion: number,
    error?: string,
  ): PromptAssemblyRecord {
    const now = Date.now();
    const result = this.db
      .prepare(
        `UPDATE ${TBL}
         SET ${C.status.sqlName} = ?, ${C.errorText.sqlName} = ?, ${C.terminalAt.sqlName} = ?,
             ${C.updatedAt.sqlName} = ?, ${C.rowVersion.sqlName} = ${C.rowVersion.sqlName} + 1
         WHERE ${C.id.sqlName} = ? AND ${C.rowVersion.sqlName} = ?
           AND ${C.status.sqlName} IN ('prepared', 'assembled', 'submitted')`,
      )
      .run(status, error?.trim() || null, now, now, id, expectedRowVersion);
    return this.requireChanged(id, result.changes, `mark ${status}`);
  }

  private require(id: string): PromptAssemblyRecord {
    const record = this.get(id);
    if (!record) throw new Error(`Prompt assembly not found: ${id}`);
    return record;
  }

  private requireChanged(id: string, changes: number, action: string): PromptAssemblyRecord {
    if (changes !== 1) throw new Error(`Prompt assembly ${action} CAS failed: ${id}`);
    return this.require(id);
  }
}

function assertInput(input: PromptAssemblyInputV1): void {
  if (
    input.version !== 1 ||
    !input.assemblyId.trim() ||
    !input.canvasId.trim() ||
    !input.nodeId.trim() ||
    !input.inputHash.trim()
  ) {
    throw new Error('Prompt assembly input is missing its immutable identity');
  }
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.min(200, Math.max(1, Math.floor(limit)));
}

function rowToRecord(row: RawRow): PromptAssemblyRecord {
  const input = parseJson<PromptAssemblyInputV1>(row.input_json, 'input');
  const output = row.output_json
    ? parseJson<PromptAssemblyOutputV1>(row.output_json, 'output')
    : undefined;
  const id = requiredString(row.id, 'id');
  const inputHash = requiredString(row.input_hash, 'input_hash');
  if (input.assemblyId !== id || input.inputHash !== inputHash) {
    throw new Error(`Prompt assembly record identity is corrupt: ${id}`);
  }
  if (output && (output.assemblyId !== id || output.inputHash !== inputHash)) {
    throw new Error(`Prompt assembly output identity is corrupt: ${id}`);
  }

  return {
    id,
    canvasId: requiredString(row.canvas_id, 'canvas_id'),
    nodeId: requiredString(row.node_id, 'node_id'),
    nodeUpdatedAt: requiredNumber(row.node_updated_at, 'node_updated_at'),
    mediaType: row.media_type as PromptAssemblyRecord['mediaType'],
    mode: row.mode as PromptAssemblyRecord['mode'],
    purpose: row.purpose as PromptAssemblyRecord['purpose'],
    inputHash,
    input,
    output,
    status: row.status as PromptAssemblyRecord['status'],
    rowVersion: requiredNumber(row.row_version, 'row_version'),
    llmProviderId: optionalString(row.llm_provider_id),
    llmModel: optionalString(row.llm_model),
    taskListId: optionalString(row.task_list_id),
    taskId: optionalString(row.task_id),
    parentAssemblyId: optionalString(row.parent_assembly_id),
    sourceAttemptId: optionalString(row.source_attempt_id),
    sourceAssetHash: optionalString(row.source_asset_hash),
    sourceEvaluationId: optionalString(row.source_evaluation_id),
    error: optionalString(row.error_text),
    createdAt: requiredNumber(row.created_at, 'created_at'),
    assembledAt: optionalNumber(row.assembled_at),
    submittedAt: optionalNumber(row.submitted_at),
    terminalAt: optionalNumber(row.terminal_at),
    updatedAt: requiredNumber(row.updated_at, 'updated_at'),
  };
}

function parseJson<T>(value: unknown, column: string): T {
  if (typeof value !== 'string') throw new Error(`Prompt assembly ${column} is corrupt`);
  return JSON.parse(value) as T;
}

function requiredString(value: unknown, column: string): string {
  if (typeof value !== 'string' || !value) throw new Error(`Prompt assembly ${column} is corrupt`);
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function requiredNumber(value: unknown, column: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Prompt assembly ${column} is corrupt`);
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
