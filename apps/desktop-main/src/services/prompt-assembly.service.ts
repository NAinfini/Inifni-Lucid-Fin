import { createHash, randomUUID } from 'node:crypto';
import type {
  PromptAssemblyInputV1,
  PromptAssemblyOutputV1,
  PromptAssemblyRecord,
  PromptAssemblySource,
} from '@lucid-fin/contracts';
import type { SqliteIndex } from '@lucid-fin/storage';

const MAX_PROMPT_CHARS = 60_000;
const MAX_NEGATIVE_PROMPT_CHARS = 20_000;

export interface PreparePromptAssemblyInput {
  canvasId: string;
  nodeId: string;
  nodeUpdatedAt: number;
  mediaType: PromptAssemblyInputV1['mediaType'];
  mode: PromptAssemblyInputV1['mode'];
  purpose: PromptAssemblyInputV1['purpose'];
  authority: PromptAssemblyInputV1['authority'];
  sources: Array<Omit<PromptAssemblySource, 'sourceHash'>>;
  conditioningManifest: PromptAssemblyInputV1['conditioningManifest'];
  providerProfile: PromptAssemblyInputV1['providerProfile'];
  hostConstraints: PromptAssemblyInputV1['hostConstraints'];
  parentAssemblyId?: string;
  sourceAttemptId?: string;
  sourceAssetHash?: string;
}

export interface PromptAssemblyService {
  prepare(input: PreparePromptAssemblyInput): PromptAssemblyRecord;
  submitCommanderOutput(
    assemblyId: string,
    output: PromptAssemblyOutputV1,
    author: { providerId: string; model?: string },
  ): PromptAssemblyRecord;
  markSubmitted(assemblyId: string): PromptAssemblyRecord;
  markFailed(assemblyId: string, error: string): PromptAssemblyRecord;
  get(assemblyId: string): PromptAssemblyRecord | undefined;
  listByNode(canvasId: string, nodeId: string, limit?: number): PromptAssemblyRecord[];
}

export function createPromptAssemblyService(deps: { db: SqliteIndex }): PromptAssemblyService {
  const repository = deps.db.repos.promptAssemblies;

  const prepare = (draft: PreparePromptAssemblyInput): PromptAssemblyRecord => {
    const assemblyId = randomUUID();
    const sources = draft.sources.map((source) => ({
      ...source,
      sourceHash: hashCanonical({
        kind: source.kind,
        label: source.label,
        content: source.content,
        required: source.required,
        metadata: source.metadata,
      }),
    }));
    const inputWithoutHash: Omit<PromptAssemblyInputV1, 'inputHash'> = {
      version: 1,
      assemblyId,
      canvasId: draft.canvasId,
      nodeId: draft.nodeId,
      nodeUpdatedAt: draft.nodeUpdatedAt,
      mediaType: draft.mediaType,
      mode: draft.mode,
      purpose: draft.purpose,
      authority: draft.authority,
      sources,
      conditioningManifest: draft.conditioningManifest,
      providerProfile: draft.providerProfile,
      hostConstraints: draft.hostConstraints,
    };
    const input: PromptAssemblyInputV1 = {
      ...inputWithoutHash,
      inputHash: hashPromptAssemblyInput(inputWithoutHash),
    };
    return repository.prepare(input, {
      ...(draft.parentAssemblyId ? { parentAssemblyId: draft.parentAssemblyId } : {}),
      ...(draft.sourceAttemptId ? { sourceAttemptId: draft.sourceAttemptId } : {}),
      ...(draft.sourceAssetHash ? { sourceAssetHash: draft.sourceAssetHash } : {}),
      ...(draft.authority.kind !== 'canvas-draft'
        ? {
            taskListId: draft.authority.taskListId,
            taskId: draft.authority.taskId,
          }
        : {}),
    });
  };

  const submitCommanderOutput = (
    assemblyId: string,
    output: PromptAssemblyOutputV1,
    author: { providerId: string; model?: string },
  ): PromptAssemblyRecord => {
    const record = requirePreparedRecord(repository.get(assemblyId), assemblyId);
    validatePromptAssemblyOutput(record.input, output);
    return repository.assemble({
      id: record.id,
      expectedRowVersion: record.rowVersion,
      inputHash: record.inputHash,
      output: normalizeOutput(output),
      llmProviderId: author.providerId,
      ...(author.model ? { llmModel: author.model } : {}),
    });
  };

  return {
    prepare,
    submitCommanderOutput,
    markSubmitted(assemblyId) {
      const record = repository.get(assemblyId);
      if (!record) throw new Error(`Prompt Assembly not found: ${assemblyId}`);
      if (record.status === 'submitted') return record;
      if (record.status !== 'assembled') {
        throw new Error(`Prompt Assembly ${assemblyId} cannot be submitted from ${record.status}`);
      }
      return repository.markSubmitted({
        id: record.id,
        expectedRowVersion: record.rowVersion,
      });
    },
    markFailed(assemblyId, error) {
      const record = repository.get(assemblyId);
      if (!record) throw new Error(`Prompt Assembly not found: ${assemblyId}`);
      if (record.status === 'failed') return record;
      if (record.status === 'cancelled') return record;
      return repository.markFailed({
        id: record.id,
        expectedRowVersion: record.rowVersion,
        error,
      });
    },
    get: (assemblyId) => repository.get(assemblyId),
    listByNode: (canvasId, nodeId, limit) => repository.listByNode(canvasId, nodeId, limit),
  };
}

