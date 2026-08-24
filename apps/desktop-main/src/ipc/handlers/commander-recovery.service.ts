import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  CommanderStartRequest,
  PublicContextFact,
  TimelineEvent,
  ToolRef,
} from '@lucid-fin/contracts';
import {
  CommanderStreamPayloadSchema,
  commanderStartChannel,
} from '@lucid-fin/contracts-parse';
import {
  parseRunResourceBudgetCheckpoint,
  RunResourceBudgetController,
} from '@lucid-fin/application';
import type {
  HistoryEntry,
  RunResourceBudgetCheckpoint,
  StampedStreamEvent,
  ToolRegistry,
} from '@lucid-fin/application';
import type {
  StoredCommanderRun,
  StoredCommanderRunRecoveryEvent,
} from '@lucid-fin/storage';

const HASH = /^[a-f0-9]{64}$/;
const MAX_RECOVERY_PLAINTEXT_BYTES = 1_000_000;
const MAX_RECOVERY_CIPHERTEXT_BYTES = 4_000_000;
const ACTIVE_STATUSES = new Set<StoredCommanderRun['status']>(['accepted', 'running', 'paused']);
const nonempty = z.string().min(1);
const hash = z.string().regex(HASH);
const safeCount = z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

const canonicalJsonSchema: z.ZodType<CanonicalJsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite(),
  z.string(),
  z.array(canonicalJsonSchema),
  z.record(z.string(), canonicalJsonSchema),
]));
const canonicalJsonObjectSchema = z.record(z.string(), canonicalJsonSchema);
const resourceAmountSchema = z.discriminatedUnion('knowledge', [
  z.object({ knowledge: z.literal('known'), value: z.number().finite().nonnegative() }).strict(),
  z.object({ knowledge: z.literal('estimated'), value: z.number().finite().nonnegative() }).strict(),
  z.object({ knowledge: z.literal('unknown') }).strict(),
]);
const resourceUsageSchema = z.object({
  tokens: resourceAmountSchema,
  toolCalls: safeCount,
  wallTimeMs: z.number().finite().nonnegative(),
  costUsd: resourceAmountSchema,
}).strict();
const authorityRefSchema = z.object({
  kind: z.literal('authority_ref'),
  authority: z.enum([
    'commander_run', 'canvas', 'canvas_node', 'asset_entry', 'character', 'equipment',
    'location', 'script', 'preset', 'shot_template', 'snapshot', 'color_style',
    'run_checklist', 'task_list', 'prompt_assembly', 'cas',
  ]),
  relation: z.enum([
    'run_scope', 'selected_input', 'attachment', 'bound_input', 'retry_source',
    'read', 'created', 'updated', 'deleted', 'produced',
  ]),
  id: z.string().min(1).max(256),
  scopeId: z.string().min(1).max(256).optional(),
  revision: safeCount.optional(),
  contentHash: z.string().min(1).max(256).optional(),
}).strict();
const modelToolCallSchema = z.object({
  id: nonempty,
  name: nonempty,
  arguments: canonicalJsonObjectSchema,
  thoughtSignature: nonempty.optional(),
}).strict();
const catalogSchemaHashesSchema = z.record(
  nonempty,
  z.object({ inputSchemaHash: hash, outputSchemaHash: hash }).strict(),
);
const workTypeSchema = z.enum(['agent', 'subagent', 'tool_program']);
const effectSchema = z.enum(['query', 'mutation', 'metered', 'tool_program']);
const finishReasonSchema = z.enum(['stop', 'tool_calls', 'length', 'error']);
const common = {
  schemaVersion: z.literal(1),
  runId: nonempty,
  seq: safeCount,
  eventKind: nonempty,
  previousHash: hash.nullable(),
  publicEventHash: hash,
  chainHash: hash,
};
const payloadSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('boundary') }).strict(),
  z.object({
    ...common,
    kind: z.literal('run_seed'),
    workType: workTypeSchema,
    startRequest: commanderStartChannel.schemas.request,
    modelInput: nonempty,
    carryIn: resourceUsageSchema.optional(),
    delegationContextRefs: z.array(authorityRefSchema).max(128).optional(),
  }).strict(),
  z.object({ ...common, kind: z.literal('inbox'), content: z.string() }).strict(),
  z.object({
    ...common,
    kind: z.literal('catalog'),
    catalogHash: hash,
    toolSchemaHashes: catalogSchemaHashesSchema,
  }).strict(),
  z.object({
    ...common,
    kind: z.literal('tool_call'),
    toolCallId: nonempty,
    toolName: nonempty,
    args: canonicalJsonObjectSchema,
    effect: effectSchema,
  }).strict(),
  z.object({
    ...common,
    kind: z.literal('tool_result'),
    toolCallId: nonempty,
    result: canonicalJsonSchema,
  }).strict(),
  z.object({
    ...common,
    kind: z.literal('model_checkpoint'),
    content: z.string(),
    finishReason: finishReasonSchema,
    toolCalls: z.array(modelToolCallSchema).max(1_000),
    completedStep: safeCount,
  }).strict(),
  z.object({
    ...common,
    kind: z.literal('resource_checkpoint'),
    checkpoint: z.unknown(),
  }).strict(),
]);

