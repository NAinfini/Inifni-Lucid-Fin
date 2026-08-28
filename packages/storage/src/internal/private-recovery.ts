import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  AgentSendDefinition,
  AgentSendDurableInputSchema,
  AgentSendRecoveryPayloadV1Schema,
  AgentSpawnDefinition,
  AgentSpawnDurableInputSchema,
  ChildObjectiveRecoveryPayloadV1Schema,
  EncryptedRecoveryEnvelopeSchema,
  RuntimeLoopOutcomeSchema,
  RunSchema,
  ToolProgramDurableInputSchema,
  ToolProgramRecoveryPayloadV1Schema,
  canonicalJson,
  executableToolDefinition,
  parseCanonical,
  runtimeLoopOutcomeHashInput,
  type AgentSendRecoveryPayloadV1,
  type ChildObjectiveRecoveryPayloadV1,
  type EncryptedRecoveryEnvelope,
  type Run,
  type RunInboxMessage,
  type ToolProgramRecoveryPayloadV1,
  z,
} from '@lucid-fin/contracts';
import { StorageError } from '../kernel/errors.js';
import type { PrivateRecoveryCodec } from '../kernel/private-recovery-codec.js';
import { hashCanonical, hashContentObject, hashUtf8 } from './hashes.js';
import { loadOperationDispatch } from './operation-dispatch.js';
import { listRunInbox } from './run-inbox.js';
import { loadRunEvents } from './run-journal.js';
import { loadRun } from './run-records.js';
import { loadRunSnapshots } from './run-snapshots.js';

const CHILD_OBJECTIVE_ENVELOPE_SEQUENCE = 1;
const CHILD_OBJECTIVE_ACTIVATION_NUMBER = 1;
const CHILD_OBJECTIVE_SCHEMA_VERSION = 1;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

interface PrivateRecoveryEnvelopeRow {
  id: string;
  run_id: string;
  sequence: number;
  activation_number: number;
  schema_version: number;
  algorithm: string;
  encryption_key_id: string;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  authentication_tag: Uint8Array;
  ciphertext_hash: string;
  aad_hash: string;
  previous_envelope_hash: string | null;
  envelope_hash: string;
  byte_length: number;
  created_at: string;
}

export interface ParentDirectionPrivateModelContext {
  readonly type: 'parent_direction';
  readonly inboxMessageId: string;
  readonly parentRunId: string;
  readonly parentEventId: string;
  readonly directionHash: string;
  readonly objective?: string;
  readonly message?: string;
}

export interface SentDirectionPrivateModelContext {
  readonly type: 'sent_direction';
  readonly dispatchOperationId: string;
  readonly childRunId: string;
  readonly inboxMessageId: string;
  readonly parentEventId: string;
  readonly directionHash: string;
  readonly message: string;
}

export interface SpawnObjectivePrivateModelContext {
  readonly type: 'spawn_objective';
  readonly dispatchOperationId: string;
  readonly childRunId: string;
  readonly objectiveHash: string;
  readonly objective: string;
}

export interface PrivateModelContext {
  readonly parentDirections: readonly ParentDirectionPrivateModelContext[];
  readonly spawnObjectives: readonly SpawnObjectivePrivateModelContext[];
  readonly sentDirections?: readonly SentDirectionPrivateModelContext[];
}

export interface ToolProgramPrivateRunContext {
  readonly type: 'tool_program';
  readonly inboxMessageId: string;
  readonly parentRunId: string;
  readonly parentEventId: string;
  readonly parentDispatchOperationId: string;
  readonly programHash: string;
  readonly program: ToolProgramRecoveryPayloadV1['program'];
}

export type PrivateRunContext =
  | { readonly kind: 'model'; readonly model: PrivateModelContext }
  | { readonly kind: 'tool_program'; readonly program: ToolProgramPrivateRunContext };

export const EMPTY_PRIVATE_MODEL_CONTEXT: PrivateModelContext = Object.freeze({
  parentDirections: Object.freeze([]),
  spawnObjectives: Object.freeze([]),
});

function corrupt(message: string, cause?: unknown): StorageError {
  return new StorageError('CORRUPT_DATA', message, cause === undefined ? undefined : { cause });
}

function invalid(message: string, cause?: unknown): StorageError {
  return new StorageError('INVALID_REQUEST', message, cause === undefined ? undefined : { cause });
}

function securityConfigurationFailed(): StorageError {
  return new StorageError(
    'SECURITY_CONFIGURATION_FAILED',
    'Private recovery encryption is not configured securely',
  );
}

function requireCodec(codec: PrivateRecoveryCodec | undefined): PrivateRecoveryCodec {
  if (codec === undefined) throw securityConfigurationFailed();
  return codec;
}

function bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function base64(value: Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function hashBytes(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function recoveryAadInput(
  envelope: Pick<
    EncryptedRecoveryEnvelope,
    | 'boundary'
    | 'id'
    | 'runId'
    | 'sequence'
    | 'activationNumber'
    | 'schemaVersion'
    | 'algorithm'
    | 'encryptionKeyId'
    | 'previousEnvelopeHash'
    | 'createdAt'
  >,
) {
  return {
    boundary: envelope.boundary,
    id: envelope.id,
    runId: envelope.runId,
    sequence: envelope.sequence,
    activationNumber: envelope.activationNumber,
    schemaVersion: envelope.schemaVersion,
    algorithm: envelope.algorithm,
    encryptionKeyId: envelope.encryptionKeyId,
    previousEnvelopeHash: envelope.previousEnvelopeHash,
    createdAt: envelope.createdAt,
  };
}

function recoveryEnvelopeHashInput(envelope: Omit<EncryptedRecoveryEnvelope, 'envelopeHash'>) {
  return {
    ...recoveryAadInput(envelope),
    nonceBase64: envelope.nonceBase64,
    authenticationTagBase64: envelope.authenticationTagBase64,
    ciphertextHash: envelope.ciphertextHash,
    aadHash: envelope.aadHash,
    byteLength: envelope.byteLength,
  };
}

function parseEnvelope(value: unknown): EncryptedRecoveryEnvelope {
  try {
    return parseCanonical(EncryptedRecoveryEnvelopeSchema, value);
  } catch (cause) {
    throw corrupt('Private recovery envelope is invalid', cause);
  }
}

function envelopeFromRow(row: PrivateRecoveryEnvelopeRow): EncryptedRecoveryEnvelope {
  if (!(row.ciphertext instanceof Uint8Array)) {
    throw corrupt('Private recovery envelope ciphertext is invalid');
  }
  if (!(row.nonce instanceof Uint8Array) || !(row.authentication_tag instanceof Uint8Array)) {
    throw corrupt('Private recovery envelope authentication data is invalid');
  }
  return parseEnvelope({
    boundary: 'private_recovery',
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    activationNumber: row.activation_number,
    schemaVersion: row.schema_version,
    algorithm: row.algorithm,
    encryptionKeyId: row.encryption_key_id,
    nonceBase64: base64(row.nonce),
    ciphertextBase64: base64(row.ciphertext),
    authenticationTagBase64: base64(row.authentication_tag),
    ciphertextHash: row.ciphertext_hash,
    aadHash: row.aad_hash,
    previousEnvelopeHash: row.previous_envelope_hash,
    envelopeHash: row.envelope_hash,
    byteLength: row.byte_length,
    createdAt: row.created_at,
  });
}

function assertEnvelopeIntegrity(
  envelope: EncryptedRecoveryEnvelope,
  ciphertext: Uint8Array,
): Uint8Array {
  const aad = bytes(canonicalJson(recoveryAadInput(envelope)));
  if (
    envelope.ciphertextHash !== hashBytes(ciphertext) ||
    envelope.aadHash !== hashBytes(aad) ||
    envelope.byteLength !== ciphertext.byteLength ||
    envelope.envelopeHash !== hashCanonical(recoveryEnvelopeHashInput(envelope))
  ) {
    throw corrupt('Private recovery envelope integrity check failed');
  }
  return aad;
}

interface LoadedRecoveryEnvelope {
  readonly envelope: EncryptedRecoveryEnvelope;
  readonly ciphertext: Uint8Array;
}

function loadRecoveryEnvelopes(
  database: DatabaseSync,
  run: Run,
): readonly LoadedRecoveryEnvelope[] {
  const rows = database
    .prepare(
      `SELECT * FROM private_recovery_envelopes
       WHERE run_id = ?
       ORDER BY sequence`,
    )
    .all(run.id) as unknown as PrivateRecoveryEnvelopeRow[];
  if (rows.length === 0 || run.privateRecoveryHead === null) {
    throw corrupt(`Child Run ${run.id} private recovery chain is incomplete`);
  }
  let previousEnvelopeHash: string | null = null;
  const envelopes = rows.map((row, index) => {
    const envelope = envelopeFromRow(row);
    const expectedSequence = index + 1;
    if (
      envelope.runId !== run.id ||
      envelope.sequence !== expectedSequence ||
      envelope.schemaVersion !== CHILD_OBJECTIVE_SCHEMA_VERSION ||
      envelope.previousEnvelopeHash !== previousEnvelopeHash ||
      (index === 0 && envelope.activationNumber !== CHILD_OBJECTIVE_ACTIVATION_NUMBER)
    ) {
      throw corrupt(`Child Run ${run.id} private recovery chain is not continuous`);
    }
    const ciphertext = Buffer.from(row.ciphertext);
    assertEnvelopeIntegrity(envelope, ciphertext);
    previousEnvelopeHash = envelope.envelopeHash;
    return Object.freeze({ envelope, ciphertext });
  });
  const last = envelopes.at(-1)!;
  if (
    run.privateRecoveryHead.sequence !== last.envelope.sequence ||
    run.privateRecoveryHead.hash !== last.envelope.envelopeHash
  ) {
    throw corrupt(`Child Run ${run.id} private recovery chain does not match its head`);
  }
  return Object.freeze(envelopes);
}

function parseRecoveredPayload(
  plaintext: Uint8Array,
): ChildObjectiveRecoveryPayloadV1 | ToolProgramRecoveryPayloadV1 | AgentSendRecoveryPayloadV1 {
  let decoded: string;
  let value: unknown;
  try {
    decoded = textDecoder.decode(plaintext);
    value = JSON.parse(decoded);
  } catch (cause) {
    throw corrupt('Private recovery payload is invalid', cause);
  }
  let payload:
    ChildObjectiveRecoveryPayloadV1 | ToolProgramRecoveryPayloadV1 | AgentSendRecoveryPayloadV1;
  try {
    payload = parseCanonical(
      z.union([
        ChildObjectiveRecoveryPayloadV1Schema,
        ToolProgramRecoveryPayloadV1Schema,
        AgentSendRecoveryPayloadV1Schema,
      ]),
      value,
    );
  } catch (cause) {
    throw corrupt('Private recovery payload is invalid', cause);
  }
  if (canonicalJson(payload) !== decoded) {
    throw corrupt('Private recovery payload is not canonical');
  }
  return payload;
}

function openRecoveryPayload(
  codec: PrivateRecoveryCodec,
  loaded: LoadedRecoveryEnvelope,
): ChildObjectiveRecoveryPayloadV1 | ToolProgramRecoveryPayloadV1 | AgentSendRecoveryPayloadV1 {
  const aad = assertEnvelopeIntegrity(loaded.envelope, loaded.ciphertext);
  let plaintext: Uint8Array;
  try {
    plaintext = codec.open({
      algorithm: loaded.envelope.algorithm,
      encryptionKeyId: loaded.envelope.encryptionKeyId,
      nonce: Buffer.from(loaded.envelope.nonceBase64, 'base64'),
      ciphertext: loaded.ciphertext,
      authenticationTag: Buffer.from(loaded.envelope.authenticationTagBase64, 'base64'),
      aad,
    });
  } catch (cause) {
    if (cause instanceof StorageError) throw cause;
    throw corrupt('Private recovery envelope cannot be opened', cause);
  }
  return parseRecoveredPayload(plaintext);
}

export function durableToolProgramInput(
  program: ToolProgramRecoveryPayloadV1['program'],
): z.output<typeof ToolProgramDurableInputSchema> {
  const calls = program.steps.flatMap((step) => {
    if (step.operation === 'call') {
      return [
        {
          stepId: step.stepId,
          callIndex: 0,
          toolId: step.invocation.toolId,
          toolVersion: step.invocation.toolVersion,
          inputHash: hashCanonical(step.invocation.input),
        },
      ];
    }
    if (step.operation === 'map' || step.operation === 'batch') {
      return step.invocations.map((invocation, callIndex) => ({
        stepId: step.stepId,
        callIndex,
        toolId: invocation.toolId,
        toolVersion: invocation.toolVersion,
        inputHash: hashCanonical(invocation.input),
      }));
    }
    return [];
  });
  return ToolProgramDurableInputSchema.parse({
    version: program.version,
    displayName: program.displayName,
    expectedRunRevision: program.expectedRunRevision,
    contextRefs: program.contextRefs,
    programHash: hashCanonical(program),
    calls,
  });
}

function assertChildObjectiveBindings(
  database: DatabaseSync,
  run: Run,
  payload: ChildObjectiveRecoveryPayloadV1,
): RunInboxMessage {
  if (
    run.parentRunId === null ||
    run.acceptedSource.kind !== 'parent_direction' ||
    payload.runId !== run.id ||
    payload.parentRunId !== run.parentRunId ||
    payload.parentRunId !== run.acceptedSource.parentRunId ||
    payload.parentEventId !== run.acceptedSource.parentEventId ||
    payload.directionHash !== run.acceptedSource.directionHash ||
    hashUtf8(payload.objective) !== payload.directionHash
  ) {
    throw corrupt(`Child Run ${run.id} private recovery payload is not bound to the Run`);
  }
  const inbox = listRunInbox(database, run.id).find(
    ({ id, sequence }) =>
      id === payload.inboxMessageId && sequence === CHILD_OBJECTIVE_ENVELOPE_SEQUENCE,
  );
  if (
    inbox === undefined ||
    inbox.actor !== 'commander' ||
    inbox.contentHash !== payload.directionHash ||
    canonicalJson(inbox.source) !== canonicalJson(run.acceptedSource)
  ) {
    throw corrupt(`Child Run ${run.id} private recovery payload is not bound to its Inbox`);
  }
  const parentEvent = loadRunEvents(database, payload.parentRunId).find(
    ({ eventId }) => eventId === payload.parentEventId,
  );
  const parentPayload =
    parentEvent?.visibility === 'public' && parentEvent.payloadState.state === 'available'
      ? parentEvent.payloadState.payload
      : null;
  if (
    parentPayload === null ||
    parentPayload.type !== 'child_run_delegated' ||
    parentPayload.childRunId !== run.id ||
    parentPayload.displayName !== run.displayName ||
    parentPayload.publicSummary !== run.publicSummary ||
    parentPayload.directionHash !== payload.directionHash
  ) {
    throw corrupt(`Child Run ${run.id} private recovery payload is not bound to its parent event`);
  }
  if (payload.parentDispatchOperationId !== null) {
    const row = database
      .prepare(
        `SELECT run_id, tool_id, input_v1_json
         FROM dispatch_operations
         WHERE id = ?`,
      )
      .get(payload.parentDispatchOperationId) as
      | { readonly run_id: string; readonly tool_id: string; readonly input_v1_json: string }
      | undefined;
    if (row === undefined || row.run_id !== run.parentRunId || row.tool_id !== 'agent.spawn') {
      throw corrupt(`Child Run ${run.id} private recovery payload is not bound to its dispatch`);
    }
    let safeInput: z.output<typeof AgentSpawnDurableInputSchema>;
    try {
      safeInput = AgentSpawnDurableInputSchema.parse(JSON.parse(row.input_v1_json) as unknown);
    } catch (cause) {
      throw corrupt(`Child Run ${run.id} private recovery dispatch input is invalid`, cause);
    }
    if (safeInput.objectiveHash !== payload.directionHash) {
      throw corrupt(`Child Run ${run.id} private recovery dispatch objective hash is invalid`);
    }
  }
  return inbox;
}

function assertToolProgramBindings(
  database: DatabaseSync,
  run: Run,
  payload: ToolProgramRecoveryPayloadV1,
): RunInboxMessage {
  if (
    run.parentRunId === null ||
    run.acceptedSource.kind !== 'parent_direction' ||
    payload.runId !== run.id ||
    payload.parentRunId !== run.parentRunId ||
    payload.parentRunId !== run.acceptedSource.parentRunId ||
    payload.parentEventId !== run.acceptedSource.parentEventId ||
    payload.programHash !== run.acceptedSource.directionHash ||
    payload.programHash !== hashCanonical(payload.program)
  ) {
    throw corrupt(`Tool Program child Run ${run.id} private recovery payload is not bound`);
  }
  const inbox = listRunInbox(database, run.id).find(
    ({ id, sequence }) =>
      id === payload.inboxMessageId && sequence === CHILD_OBJECTIVE_ENVELOPE_SEQUENCE,
  );
  if (
    inbox === undefined ||
    inbox.actor !== 'commander' ||
    inbox.contentHash !== payload.programHash ||
    canonicalJson(inbox.source) !== canonicalJson(run.acceptedSource)
  ) {
    throw corrupt(`Tool Program child Run ${run.id} private recovery Inbox is invalid`);
  }
  const parentEvent = loadRunEvents(database, payload.parentRunId).find(
    ({ eventId }) => eventId === payload.parentEventId,
  );
  const parentPayload =
    parentEvent?.visibility === 'public' && parentEvent.payloadState.state === 'available'
      ? parentEvent.payloadState.payload
      : null;
  if (
    parentPayload === null ||
    parentPayload.type !== 'child_run_delegated' ||
    parentPayload.childRunId !== run.id ||
    parentPayload.displayName !== run.displayName ||
    parentPayload.publicSummary !== run.publicSummary ||
    parentPayload.directionHash !== payload.programHash
  ) {
    throw corrupt(`Tool Program child Run ${run.id} parent event is invalid`);
  }
  const row = database
    .prepare(
      `SELECT run_id, tool_id, tool_version, input_v1_json,
              origin_model_attempt_id, origin_provider_call_id,
              parent_dispatch_operation_id, program_step_id, program_call_index
       FROM dispatch_operations WHERE id = ?`,
    )
    .get(payload.parentDispatchOperationId) as
    | {
        readonly run_id: string;
        readonly tool_id: string;
        readonly tool_version: string;
        readonly input_v1_json: string;
        readonly origin_model_attempt_id: string | null;
        readonly origin_provider_call_id: string | null;
        readonly parent_dispatch_operation_id: string | null;
        readonly program_step_id: string | null;
        readonly program_call_index: number | null;
      }
    | undefined;
  if (
    row === undefined ||
    row.run_id !== run.parentRunId ||
    row.tool_id !== 'tool.program' ||
    row.origin_model_attempt_id === null ||
    row.origin_provider_call_id === null ||
    row.parent_dispatch_operation_id !== null ||
    row.program_step_id !== null ||
    row.program_call_index !== null
  ) {
    throw corrupt(`Tool Program child Run ${run.id} parent dispatch is invalid`);
  }
  const parent = loadRun(database, payload.parentRunId);
  const { catalog } = loadRunSnapshots(database, parent);
  const frozenTools = catalog.tools.filter(
    ({ id, version }) => id === row.tool_id && version === row.tool_version,
  );
  const definition = executableToolDefinition(row.tool_id, row.tool_version) as unknown as
    | {
        readonly version: string;
        readonly parseInput: (input: unknown) => unknown;
      }
    | undefined;
  if (frozenTools.length !== 1 || definition?.version !== row.tool_version) {
    throw corrupt(
      `Tool Program child Run ${run.id} parent dispatch tool ${row.tool_id}@${row.tool_version} is unavailable`,
    );
  }
  let privateProgram: unknown;
  try {
    privateProgram = definition.parseInput(payload.program);
  } catch (cause) {
    throw corrupt(`Tool Program child Run ${run.id} private program is invalid`, cause);
  }
  if (canonicalJson(privateProgram) !== canonicalJson(payload.program)) {
    throw corrupt(`Tool Program child Run ${run.id} private program is not canonical`);
  }
  let safeInput: z.output<typeof ToolProgramDurableInputSchema>;
  try {
    safeInput = ToolProgramDurableInputSchema.parse(JSON.parse(row.input_v1_json) as unknown);
  } catch (cause) {
    throw corrupt(`Tool Program child Run ${run.id} parent safe input is invalid`, cause);
  }
  if (canonicalJson(safeInput) !== canonicalJson(durableToolProgramInput(payload.program))) {
    throw corrupt(`Tool Program child Run ${run.id} parent safe input does not match recovery`);
  }
  return inbox;
}

function appendInitialRecovery(
  database: DatabaseSync,
  codecValue: PrivateRecoveryCodec | undefined,
  input: Readonly<{
    envelopeId: string;
    child: Run;
    inbox: RunInboxMessage;
    directionHash: string;
    payload: ChildObjectiveRecoveryPayloadV1 | ToolProgramRecoveryPayloadV1;
    createdAt: string;
  }>,
): { readonly run: Run; readonly envelope: EncryptedRecoveryEnvelope } {
  if (!database.isTransaction) {
    throw new StorageError(
      'INVALID_REQUEST',
      'Private recovery append requires an active transaction',
    );
  }
  const codec = requireCodec(codecValue);
  const { child, inbox } = input;
  if (
    child.revision !== 0 ||
    child.status !== 'accepted' ||
    child.parentRunId === null ||
    child.acceptedSource.kind !== 'parent_direction' ||
    child.privateRecoveryHead !== null ||
    inbox.runId !== child.id ||
    inbox.sequence !== CHILD_OBJECTIVE_ENVELOPE_SEQUENCE ||
    inbox.source.kind !== 'parent_direction' ||
    canonicalJson(inbox.source) !== canonicalJson(child.acceptedSource) ||
    inbox.contentHash !== child.acceptedSource.directionHash ||
    input.directionHash !== child.acceptedSource.directionHash
  ) {
    throw corrupt(`Child Run ${child.id} cannot append its private recovery envelope`);
  }
  const header = {
    boundary: 'private_recovery' as const,
    id: input.envelopeId,
    runId: child.id,
    sequence: CHILD_OBJECTIVE_ENVELOPE_SEQUENCE,
    activationNumber: CHILD_OBJECTIVE_ACTIVATION_NUMBER,
    schemaVersion: CHILD_OBJECTIVE_SCHEMA_VERSION,
    algorithm: codec.algorithm,
    encryptionKeyId: codec.encryptionKeyId,
    previousEnvelopeHash: null,
    createdAt: input.createdAt,
  };
  const aad = bytes(canonicalJson(recoveryAadInput(header)));
  const sealed = codec.seal({ plaintext: bytes(canonicalJson(input.payload)), aad });
  if (sealed.algorithm !== header.algorithm || sealed.encryptionKeyId !== header.encryptionKeyId) {
    throw securityConfigurationFailed();
  }
  const withoutHash = {
    ...header,
    nonceBase64: base64(sealed.nonce),
    ciphertextBase64: base64(sealed.ciphertext),
    authenticationTagBase64: base64(sealed.authenticationTag),
    ciphertextHash: hashBytes(sealed.ciphertext),
    aadHash: hashBytes(aad),
    byteLength: sealed.ciphertext.byteLength,
  };
  const envelope = parseEnvelope({
    ...withoutHash,
    envelopeHash: hashCanonical(recoveryEnvelopeHashInput(withoutHash)),
  });
  database
    .prepare(
      `INSERT INTO private_recovery_envelopes (
         id, run_id, sequence, activation_number, schema_version, algorithm,
         encryption_key_id, ciphertext, nonce, authentication_tag, ciphertext_hash,
         aad_hash, previous_envelope_hash, envelope_hash, byte_length, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      envelope.id,
      envelope.runId,
      envelope.sequence,
      envelope.activationNumber,
      envelope.schemaVersion,
      envelope.algorithm,
      envelope.encryptionKeyId,
      Buffer.from(sealed.ciphertext),
      Buffer.from(sealed.nonce),
      Buffer.from(sealed.authenticationTag),
      envelope.ciphertextHash,
      envelope.aadHash,
      envelope.previousEnvelopeHash,
      envelope.envelopeHash,
      envelope.byteLength,
      envelope.createdAt,
    );
  const nextWithoutHash = {
    ...child,
    revision: child.revision + 1,
    contentHash: '',
    privateRecoveryHead: {
      sequence: envelope.sequence,
      hash: envelope.envelopeHash,
    },
  };
  const run = parseCanonical(RunSchema, {
    ...nextWithoutHash,
    contentHash: hashContentObject(nextWithoutHash),
  });
  const update = database
    .prepare(
      `UPDATE runs
       SET revision = ?, content_hash = ?
       WHERE id = ? AND revision = ? AND content_hash = ?`,
    )
    .run(run.revision, run.contentHash, child.id, child.revision, child.contentHash);
  if (Number(update.changes) !== 1) {
    throw new StorageError('REVISION_CONFLICT', `Run ${child.id} changed concurrently`);
  }
  return { run, envelope };
}

export function appendChildObjectiveRecovery(
  database: DatabaseSync,
  codecValue: PrivateRecoveryCodec | undefined,
  input: Readonly<{
    envelopeId: string;
    child: Run;
    inbox: RunInboxMessage;
    parentDispatchOperationId: string | null;
    objective: string;
    createdAt: string;
  }>,
): { readonly run: Run; readonly envelope: EncryptedRecoveryEnvelope } {
  const payload = parseCanonical(ChildObjectiveRecoveryPayloadV1Schema, {
    schemaVersion: CHILD_OBJECTIVE_SCHEMA_VERSION,
    kind: 'child_objective',
    runId: input.child.id,
    inboxMessageId: input.inbox.id,
    parentRunId:
      input.child.acceptedSource.kind === 'parent_direction'
        ? input.child.acceptedSource.parentRunId
        : '',
    parentEventId:
      input.child.acceptedSource.kind === 'parent_direction'
        ? input.child.acceptedSource.parentEventId
        : '',
    parentDispatchOperationId: input.parentDispatchOperationId,
    directionHash:
      input.child.acceptedSource.kind === 'parent_direction'
        ? input.child.acceptedSource.directionHash
        : '',
    objective: input.objective,
  });
  return appendInitialRecovery(database, codecValue, {
    ...input,
    directionHash: hashUtf8(input.objective),
    payload,
  });
}

export function appendToolProgramRecovery(
  database: DatabaseSync,
  codecValue: PrivateRecoveryCodec | undefined,
  input: Readonly<{
    envelopeId: string;
    child: Run;
    inbox: RunInboxMessage;
    parentDispatchOperationId: string;
    programHash: string;
    program: ToolProgramRecoveryPayloadV1['program'];
    createdAt: string;
  }>,
): { readonly run: Run; readonly envelope: EncryptedRecoveryEnvelope } {
  if (hashCanonical(input.program) !== input.programHash) {
    throw corrupt(`Child Run ${input.child.id} Tool Program hash is invalid`);
  }
  if (input.child.acceptedSource.kind !== 'parent_direction') {
    throw corrupt(`Child Run ${input.child.id} Tool Program source is invalid`);
  }
  const payload = parseCanonical(ToolProgramRecoveryPayloadV1Schema, {
    schemaVersion: CHILD_OBJECTIVE_SCHEMA_VERSION,
    kind: 'tool_program',
    runId: input.child.id,
    inboxMessageId: input.inbox.id,
    parentRunId: input.child.acceptedSource.parentRunId,
    parentEventId: input.child.acceptedSource.parentEventId,
    parentDispatchOperationId: input.parentDispatchOperationId,
    programHash: input.programHash,
    program: input.program,
  });
  return appendInitialRecovery(database, codecValue, {
    ...input,
    directionHash: input.programHash,
    payload,
  });
}

export function appendAgentSendRecovery(
  database: DatabaseSync,
  codecValue: PrivateRecoveryCodec | undefined,
  input: Readonly<{
    envelopeId: string;
    child: Run;
    inbox: RunInboxMessage;
    parentRunId: string;
    parentEventId: string;
    parentDispatchOperationId: string;
    activationNumber: number;
    message: string;
    createdAt: string;
  }>,
): EncryptedRecoveryEnvelope {
  if (!database.isTransaction) {
    throw new StorageError(
      'INVALID_REQUEST',
      'Private recovery append requires an active transaction',
    );
  }
  const codec = requireCodec(codecValue);
  const directionHash = hashUtf8(input.message);
  const chain = loadRecoveryEnvelopes(database, input.child);
  const previous = chain.at(-1)!;
  const payload = parseCanonical(AgentSendRecoveryPayloadV1Schema, {
    schemaVersion: CHILD_OBJECTIVE_SCHEMA_VERSION,
    kind: 'agent_send',
    runId: input.child.id,
    inboxMessageId: input.inbox.id,
    inboxSequence: input.inbox.sequence,
    parentRunId: input.parentRunId,
    parentEventId: input.parentEventId,
    parentDispatchOperationId: input.parentDispatchOperationId,
    directionHash,
    message: input.message,
  });
  if (
    input.inbox.runId !== input.child.id ||
    input.inbox.actor !== 'commander' ||
    input.inbox.state !== 'queued' ||
    input.inbox.source.kind !== 'parent_direction' ||
    input.inbox.source.parentRunId !== payload.parentRunId ||
    input.inbox.source.parentEventId !== payload.parentEventId ||
    input.inbox.source.directionHash !== payload.directionHash ||
    input.inbox.contentHash !== payload.directionHash
  ) {
    throw corrupt(`Child Run ${input.child.id} agent.send recovery Inbox is invalid`);
  }
  const header = {
    boundary: 'private_recovery' as const,
    id: input.envelopeId,
    runId: input.child.id,
    sequence: previous.envelope.sequence + 1,
    activationNumber: input.activationNumber,
    schemaVersion: CHILD_OBJECTIVE_SCHEMA_VERSION,
    algorithm: codec.algorithm,
    encryptionKeyId: codec.encryptionKeyId,
    previousEnvelopeHash: previous.envelope.envelopeHash,
    createdAt: input.createdAt,
  };
  const aad = bytes(canonicalJson(recoveryAadInput(header)));
  const sealed = codec.seal({ plaintext: bytes(canonicalJson(payload)), aad });
  if (sealed.algorithm !== header.algorithm || sealed.encryptionKeyId !== header.encryptionKeyId) {
    throw securityConfigurationFailed();
  }
  const withoutHash = {
    ...header,
    nonceBase64: base64(sealed.nonce),
    ciphertextBase64: base64(sealed.ciphertext),
    authenticationTagBase64: base64(sealed.authenticationTag),
    ciphertextHash: hashBytes(sealed.ciphertext),
    aadHash: hashBytes(aad),
    byteLength: sealed.ciphertext.byteLength,
  };
  const envelope = parseEnvelope({
    ...withoutHash,
    envelopeHash: hashCanonical(recoveryEnvelopeHashInput(withoutHash)),
  });
  database
    .prepare(
      `INSERT INTO private_recovery_envelopes (
         id, run_id, sequence, activation_number, schema_version, algorithm,
         encryption_key_id, ciphertext, nonce, authentication_tag, ciphertext_hash,
         aad_hash, previous_envelope_hash, envelope_hash, byte_length, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      envelope.id,
      envelope.runId,
      envelope.sequence,
      envelope.activationNumber,
      envelope.schemaVersion,
      envelope.algorithm,
      envelope.encryptionKeyId,
      Buffer.from(sealed.ciphertext),
      Buffer.from(sealed.nonce),
      Buffer.from(sealed.authenticationTag),
      envelope.ciphertextHash,
      envelope.aadHash,
      envelope.previousEnvelopeHash,
      envelope.envelopeHash,
      envelope.byteLength,
      envelope.createdAt,
    );
  return envelope;
}

function recoverPrivateChildPayload(
  database: DatabaseSync,
  codecValue: PrivateRecoveryCodec | undefined,
  run: Run,
): ChildObjectiveRecoveryPayloadV1 | ToolProgramRecoveryPayloadV1 {
  if (run.parentRunId === null) {
    throw corrupt(`Root Run ${run.id} cannot carry a child private recovery envelope`);
  }
  const codec = requireCodec(codecValue);
  const payload = openRecoveryPayload(codec, loadRecoveryEnvelopes(database, run)[0]!);
  if (payload.kind === 'agent_send') {
    throw corrupt(`Child Run ${run.id} private recovery chain has no initial payload`);
  }
  return payload;
}

function recoverChildObjective(
  database: DatabaseSync,
  codecValue: PrivateRecoveryCodec | undefined,
  run: Run,
): ChildObjectiveRecoveryPayloadV1 {
  const payload = recoverPrivateChildPayload(database, codecValue, run);
  if (payload.kind !== 'child_objective') {
    throw invalid(`Tool Program child Run ${run.id} cannot materialize a model objective`);
  }
  assertChildObjectiveBindings(database, run, payload);
  return payload;
}

function isStrictDescendant(
  database: DatabaseSync,
  parentRunId: string,
  childRunId: string,
): boolean {
  return (
    database
      .prepare(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM runs WHERE parent_run_id = ?
           UNION
           SELECT child.id
           FROM runs AS child
           JOIN descendants AS parent ON child.parent_run_id = parent.id
         )
         SELECT 1 FROM descendants WHERE id = ? LIMIT 1`,
      )
      .get(parentRunId, childRunId) !== undefined
  );
}

function agentSendSelectedContext(
  database: DatabaseSync,
  parent: Run,
  contextRefs: z.output<typeof AgentSendDurableInputSchema>['contextRefs'],
): readonly RunInboxMessage['selectedContext'][number][] {
  const { manifest } = loadRunSnapshots(database, parent);
  return contextRefs.map((ref) => {
    const matches = manifest.selectedContext.filter(
      (entry) => canonicalJson(entry.ref) === canonicalJson(ref),
    );
    if (matches.length !== 1) {
      throw corrupt(`agent.send context ${ref.id} is not uniquely authorized by its parent Run`);
    }
    return matches[0]!;
  });
}

function assertAgentSendBindings(
  database: DatabaseSync,
  run: Run,
  envelope: EncryptedRecoveryEnvelope,
  payload: AgentSendRecoveryPayloadV1,
): RunInboxMessage {
  if (
    payload.runId !== run.id ||
    envelope.runId !== run.id ||
    envelope.activationNumber < 1 ||
    hashUtf8(payload.message) !== payload.directionHash
  ) {
    throw corrupt(`Run ${run.id} agent.send private recovery payload is invalid`);
  }
  const inbox = listRunInbox(database, run.id).find(
    ({ id, sequence }) => id === payload.inboxMessageId && sequence === payload.inboxSequence,
  );
  if (
    inbox === undefined ||
    inbox.actor !== 'commander' ||
    inbox.source.kind !== 'parent_direction' ||
    inbox.source.parentRunId !== payload.parentRunId ||
    inbox.source.parentEventId !== payload.parentEventId ||
    inbox.source.directionHash !== payload.directionHash ||
    inbox.contentHash !== payload.directionHash
  ) {
    throw corrupt(`Run ${run.id} agent.send private recovery Inbox is invalid`);
  }
  const parent = loadRun(database, payload.parentRunId);
  if (parent.projectId !== run.projectId || !isStrictDescendant(database, parent.id, run.id)) {
    throw corrupt(`Run ${run.id} agent.send parent Run lineage is invalid`);
  }
  const dispatch = loadOperationDispatch(database, payload.parentDispatchOperationId);
  let safeInput: z.output<typeof AgentSendDurableInputSchema>;
  let result: z.output<typeof AgentSendDefinition.successSchema>;
  try {
    safeInput = AgentSendDurableInputSchema.parse(dispatch.key.input);
    result =
      dispatch.outcome?.status === 'succeeded'
        ? AgentSendDefinition.parseSuccess(dispatch.outcome.data)
        : (() => {
            throw new Error('agent.send dispatch outcome is not a success');
          })();
  } catch (cause) {
    throw corrupt(`Run ${run.id} agent.send dispatch is invalid`, cause);
  }
  if (
    dispatch.key.toolId !== 'agent.send' ||
    dispatch.origin.kind !== 'model' ||
    dispatch.key.runId !== parent.id ||
    safeInput.childRunId !== run.id ||
    safeInput.messageHash !== payload.directionHash ||
    result.inboxMessageId !== payload.inboxMessageId ||
    result.inboxSequence !== payload.inboxSequence ||
    result.activationNumber !== envelope.activationNumber ||
    result.deliveryState !== 'queued' ||
    result.child.childRunId !== run.id ||
    result.child.revision !== safeInput.expectedChildRevision + 1
  ) {
    throw corrupt(`Run ${run.id} agent.send dispatch binding is invalid`);
  }
  const selectedContext = agentSendSelectedContext(database, parent, safeInput.contextRefs);
  if (canonicalJson(selectedContext) !== canonicalJson(inbox.selectedContext)) {
    throw corrupt(`Run ${run.id} agent.send context binding is invalid`);
  }
  const parentEvent = loadRunEvents(database, parent.id).find(
    ({ eventId }) => eventId === payload.parentEventId,
  );
  const parentPayload =
    parentEvent?.visibility === 'model_surface' && parentEvent.payloadState.state === 'available'
      ? parentEvent.payloadState.payload
      : null;
  if (
    parentPayload === null ||
    parentPayload.type !== 'tool_call_ref' ||
    parentPayload.callId !== dispatch.id ||
    parentPayload.toolName !== 'agent.send' ||
    parentPayload.capabilityCatalogSnapshotId !== parent.capabilityCatalogSnapshotId ||
    parentPayload.inputPayloadId !== dispatch.id ||
    parentPayload.inputHash !== dispatch.key.inputHash
  ) {
    throw corrupt(`Run ${run.id} agent.send parent event is invalid`);
  }
  return inbox;
}

interface RecoveredAgentSendDirection {
  readonly envelope: EncryptedRecoveryEnvelope;
  readonly payload: AgentSendRecoveryPayloadV1;
  readonly inbox: RunInboxMessage;
}

function recoverAgentSendDirections(
  database: DatabaseSync,
  codecValue: PrivateRecoveryCodec | undefined,
  run: Run,
): readonly RecoveredAgentSendDirection[] {
  const codec = requireCodec(codecValue);
  const chain = loadRecoveryEnvelopes(database, run);
  return Object.freeze(
    chain.slice(1).map((loaded) => {
      const payload = openRecoveryPayload(codec, loaded);
      if (payload.kind !== 'agent_send') {
        throw corrupt(`Run ${run.id} private recovery chain has an unexpected follow-up payload`);
      }
      return Object.freeze({
        envelope: loaded.envelope,
        payload,
        inbox: assertAgentSendBindings(database, run, loaded.envelope, payload),
      });
    }),
  );
}

interface AgentSpawnDispatchRow {
  readonly id: string;
  readonly input_v1_json: string;
  readonly outcome_v1_json: string | null;
  readonly outcome_hash: string | null;
}

interface AgentSendDispatchRow {
  readonly id: string;
}

function sentDirectionsForRun(
  database: DatabaseSync,
  codecValue: PrivateRecoveryCodec | undefined,
  run: Run,
): readonly SentDirectionPrivateModelContext[] {
  const rows = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE run_id = ? AND tool_id = 'agent.send'
       ORDER BY rowid`,
    )
    .all(run.id) as unknown as AgentSendDispatchRow[];
  if (rows.length === 0) return Object.freeze([]);
  return Object.freeze(
    rows.map(({ id }) => {
      const dispatch = loadOperationDispatch(database, id);
      if (dispatch.outcome?.status !== 'succeeded') {
        throw corrupt(`agent.send dispatch ${dispatch.id} outcome is incomplete`);
      }
      const result = AgentSendDefinition.parseSuccess(dispatch.outcome.data);
      const child = loadRun(database, result.child.childRunId);
      const directions = recoverAgentSendDirections(database, codecValue, child).filter(
        ({ payload }) =>
          payload.parentRunId === run.id && payload.parentDispatchOperationId === dispatch.id,
      );
      if (directions.length !== 1) {
        throw corrupt(`agent.send dispatch ${dispatch.id} has no unique private target direction`);
      }
      const { payload } = directions[0]!;
      return Object.freeze({
        type: 'sent_direction' as const,
        dispatchOperationId: dispatch.id,
        childRunId: child.id,
        inboxMessageId: payload.inboxMessageId,
        parentEventId: payload.parentEventId,
        directionHash: payload.directionHash,
        message: payload.message,
      });
    }),
  );
}

function spawnObjectivesForRun(
  database: DatabaseSync,
  codecValue: PrivateRecoveryCodec | undefined,
  run: Run,
): readonly SpawnObjectivePrivateModelContext[] {
  const rows = database
    .prepare(
      `SELECT id, input_v1_json, outcome_v1_json, outcome_hash
       FROM dispatch_operations
       WHERE run_id = ? AND tool_id = 'agent.spawn'
       ORDER BY rowid`,
    )
    .all(run.id) as unknown as AgentSpawnDispatchRow[];
  if (rows.length === 0) return Object.freeze([]);
  const seenChildRunIds = new Set<string>();
  return Object.freeze(
    rows.map((row) => {
      let safeInput: z.output<typeof AgentSpawnDurableInputSchema>;
      let outcome: z.output<typeof RuntimeLoopOutcomeSchema>;
      try {
        safeInput = AgentSpawnDurableInputSchema.parse(JSON.parse(row.input_v1_json) as unknown);
        if (row.outcome_v1_json === null) {
          throw corrupt(`agent.spawn dispatch ${row.id} outcome is missing`);
        }
        outcome = parseCanonical(
          RuntimeLoopOutcomeSchema,
          AgentSpawnDefinition.outcomeSchema.parse(JSON.parse(row.outcome_v1_json) as unknown),
        );
      } catch (cause) {
        throw corrupt(`agent.spawn dispatch ${row.id} is not safely materialized`, cause);
      }
      if (
        row.outcome_hash === null ||
        row.outcome_hash !== hashCanonical(runtimeLoopOutcomeHashInput(outcome)) ||
        outcome.status !== 'succeeded'
      ) {
        throw corrupt(`agent.spawn dispatch ${row.id} outcome is incomplete or invalid`);
      }
      const result = AgentSpawnDefinition.parseSuccess(outcome.data);
      const childRunId = result.child.childRunId;
      if (
        result.child.objectiveHash !== safeInput.objectiveHash ||
        seenChildRunIds.has(childRunId)
      ) {
        throw corrupt(`agent.spawn dispatch ${row.id} child binding is invalid`);
      }
      seenChildRunIds.add(childRunId);
      const child = loadRun(database, childRunId);
      const payload = recoverChildObjective(database, codecValue, child);
      if (
        child.parentRunId !== run.id ||
        child.acceptedSource.kind !== 'parent_direction' ||
        child.acceptedSource.directionHash !== safeInput.objectiveHash ||
        payload.parentDispatchOperationId !== row.id ||
        payload.directionHash !== safeInput.objectiveHash
      ) {
        throw corrupt(`agent.spawn dispatch ${row.id} private child objective is not bound`);
      }
      return Object.freeze({
        type: 'spawn_objective' as const,
        dispatchOperationId: row.id,
        childRunId,
        objectiveHash: safeInput.objectiveHash,
        objective: payload.objective,
      });
    }),
  );
}

function materializeModelContext(
  database: DatabaseSync,
  codecValue: PrivateRecoveryCodec | undefined,
  run: Run,
): PrivateModelContext {
  const initialParentDirections =
    run.parentRunId === null
      ? Object.freeze([])
      : Object.freeze([
          (() => {
            const payload = recoverChildObjective(database, codecValue, run);
            return Object.freeze({
              type: 'parent_direction' as const,
              inboxMessageId: payload.inboxMessageId,
              parentRunId: payload.parentRunId,
              parentEventId: payload.parentEventId,
              directionHash: payload.directionHash,
              objective: payload.objective,
            });
          })(),
        ]);
  const followupParentDirections =
    run.parentRunId === null
      ? Object.freeze([])
      : Object.freeze(
          recoverAgentSendDirections(database, codecValue, run)
            .filter(({ inbox }) => inbox.state === 'delivered' || inbox.state === 'consumed')
            .map(({ payload }) =>
              Object.freeze({
                type: 'parent_direction' as const,
                inboxMessageId: payload.inboxMessageId,
                parentRunId: payload.parentRunId,
                parentEventId: payload.parentEventId,
                directionHash: payload.directionHash,
                message: payload.message,
              }),
            ),
        );
  const parentDirections = Object.freeze([...initialParentDirections, ...followupParentDirections]);
  const spawnObjectives = spawnObjectivesForRun(database, codecValue, run);
  const sentDirections = sentDirectionsForRun(database, codecValue, run);
  if (
    parentDirections.length === 0 &&
    spawnObjectives.length === 0 &&
    sentDirections.length === 0
  ) {
    return EMPTY_PRIVATE_MODEL_CONTEXT;
  }
  const model = {
    parentDirections,
    spawnObjectives,
    ...(sentDirections.length === 0 ? {} : { sentDirections }),
  };
  return Object.freeze(model);
}

export function materializePrivateRunContext(
  database: DatabaseSync,
  codecValue: PrivateRecoveryCodec | undefined,
  run: Run,
): PrivateRunContext {
  if (run.parentRunId !== null) {
    const payload = recoverPrivateChildPayload(database, codecValue, run);
    if (payload.kind === 'tool_program') {
      assertToolProgramBindings(database, run, payload);
      return Object.freeze({
        kind: 'tool_program',
        program: Object.freeze({
          type: 'tool_program',
          inboxMessageId: payload.inboxMessageId,
          parentRunId: payload.parentRunId,
          parentEventId: payload.parentEventId,
          parentDispatchOperationId: payload.parentDispatchOperationId,
          programHash: payload.programHash,
          program: payload.program,
        }),
      });
    }
  }
  return Object.freeze({
    kind: 'model',
    model: materializeModelContext(database, codecValue, run),
  });
}

export function materializePrivateModelContext(
  database: DatabaseSync,
  codecValue: PrivateRecoveryCodec | undefined,
  run: Run,
): PrivateModelContext {
  const context = materializePrivateRunContext(database, codecValue, run);
  if (context.kind !== 'model') {
    throw invalid(`Tool Program child Run ${run.id} has no model private context`);
  }
  return context.model;
}

export function materializePrivateToolProgramContext(
  database: DatabaseSync,
  codecValue: PrivateRecoveryCodec | undefined,
  run: Run,
): ToolProgramPrivateRunContext {
  const context = materializePrivateRunContext(database, codecValue, run);
  if (context.kind !== 'tool_program') {
    throw invalid(`Run ${run.id} is not a Tool Program child`);
  }
  return context.program;
}