export function hashPromptAssemblyInput(input: Omit<PromptAssemblyInputV1, 'inputHash'>): string {
  const { assemblyId: _assemblyId, ...stable } = input;
  return hashCanonical(stable);
}

export function validatePromptAssemblyOutput(
  input: PromptAssemblyInputV1,
  output: PromptAssemblyOutputV1,
): void {
  if (output.version !== 1) throw new Error('Unsupported Prompt Assembly output version');
  if (output.assemblyId !== input.assemblyId) throw new Error('Prompt Assembly ID is stale');
  if (output.inputHash !== input.inputHash) throw new Error('Prompt Assembly input hash is stale');
  if (typeof output.finalPrompt !== 'string' || !output.finalPrompt.trim()) {
    throw new Error('Commander Prompt Assembly returned an empty final prompt');
  }
  if (output.finalPrompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`Commander final prompt exceeds ${MAX_PROMPT_CHARS} characters`);
  }
  if (
    output.negativePrompt !== undefined &&
    (typeof output.negativePrompt !== 'string' ||
      output.negativePrompt.length > MAX_NEGATIVE_PROMPT_CHARS)
  ) {
    throw new Error(`Commander negative prompt exceeds ${MAX_NEGATIVE_PROMPT_CHARS} characters`);
  }
  if (!Array.isArray(output.sourceDecisions)) {
    throw new Error('Commander Prompt Assembly omitted source decisions');
  }
  const expected = new Map(input.sources.map((source) => [source.sourceId, source]));
  const seen = new Set<string>();
  for (const decision of output.sourceDecisions) {
    if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
      throw new Error('Commander returned an invalid source decision');
    }
    if (typeof decision.sourceId !== 'string' || typeof decision.sourceHash !== 'string') {
      throw new Error('Commander source decisions require string IDs and hashes');
    }
    if (decision.reason !== undefined && typeof decision.reason !== 'string') {
      throw new Error(`Commander returned an invalid reason for "${decision.sourceId}"`);
    }
    const source = expected.get(decision.sourceId);
    if (!source) throw new Error(`Commander referenced unknown source "${decision.sourceId}"`);
    if (seen.has(decision.sourceId)) {
      throw new Error(`Commander returned duplicate source decision "${decision.sourceId}"`);
    }
    seen.add(decision.sourceId);
    if (decision.sourceHash !== source.sourceHash) {
      throw new Error(`Commander source hash is stale for "${decision.sourceId}"`);
    }
    if (!['applied', 'omitted', 'conflict-resolved'].includes(decision.disposition)) {
      throw new Error(`Commander returned an invalid disposition for "${decision.sourceId}"`);
    }
    if (source.required && decision.disposition === 'omitted') {
      throw new Error(`Commander omitted required source "${decision.sourceId}"`);
    }
  }
  for (const source of input.sources) {
    if (!seen.has(source.sourceId)) {
      throw new Error(`Commander did not account for source "${source.sourceId}"`);
    }
  }
  if (typeof output.summary !== 'string' || !output.summary.trim()) {
    throw new Error('Commander Prompt Assembly summary must be non-empty text');
  }
  if (
    !Array.isArray(output.warnings) ||
    output.warnings.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error('Commander Prompt Assembly warnings must be a string array');
  }
}

function normalizeOutput(output: PromptAssemblyOutputV1): PromptAssemblyOutputV1 {
  const { negativePrompt: _negativePrompt, ...base } = output;
  return {
    ...base,
    // These are the provider payload and immutable lineage. Validate them, but
    // never rewrite even whitespace after Commander has authored the revision.
    finalPrompt: output.finalPrompt,
    ...(output.negativePrompt !== undefined ? { negativePrompt: output.negativePrompt } : {}),
    sourceDecisions: output.sourceDecisions.map((decision) => ({
      ...decision,
      ...(decision.reason?.trim() ? { reason: decision.reason.trim() } : {}),
    })),
    summary: output.summary.trim(),
    warnings: output.warnings.map((warning) => warning.trim()).filter(Boolean),
  };
}

function requirePreparedRecord(
  record: PromptAssemblyRecord | undefined,
  assemblyId: string,
): PromptAssemblyRecord {
  if (!record) throw new Error(`Prompt Assembly not found: ${assemblyId}`);
  if (record.status !== 'prepared') {
    throw new Error(`Prompt Assembly ${assemblyId} is already ${record.status}`);
  }
  return record;
}

function hashCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}