type RecoveryCommon = {
  schemaVersion: 1;
  runId: string;
  seq: number;
  eventKind: string;
  previousHash: string | null;
  publicEventHash: string;
  chainHash: string;
};
type AuthorityRef = Extract<PublicContextFact, { kind: 'authority_ref' }>;
export type CommanderRecoverySeed = {
  kind: 'run_seed';
  workType: StoredCommanderRun['workType'];
  startRequest: CommanderStartRequest;
  modelInput: string;
  carryIn?: Extract<TimelineEvent, { kind: 'resource_state' }>['usage'];
  delegationContextRefs?: AuthorityRef[];
};
export type CommanderCatalogRecoveryRecord = {
  kind: 'catalog';
  catalogHash: string;
  toolSchemaHashes: Record<string, { inputSchemaHash: string; outputSchemaHash: string }>;
};
export type CommanderModelCheckpoint = {
  kind: 'model_checkpoint';
  content: string;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, CanonicalJsonValue>;
    thoughtSignature?: string;
  }>;
  completedStep: number;
};
export type CommanderResourceCheckpoint = {
  kind: 'resource_checkpoint';
  checkpoint: RunResourceBudgetCheckpoint;
};

export type CommanderRecoveryRecord =
  | { kind: 'boundary' }
  | CommanderRecoverySeed
  | { kind: 'inbox'; content: string }
  | CommanderCatalogRecoveryRecord
  | {
      kind: 'tool_call';
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      effect: 'query' | 'mutation' | 'metered' | 'tool_program';
    }
  | { kind: 'tool_result'; toolCallId: string; result: CanonicalJsonValue }
  | CommanderModelCheckpoint
  | CommanderResourceCheckpoint;

export type CommanderRecoveryPayloadV1 = RecoveryCommon & CommanderRecoveryRecord;

export interface CommanderRecoveryCodec {
  assertAvailable(): void;
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}

interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?(): string;
  encryptString(plaintext: string): Buffer;
  decryptString(ciphertext: Buffer): string;
}

export type CommanderRecoverySupplement =
  | { kind: 'tool_result'; result: CanonicalJsonValue }
  | CommanderModelCheckpoint
  | CommanderResourceCheckpoint;

export interface CommanderRecoveryDedupSeed {
  toolRef: ToolRef;
  args: Record<string, unknown>;
  toolCallId: string;
  step: number;
  wasError: boolean;
}

type TerminalRunStatus = Exclude<StoredCommanderRun['status'], 'accepted' | 'running' | 'paused'>;
type CommanderRecoveryRun = Omit<StoredCommanderRun, 'sessionId'> & { sessionId: string };
export type CommanderRecoveryDecision =
  | {
      state: 'resumable';
      runId: string;
      catalogHash: string;
      catalog: CommanderCatalogRecoveryRecord;
      seed: CommanderRecoverySeed;
      history: HistoryEntry[];
      completedSteps: number[];
      dedupSeeds: CommanderRecoveryDedupSeed[];
      resourceState?: Extract<TimelineEvent, { kind: 'resource_state' }>;
      resourceCheckpoint?: RunResourceBudgetCheckpoint;
      lastSeq: number;
      recoveryHead: string;
    }
  | { state: 'terminal'; runId: string; status: TerminalRunStatus }
  | { state: 'legacy_interrupted'; runId: string; reason: 'private_payload_missing' }
  | {
      state: 'recovery_required';
      runId: string;
      reason: string;
      orphanToolCallId?: string;
      recoveryHead?: string;
    };

export function createSafeStorageCommanderRecoveryCodec(
  safeStorage: SafeStorageLike | undefined,
): CommanderRecoveryCodec {
  const assertAvailable = (): void => {
    let available = false;
    let backend: string | undefined;
    try {
      available = safeStorage?.isEncryptionAvailable() === true;
      backend = safeStorage?.getSelectedStorageBackend?.();
    } catch {
      available = false;
    }
    if (!available || backend === 'basic_text') {
      throw new Error('Commander recovery encryption is unavailable');
    }
  };

  return {
    assertAvailable,
    encrypt(plaintext) {
      assertAvailable();
      const encrypted = safeStorage!.encryptString(plaintext);
      if (
        !Buffer.isBuffer(encrypted) ||
        encrypted.length === 0 ||
        encrypted.equals(Buffer.from(plaintext, 'utf8'))
      ) {
        throw new Error('Commander recovery encryption is unavailable');
      }
      return Buffer.from(encrypted);
    },
    decrypt(ciphertext) {
      assertAvailable();
      return safeStorage!.decryptString(Buffer.from(ciphertext));
    },
  };
}

export function parseCommanderRecoveryPayloadV1(value: unknown): CommanderRecoveryPayloadV1 {
  const parsed = payloadSchema.parse(value);
  const payload = (
    parsed.kind === 'resource_checkpoint'
      ? { ...parsed, checkpoint: parseRunResourceBudgetCheckpoint(parsed.checkpoint) }
      : parsed
  ) as CommanderRecoveryPayloadV1;
  const { chainHash, ...core } = payload;
  if (Buffer.byteLength(stableStringify(payload), 'utf8') > MAX_RECOVERY_PLAINTEXT_BYTES) {
    throw new Error('Commander recovery payload exceeds the size limit');
  }
  if (digest(core) !== chainHash) {
    throw new Error('Commander recovery payload chain hash is invalid');
  }
  return payload;
}

export function openCommanderRecoveryPayload(
  codec: CommanderRecoveryCodec,
  privatePayload: Buffer,
): CommanderRecoveryPayloadV1 {
  codec.assertAvailable();
  if (privatePayload.length > MAX_RECOVERY_CIPHERTEXT_BYTES) {
    throw new Error('Commander recovery payload exceeds the size limit');
  }
  let value: unknown;
  try {
    const plaintext = codec.decrypt(privatePayload);
    if (Buffer.byteLength(plaintext, 'utf8') > MAX_RECOVERY_PLAINTEXT_BYTES) {
      throw new Error('Commander recovery payload exceeds the size limit');
    }
    value = JSON.parse(plaintext);
  } catch (error) {
    throw new Error('Commander recovery payload cannot be decrypted', { cause: error });
  }
  return parseCommanderRecoveryPayloadV1(value);
}

export function sealCommanderRecoveryBatch(
  codec: CommanderRecoveryCodec,
  previousHash: string | null,
  entries: readonly { event: TimelineEvent; record: CommanderRecoveryRecord }[],
): { privatePayloads: Buffer[]; head: string | null } {
  codec.assertAvailable();
  if (previousHash !== null && !HASH.test(previousHash)) {
    throw new Error('Commander recovery chain head is invalid');
  }
  let head = previousHash;
  const privatePayloads = entries.map(({ event, record }) => {
    validateRecordBinding(event, record, head);
    const core = {
      schemaVersion: 1 as const,
      ...record,
      runId: event.runId,
      seq: event.seq,
      eventKind: event.kind,
      previousHash: head,
      publicEventHash: digest(event),
    };
    const payload = parseCommanderRecoveryPayloadV1({ ...core, chainHash: digest(core) });
    const plaintext = stableStringify(payload);
    if (Buffer.byteLength(plaintext, 'utf8') > MAX_RECOVERY_PLAINTEXT_BYTES) {
      throw new Error('Commander recovery payload exceeds the size limit');
    }
    const encrypted = codec.encrypt(plaintext);
    if (encrypted.length > MAX_RECOVERY_CIPHERTEXT_BYTES) {
      throw new Error('Commander recovery payload exceeds the size limit');
    }
    head = payload.chainHash;
    return encrypted;
  });
  return { privatePayloads, head };
}

export function deriveCommanderRecoveryRecord(
  internalEvent: StampedStreamEvent,
  publicEvent: TimelineEvent,
  tools: Pick<ToolRegistry, 'get'>,
  supplement?: CommanderRecoverySupplement,
): CommanderRecoveryRecord {
  if (supplement?.kind === 'resource_checkpoint') {
    if (publicEvent.kind !== 'resource_state') {
      throw new Error('resource_checkpoint recovery data requires a resource_state event');
    }
    return supplement;
  }
  if (supplement?.kind === 'tool_result') {
    if (internalEvent.kind !== 'tool_result') {
      throw new Error('tool_result recovery data requires a tool_result event');
    }
    return { kind: 'tool_result', toolCallId: internalEvent.toolCallId, result: supplement.result };
  }
  if (supplement?.kind === 'model_checkpoint') return supplement;
  if (publicEvent.kind === 'user_message') return { kind: 'inbox', content: publicEvent.content };
  if (publicEvent.kind === 'catalog_frozen') return createCommanderCatalogRecoveryRecord(publicEvent);
  if (internalEvent.kind === 'tool_call') {
    const name = `${internalEvent.toolRef.domain}.${internalEvent.toolRef.action}`;
    const tool = tools.get(name);
    const toolEffect: Extract<CommanderRecoveryRecord, { kind: 'tool_call' }>['effect'] =
      name === 'tool.program'
        ? 'tool_program'
        : tool?.resource.kind === 'metered'
          ? 'metered'
          : tool?.category === 'query'
            ? 'query'
            : 'mutation';
    return {
      kind: 'tool_call',
      toolCallId: internalEvent.toolCallId,
      toolName: name,
      args: internalEvent.args,
      effect: toolEffect,
    };
  }
  return { kind: 'boundary' };
}

export function createCommanderCatalogRecoveryRecord(
  event: Extract<TimelineEvent, { kind: 'catalog_frozen' }>,
): CommanderCatalogRecoveryRecord {
  if (!HASH.test(event.catalogHash)) {
    throw new Error('Commander recovery catalog hash is missing or invalid');
  }
  const toolSchemaHashes: CommanderCatalogRecoveryRecord['toolSchemaHashes'] = {};
  for (const tool of event.tools) {
    if (
      !tool.name ||
      Object.hasOwn(toolSchemaHashes, tool.name) ||
      !HASH.test(tool.inputSchemaHash) ||
      typeof tool.outputSchemaHash !== 'string' ||
      !HASH.test(tool.outputSchemaHash)
    ) {
      throw new Error(`Commander recovery catalog is missing a schema hash for ${tool.name}`);
    }
    toolSchemaHashes[tool.name] = {
      inputSchemaHash: tool.inputSchemaHash,
      outputSchemaHash: tool.outputSchemaHash,
    };
  }
  return { kind: 'catalog', catalogHash: event.catalogHash, toolSchemaHashes };
}

export function projectCommanderRecovery(
  run: CommanderRecoveryRun,
  rows: readonly StoredCommanderRunRecoveryEvent[],
  codec: CommanderRecoveryCodec,
  currentCatalog: CommanderCatalogRecoveryRecord,
): CommanderRecoveryDecision {
  let verifiedRecoveryHead: string | undefined;
  const required = (
    reason: string,
    orphanToolCallId?: string,
  ): CommanderRecoveryDecision => ({
    state: 'recovery_required',
    runId: run.id,
    reason,
    ...(orphanToolCallId ? { orphanToolCallId } : {}),
    ...(verifiedRecoveryHead ? { recoveryHead: verifiedRecoveryHead } : {}),
  });
  if (!ACTIVE_STATUSES.has(run.status)) {
    return { state: 'terminal', runId: run.id, status: run.status as TerminalRunStatus };
  }
  if (run.workType === 'tool_program') return required('tool_program_interrupted');
  if (
    rows.length !== run.lastSeq + 1 ||
    rows.some((row, index) => row.runId !== run.id || row.seq !== index)
  ) {
    return required('public_event_sequence_invalid');
  }
  if (rows.length > 0 && rows.every((row) => row.privatePayload === null)) {
    return { state: 'legacy_interrupted', runId: run.id, reason: 'private_payload_missing' };
  }
  if (rows.some((row) => row.privatePayload === null)) {
    return required('private_payload_chain_incomplete');
  }

  type CallRecord = {
    event: Extract<TimelineEvent, { kind: 'tool_call' }>;
    record: Extract<CommanderRecoveryPayloadV1, { kind: 'tool_call' }>;
  };
  type ResultRecord = {
    event: Extract<TimelineEvent, { kind: 'tool_result' }>;
    record: Extract<CommanderRecoveryPayloadV1, { kind: 'tool_result' }>;
  };
  type CheckpointRecord = {
    seq: number;
    record: Extract<CommanderRecoveryPayloadV1, { kind: 'model_checkpoint' }>;
  };
  let previousHash: string | null = null;
  let seedRecord: CommanderRecoverySeed | undefined;
  let storedCatalog: CommanderCatalogRecoveryRecord | undefined;
  let resourceState: Extract<TimelineEvent, { kind: 'resource_state' }> | undefined;
  let resourceCheckpoint: RunResourceBudgetCheckpoint | undefined;
  const inbox: Array<{ seq: number; step: number; content: string }> = [];
  const calls = new Map<string, CallRecord>();
  const results = new Map<string, ResultRecord>();
  const checkpoints: CheckpointRecord[] = [];

  for (const row of rows) {
    let publicEvent: TimelineEvent;
    try {
      publicEvent = CommanderStreamPayloadSchema.shape.event.parse(
        JSON.parse(row.payload),
      ) as TimelineEvent;
    } catch {
      return required('public_event_invalid');
    }
    let privateEvent: CommanderRecoveryPayloadV1;
    try {
      privateEvent = openCommanderRecoveryPayload(codec, row.privatePayload!);
    } catch {
      return required('private_payload_invalid');
    }
    if (
      publicEvent.runId !== run.id ||
      publicEvent.seq !== row.seq ||
      publicEvent.kind !== row.kind ||
      publicEvent.step !== row.step ||
      publicEvent.emittedAt !== row.emittedAt ||
      privateEvent.runId !== run.id ||
      privateEvent.seq !== row.seq ||
      privateEvent.eventKind !== row.kind ||
      privateEvent.previousHash !== previousHash ||
      privateEvent.publicEventHash !== digest(publicEvent)
    ) {
      return required('private_payload_binding_invalid');
    }
    previousHash = privateEvent.chainHash;
    if (publicEvent.kind === 'resource_state') resourceState = publicEvent;
    if (publicEvent.kind === 'resource_state' && privateEvent.kind !== 'resource_checkpoint') {
      return required('resource_checkpoint_private_payload_missing');
    }

    switch (privateEvent.kind) {
      case 'run_seed': {
        if (
          seedRecord ||
          row.seq !== 0 ||
          publicEvent.kind !== 'run_start' ||
          !validSeedBinding(run, publicEvent, privateEvent)
        ) {
          return required('run_seed_invalid');
        }
        seedRecord = recoverySeed(privateEvent);
        break;
      }
      case 'inbox':
        if (publicEvent.kind !== 'user_message' || privateEvent.content !== publicEvent.content) {
          return required('inbox_binding_invalid');
        }
        inbox.push({ seq: row.seq, step: row.step, content: privateEvent.content });
        break;
      case 'catalog': {
        if (publicEvent.kind !== 'catalog_frozen' || storedCatalog) {
          return required('catalog_binding_invalid');
        }
        let publicCatalog: CommanderCatalogRecoveryRecord;
        try {
          publicCatalog = createCommanderCatalogRecoveryRecord(publicEvent);
        } catch {
          return required('catalog_schema_hash_missing');
        }
        const privateCatalog = recoveryCatalog(privateEvent);
        if (stableStringify(privateCatalog) !== stableStringify(publicCatalog)) {
          return required('catalog_schema_hash_mismatch');
        }
        storedCatalog = privateCatalog;
        break;
      }
      case 'tool_call':
        if (
          publicEvent.kind !== 'tool_call' ||
          privateEvent.toolCallId !== publicEvent.toolCallId ||
          privateEvent.toolName !== `${publicEvent.toolRef.domain}.${publicEvent.toolRef.action}` ||
          calls.has(privateEvent.toolCallId)
        ) {
          return required('tool_call_binding_invalid');
        }
        calls.set(privateEvent.toolCallId, { event: publicEvent, record: privateEvent });
        break;
      case 'tool_result': {
        if (
          publicEvent.kind !== 'tool_result' ||
          privateEvent.toolCallId !== publicEvent.toolCallId ||
          results.has(privateEvent.toolCallId)
        ) {
          return required('tool_result_binding_invalid');
        }
        if (!calls.has(privateEvent.toolCallId)) return required('orphan_tool_result');
        results.set(privateEvent.toolCallId, { event: publicEvent, record: privateEvent });
        break;
      }
      case 'model_checkpoint':
        if (
          publicEvent.kind !== 'public_progress' ||
          publicEvent.status !== 'completed' ||
          publicEvent.operationId !== `model:${privateEvent.completedStep}` ||
          publicEvent.step !== privateEvent.completedStep ||
          checkpoints.some(({ record }) => record.completedStep === privateEvent.completedStep)
        ) {
          return required('model_checkpoint_binding_invalid');
        }
        checkpoints.push({ seq: row.seq, record: privateEvent });
        break;
      case 'resource_checkpoint': {
        if (publicEvent.kind !== 'resource_state') {
          return required('resource_checkpoint_binding_invalid');
        }
        try {
          const checkpoint = parseRunResourceBudgetCheckpoint(privateEvent.checkpoint);
          const controller = RunResourceBudgetController.restoreCheckpoint(checkpoint, {
            now: () => 0,
          }).controllers.get(run.id);
          if (!controller) return required('resource_checkpoint_run_controller_missing');
          const snapshot = controller.snapshot(publicEvent.cause);
          if (
            stableStringify(snapshot.usage) !== stableStringify(publicEvent.usage) ||
            stableStringify(snapshot.remaining) !== stableStringify(publicEvent.remaining) ||
            snapshot.clock.state !== publicEvent.clock.state ||
            snapshot.clock.activeMs !== publicEvent.clock.activeMs
          ) {
            return required('resource_checkpoint_public_state_mismatch');
          }
          resourceCheckpoint = checkpoint;
        } catch {
          return required('resource_checkpoint_invalid');
        }
        break;
      }
      case 'boundary':
        if (publicEvent.kind === 'tool_call') return required('tool_call_private_payload_missing');
        if (publicEvent.kind === 'tool_result') {
          return required('tool_result_private_payload_missing', publicEvent.toolCallId);
        }
        if (
          publicEvent.kind === 'public_progress' &&
          publicEvent.status === 'completed' &&
          publicEvent.operationId.startsWith('model:')
        ) {
          return required('model_checkpoint_private_payload_missing');
        }
        break;
    }
  }
  verifiedRecoveryHead = previousHash ?? undefined;

  if (!seedRecord) return required('run_seed_missing_or_duplicate');
  if (!storedCatalog) return required('catalog_missing');
  let parsedCurrentCatalog: CommanderCatalogRecoveryRecord;
  try {
    parsedCurrentCatalog = {
      kind: 'catalog',
      catalogHash: hash.parse(currentCatalog.catalogHash),
      toolSchemaHashes: catalogSchemaHashesSchema.parse(currentCatalog.toolSchemaHashes),
    };
  } catch {
    return required('catalog_drift');
  }
  if (stableStringify(storedCatalog) !== stableStringify(parsedCurrentCatalog)) {
    return required('catalog_drift');
  }
  for (const [toolCallId] of calls) {
    if (!results.has(toolCallId)) return required('orphan_tool_call', toolCallId);
  }

  checkpoints.sort((left, right) => left.record.completedStep - right.record.completedStep);
  for (let index = 0; index < checkpoints.length; index += 1) {
    const checkpoint = checkpoints[index]!;
    if (
      index > 0 &&
      checkpoint.record.completedStep <= checkpoints[index - 1]!.record.completedStep
    ) {
      return required('model_checkpoint_sequence_invalid');
    }
    const seen = new Set<string>();
    for (const modelCall of checkpoint.record.toolCalls) {
      if (seen.has(modelCall.id)) return required('model_checkpoint_tool_call_duplicate', modelCall.id);
      seen.add(modelCall.id);
      const call = calls.get(modelCall.id);
      if (!call || !results.has(modelCall.id)) {
        return required('model_checkpoint_tool_call_missing', modelCall.id);
      }
      if (
        call.event.step !== checkpoint.record.completedStep ||
        call.record.toolName !== modelCall.name ||
        stableStringify(call.record.args) !== stableStringify(modelCall.arguments)
      ) {
        return required('model_checkpoint_tool_call_mismatch', modelCall.id);
      }
    }
  }
  const checkpointCallIds = new Set(
    checkpoints.flatMap(({ record }) => record.toolCalls.map(({ id }) => id)),
  );
  for (const toolCallId of calls.keys()) {
    if (!checkpointCallIds.has(toolCallId)) {
      return required('tool_call_checkpoint_missing', toolCallId);
    }
  }

  const history = buildHistory(seedRecord, inbox, checkpoints, calls, results);
  const dedupSeeds: CommanderRecoveryDedupSeed[] = [];
  for (const [toolCallId, call] of calls) {
    const result = results.get(toolCallId)!;
    if (result.event.status === 'skipped') continue;
    dedupSeeds.push({
      toolRef: call.event.toolRef,
      args: call.record.args,
      toolCallId,
      step: call.event.step,
      wasError: result.event.status === 'failed',
    });
  }
  return {
    state: 'resumable',
    runId: run.id,
    catalogHash: storedCatalog.catalogHash,
    catalog: storedCatalog,
    seed: seedRecord,
    history,
    completedSteps: checkpoints.map(({ record }) => record.completedStep),
    dedupSeeds,
    ...(resourceState ? { resourceState } : {}),
    ...(resourceCheckpoint ? { resourceCheckpoint } : {}),
    lastSeq: run.lastSeq,
    recoveryHead: previousHash!,
  };
}

/** Reads retry input only from a fully verified private event chain. */
export function readVerifiedCommanderRecoverySeed(
  run: CommanderRecoveryRun,
  rows: readonly StoredCommanderRunRecoveryEvent[],
  codec: CommanderRecoveryCodec,
): CommanderRecoverySeed {
  if (
    rows.length !== run.lastSeq + 1 ||
    rows.some((row, index) => row.runId !== run.id || row.seq !== index || !row.privatePayload)
  ) {
    throw new Error('Commander retry source recovery chain is incomplete');
  }
  let previousHash: string | null = null;
  let seed: CommanderRecoverySeed | undefined;
  for (const row of rows) {
    const publicEvent = CommanderStreamPayloadSchema.shape.event.parse(
      JSON.parse(row.payload),
    ) as TimelineEvent;
    const privateEvent = openCommanderRecoveryPayload(codec, row.privatePayload!);
    if (
      publicEvent.runId !== run.id ||
      publicEvent.seq !== row.seq ||
      publicEvent.kind !== row.kind ||
      publicEvent.step !== row.step ||
      publicEvent.emittedAt !== row.emittedAt ||
      privateEvent.runId !== run.id ||
      privateEvent.seq !== row.seq ||
      privateEvent.eventKind !== row.kind ||
      privateEvent.previousHash !== previousHash ||
      privateEvent.publicEventHash !== digest(publicEvent)
    ) {
      throw new Error('Commander retry source recovery chain is invalid');
    }
    validateRecordBinding(publicEvent, privateEvent, previousHash);
    previousHash = privateEvent.chainHash;
    if (privateEvent.kind !== 'run_seed') continue;
    if (
      seed ||
      row.seq !== 0 ||
      publicEvent.kind !== 'run_start' ||
      !validSeedBinding(run, publicEvent, privateEvent)
    ) {
      throw new Error('Commander retry source run seed is invalid');
    }
    seed = recoverySeed(privateEvent);
  }
  if (!seed) throw new Error('Commander retry source run seed is missing');
  return seed;
}

function validSeedBinding(
  run: CommanderRecoveryRun,
  event: Extract<TimelineEvent, { kind: 'run_start' }>,
  seed: Extract<CommanderRecoveryPayloadV1, { kind: 'run_seed' }>,
): boolean {
  const request = seed.startRequest;
  const requestWorkType = request.workType ?? 'agent';
  return (
    seed.workType === run.workType &&
    requestWorkType === run.workType &&
    event.workType === run.workType &&
    request.sessionId === run.sessionId &&
    (request.parentRunId ?? undefined) === (run.parentRunId ?? undefined) &&
    (event.parentRunId ?? undefined) === (run.parentRunId ?? undefined) &&
    (request.defaultCanvasId ?? undefined) === (run.defaultCanvasId ?? undefined) &&
    stableStringify(request.authorizedCanvasIds) === stableStringify(run.authorizedCanvasIds) &&
    stableStringify(request.resourceBudget ?? {}) === stableStringify(event.resourceBudget) &&
    (request.retryOfRunId ?? undefined) === (event.retryOfRunId ?? undefined) &&
    (request.displayName ?? undefined) === (event.displayName ?? undefined) &&
    (request.objective ?? undefined) === (event.objective ?? undefined) &&
    (request.continuationOfRunId ?? undefined) === (event.continuationOfRunId ?? undefined)
  );
}

function recoverySeed(
  payload: Extract<CommanderRecoveryPayloadV1, { kind: 'run_seed' }>,
): CommanderRecoverySeed {
  return {
    kind: 'run_seed',
    workType: payload.workType,
    startRequest: payload.startRequest,
    modelInput: payload.modelInput,
    ...(payload.carryIn ? { carryIn: payload.carryIn } : {}),
    ...(payload.delegationContextRefs
      ? { delegationContextRefs: payload.delegationContextRefs }
      : {}),
  };
}

function recoveryCatalog(
  payload: Extract<CommanderRecoveryPayloadV1, { kind: 'catalog' }>,
): CommanderCatalogRecoveryRecord {
  return {
    kind: 'catalog',
    catalogHash: payload.catalogHash,
    toolSchemaHashes: payload.toolSchemaHashes,
  };
}

function buildHistory(
  seed: CommanderRecoverySeed,
  inbox: readonly { seq: number; step: number; content: string }[],
  checkpoints: readonly {
    seq: number;
    record: Extract<CommanderRecoveryPayloadV1, { kind: 'model_checkpoint' }>;
  }[],
  calls: ReadonlyMap<string, {
    event: Extract<TimelineEvent, { kind: 'tool_call' }>;
    record: Extract<CommanderRecoveryPayloadV1, { kind: 'tool_call' }>;
  }>,
  results: ReadonlyMap<string, {
    event: Extract<TimelineEvent, { kind: 'tool_result' }>;
    record: Extract<CommanderRecoveryPayloadV1, { kind: 'tool_result' }>;
  }>,
): HistoryEntry[] {
  const fragments: Array<{ seq: number; rank: number; entry: HistoryEntry }> = [
    { seq: -1, rank: 0, entry: { role: 'user', content: seed.modelInput } },
  ];
  const firstCheckpointSeq = checkpoints.reduce(
    (earliest, checkpoint) => Math.min(earliest, checkpoint.seq),
    Number.POSITIVE_INFINITY,
  );
  let skippedInitialInput = false;
  for (const message of inbox) {
    const isInitialInput =
      !skippedInitialInput &&
      seed.startRequest.intent.kind === 'user_message' &&
      message.step === 0 &&
      message.seq < firstCheckpointSeq &&
      message.content === seed.startRequest.intent.message;
    if (isInitialInput) {
      skippedInitialInput = true;
      continue;
    }
    fragments.push({ seq: message.seq, rank: 1, entry: { role: 'user', content: message.content } });
  }
  for (const checkpoint of checkpoints) {
    const callRows = checkpoint.record.toolCalls
      .map(({ id }) => calls.get(id))
      .filter((call): call is NonNullable<typeof call> => call !== undefined);
    const assistantSeq = callRows.reduce(
      (earliest, call) => Math.min(earliest, call.event.seq),
      checkpoint.seq,
    );
    const toolCalls = checkpoint.record.toolCalls.map((call) => ({
      id: call.id,
      name: call.name,
      arguments: call.arguments,
      ...(call.thoughtSignature ? { thoughtSignature: call.thoughtSignature } : {}),
    }));
    fragments.push({
      seq: assistantSeq,
      rank: 0,
      entry: {
        role: 'assistant',
        content: checkpoint.record.content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
    });
    checkpoint.record.toolCalls.forEach((call, order) => {
      const result = results.get(call.id)!;
      fragments.push({
        seq: result.event.seq,
        rank: order + 2,
        entry: {
          role: 'tool',
          content: stableStringify(result.record.result),
          toolCallId: call.id,
        },
      });
    });
  }
  return fragments
    .sort((left, right) => left.seq - right.seq || left.rank - right.rank)
    .map(({ entry }) => entry);
}

function validateRecordBinding(
  event: TimelineEvent,
  record: CommanderRecoveryRecord,
  previousHash: string | null,
): void {
  if (record.kind === 'run_seed') {
    if (event.kind !== 'run_start' || event.seq !== 0 || previousHash !== null) {
      throw new Error('run_seed must bind the first run_start event');
    }
  } else if (record.kind === 'inbox') {
    if (event.kind !== 'user_message' || event.content !== record.content) {
      throw new Error('inbox must bind the same user_message event');
    }
  } else if (record.kind === 'catalog' && event.kind !== 'catalog_frozen') {
    throw new Error('catalog recovery must bind catalog_frozen');
  } else if (record.kind === 'tool_call') {
    if (
      event.kind !== 'tool_call' ||
      event.toolCallId !== record.toolCallId ||
      `${event.toolRef.domain}.${event.toolRef.action}` !== record.toolName
    ) {
      throw new Error('tool_call recovery must bind the same tool_call');
    }
  } else if (record.kind === 'tool_result') {
    if (event.kind !== 'tool_result' || event.toolCallId !== record.toolCallId) {
      throw new Error('tool_result recovery must bind the same tool_result');
    }
  } else if (record.kind === 'model_checkpoint') {
    if (
      event.kind !== 'public_progress' ||
      event.status !== 'completed' ||
      event.operationId !== `model:${record.completedStep}` ||
      event.step !== record.completedStep
    ) {
      throw new Error('model_checkpoint must bind its completed model operation');
    }
  } else if (record.kind === 'resource_checkpoint' && event.kind !== 'resource_state') {
    throw new Error('resource_checkpoint recovery must bind resource_state');
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown, seen = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Recovery payload numbers must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new Error('Recovery payload must not contain cycles');
    seen.add(value);
    const result = `[${value.map((item) => stableStringify(item, seen)).join(',')}]`;
    seen.delete(value);
    return result;
  }
  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (seen.has(object)) throw new Error('Recovery payload must not contain cycles');
    if (Object.getPrototypeOf(object) !== Object.prototype && Object.getPrototypeOf(object) !== null) {
      throw new Error('Recovery payload must contain only JSON objects');
    }
    seen.add(object);
    const result = `{${Object.keys(object)
      .sort()
      .map((key) => {
        if (object[key] === undefined) {
          throw new Error('Recovery payload must not contain undefined');
        }
        return `${JSON.stringify(key)}:${stableStringify(object[key], seen)}`;
      })
      .join(',')}}`;
    seen.delete(object);
    return result;
  }
  throw new Error('Recovery payload must contain only JSON values');
}
