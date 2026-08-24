import { describe, expect, it } from 'vitest';
import type { CommanderStartRequest, TimelineEvent } from '@lucid-fin/contracts';
import type {
  StoredCommanderRun,
  StoredCommanderRunRecoveryEvent,
} from '@lucid-fin/storage';
import { RunResourceBudgetController } from '@lucid-fin/application';
import {
  createCommanderCatalogRecoveryRecord,
  createSafeStorageCommanderRecoveryCodec,
  openCommanderRecoveryPayload,
  parseCommanderRecoveryPayloadV1,
  projectCommanderRecovery,
  readVerifiedCommanderRecoverySeed,
  sealCommanderRecoveryBatch,
  type CommanderRecoveryRecord,
} from './commander-recovery.service.js';

const sentinel = 'SECRET_RECOVERY_INSTRUCTIONS';
const CATALOG_HASH = 'a'.repeat(64);
const INPUT_HASH = 'b'.repeat(64);
const OUTPUT_HASH = 'c'.repeat(64);
const OTHER_HASH = 'd'.repeat(64);

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => 'dpapi',
    encryptString(value: string) {
      return Buffer.from([...Buffer.from(value)].map((byte) => byte ^ 0xa5));
    },
    decryptString(value: Buffer) {
      return Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString('utf8');
    },
  };
}

function startRequest(
  overrides: Partial<CommanderStartRequest> = {},
): CommanderStartRequest {
  return {
    authorizedCanvasIds: [],
    sessionId: 'session-1',
    intent: { kind: 'user_message', message: 'Safe public objective' },
    selectedNodes: [],
    permissionMode: 'normal',
    resourceBudget: {},
    workType: 'agent',
    ...overrides,
  };
}

function event(
  seq: number,
  body: Omit<TimelineEvent, 'runId' | 'step' | 'seq' | 'emittedAt'>,
  step = seq === 0 ? 0 : 1,
): TimelineEvent {
  return {
    ...body,
    runId: 'run-1',
    step,
    seq,
    emittedAt: 100 + seq,
  } as TimelineEvent;
}

function activeRun(workType: StoredCommanderRun['workType'] = 'agent'): StoredCommanderRun {
  return {
    id: 'run-1',
    sessionId: 'session-1' as StoredCommanderRun['sessionId'],
    authorizedCanvasIds: [],
    intent: 'Safe public objective',
    workType,
    status: 'running',
    acceptedAt: 100,
    startedAt: 100,
    lastSeq: 0,
    attachments: [],
  };
}

function runStart(): TimelineEvent {
  return event(0, {
    kind: 'run_start',
    intent: 'Safe public objective',
    resourceBudget: {},
    workType: 'agent',
  });
}

function catalog(seq = 1): Extract<TimelineEvent, { kind: 'catalog_frozen' }> {
  return event(seq, {
    kind: 'catalog_frozen',
    catalogHash: CATALOG_HASH,
    tools: [{
      name: 'asset.get',
      description: 'Read one asset',
      tier: 1,
      tags: [],
      contexts: [],
      inputSchemaHash: INPUT_HASH,
      outputSchemaHash: OUTPUT_HASH,
    }],
  }, 0) as Extract<TimelineEvent, { kind: 'catalog_frozen' }>;
}

function seed(): Extract<CommanderRecoveryRecord, { kind: 'run_seed' }> {
  return {
    kind: 'run_seed',
    workType: 'agent',
    startRequest: startRequest(),
    modelInput: sentinel,
  };
}

function catalogRecord() {
  return createCommanderCatalogRecoveryRecord(catalog());
}

function recoveryRows(
  events: readonly TimelineEvent[],
  privatePayloads: readonly Buffer[],
): StoredCommanderRunRecoveryEvent[] {
  return events.map((entry, index) => ({
    sessionId: 'session-1' as StoredCommanderRunRecoveryEvent['sessionId'],
    runId: entry.runId,
    seq: entry.seq,
    kind: entry.kind,
    step: entry.step,
    emittedAt: entry.emittedAt,
    payload: JSON.stringify(entry),
    privatePayload: privatePayloads[index] ?? null,
  }));
}

function resourceFixture() {
  let now = 0;
  const root = new RunResourceBudgetController({}, {
    leaseId: 'run-1',
    now: () => now,
  });
  const child = root.createLease({}, 'run-child');
  root.reserve('model:1', 'model', {
    tokens: { knowledge: 'known', value: 2, upperBound: true },
    toolCalls: 0,
    costUsd: { knowledge: 'known', value: 0, upperBound: true },
  });
  child.reserve('tool:1', 'tool', {
    tokens: { knowledge: 'known', value: 0, upperBound: true },
    toolCalls: 1,
    costUsd: { knowledge: 'known', value: 0, upperBound: true },
  });
  now = 5;
  const state = root.snapshot({ kind: 'initialized' });
  return {
    root,
    child,
    setNow(value: number) { now = value; },
    state,
    checkpoint: root.exportCheckpoint(),
  };
}

describe('Commander private recovery service', () => {
  it('encrypts a strict, start-schema-validated V1 seed without a plaintext fallback', () => {
    const codec = createSafeStorageCommanderRecoveryCodec(fakeSafeStorage());
    const sealed = sealCommanderRecoveryBatch(codec, null, [{ event: runStart(), record: seed() }]);
    const opened = openCommanderRecoveryPayload(codec, sealed.privatePayloads[0]!);

    expect(sealed.privatePayloads[0]?.toString('utf8')).not.toContain(sentinel);
    expect(opened).toMatchObject({
      kind: 'run_seed',
      modelInput: sentinel,
      startRequest: { sessionId: 'session-1', authorizedCanvasIds: [] },
    });
    expect(() => parseCommanderRecoveryPayloadV1({
      ...opened,
      plaintextFallback: sentinel,
    })).toThrow(/unrecognized|strict/i);
    expect(() => sealCommanderRecoveryBatch(codec, null, [{
      event: runStart(),
      record: {
        ...seed(),
        startRequest: { ...startRequest(), selectedNodes: [{ canvasId: 'outside', nodeId: 'n' }] },
      },
    }])).toThrow(/selectedNodes/i);
  });

  it('fails explicitly when platform encryption is unavailable or plaintext-backed', () => {
    expect(() => createSafeStorageCommanderRecoveryCodec(fakeSafeStorage(false)).assertAvailable())
      .toThrow(/encryption.*unavailable/i);
    expect(() => createSafeStorageCommanderRecoveryCodec({
      ...fakeSafeStorage(),
      getSelectedStorageBackend: () => 'basic_text',
    }).assertAvailable()).toThrow(/encryption.*unavailable/i);
  });

  it('accepts only bounded canonical JSON and excludes reasoning from model checkpoints', () => {
    const codec = createSafeStorageCommanderRecoveryCodec(fakeSafeStorage());
    const toolCall = event(2, {
      kind: 'tool_call', toolCallId: 'call-1',
      toolRef: { domain: 'asset', action: 'get' }, status: 'started',
    });
    const record = (args: Record<string, unknown>): CommanderRecoveryRecord => ({
      kind: 'tool_call', toolCallId: 'call-1', toolName: 'asset.get', effect: 'query', args,
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => sealCommanderRecoveryBatch(codec, CATALOG_HASH, [
      { event: toolCall, record: record({ missing: undefined }) },
    ])).toThrow(/undefined|invalid/i);
    expect(() => sealCommanderRecoveryBatch(codec, CATALOG_HASH, [
      { event: toolCall, record: record({ date: new Date() }) },
    ])).toThrow(/invalid|JSON/i);
    expect(() => sealCommanderRecoveryBatch(codec, CATALOG_HASH, [
      { event: toolCall, record: record(cyclic) },
    ])).toThrow(/cycles|invalid/i);
    expect(() => sealCommanderRecoveryBatch(codec, CATALOG_HASH, [
      { event: toolCall, record: record({ huge: 'x'.repeat(1_000_000) }) },
    ])).toThrow(/size limit/i);

    const checkpointEvent = event(3, {
      kind: 'public_progress', operationId: 'model:1', status: 'completed',
    });
    expect(() => sealCommanderRecoveryBatch(codec, CATALOG_HASH, [{
      event: checkpointEvent,
      record: {
        kind: 'model_checkpoint', content: 'done', finishReason: 'stop',
        toolCalls: [], completedStep: 1, reasoning: 'must never persist',
      } as never,
    }])).toThrow(/unrecognized|strict/i);
  });

  it('projects seed, history, completed steps, dedup seeds, and latest resources', () => {
    const codec = createSafeStorageCommanderRecoveryCodec(fakeSafeStorage());
    const resource = resourceFixture();
    const resourceState = event(1, resource.state, 0);
    const events = [
      runStart(),
      resourceState,
      event(2, { kind: 'user_message', content: 'Safe public objective' }, 0),
      catalog(3),
      event(4, { kind: 'public_progress', operationId: 'model:1', status: 'completed' }, 1),
      event(5, {
        kind: 'tool_call', toolCallId: 'call-1',
        toolRef: { domain: 'asset', action: 'get' }, status: 'started',
      }, 1),
      event(6, {
        kind: 'tool_result', toolCallId: 'call-1', status: 'succeeded', durationMs: 2,
      }, 1),
      event(7, { kind: 'user_message', content: 'Now summarize' }, 1),
      event(8, { kind: 'public_progress', operationId: 'model:2', status: 'completed' }, 2),
    ] as TimelineEvent[];
    const records: CommanderRecoveryRecord[] = [
      seed(),
      { kind: 'resource_checkpoint', checkpoint: resource.checkpoint },
      { kind: 'inbox', content: 'Safe public objective' },
      catalogRecord(),
      {
        kind: 'model_checkpoint', content: 'Inspecting', finishReason: 'tool_calls',
        toolCalls: [{
          id: 'call-1', name: 'asset.get', arguments: { id: sentinel },
          thoughtSignature: 'opaque-signature',
        }],
        completedStep: 1,
      },
      {
        kind: 'tool_call', toolCallId: 'call-1', toolName: 'asset.get',
        args: { id: sentinel }, effect: 'query',
      },
      { kind: 'tool_result', toolCallId: 'call-1', result: { success: true, data: { id: 'asset-1' } } },
      { kind: 'inbox', content: 'Now summarize' },
      {
        kind: 'model_checkpoint', content: 'Final summary', finishReason: 'stop',
        toolCalls: [], completedStep: 2,
      },
    ];
    const sealed = sealCommanderRecoveryBatch(
      codec,
      null,
      events.map((entry, index) => ({ event: entry, record: records[index]! })),
    );

    expect(projectCommanderRecovery(
      { ...activeRun(), lastSeq: 8 },
      recoveryRows(events, sealed.privatePayloads),
      codec,
      catalogRecord(),
    )).toMatchObject({
      state: 'resumable',
      runId: 'run-1',
      seed: { modelInput: sentinel, startRequest: { sessionId: 'session-1' } },
      completedSteps: [1, 2],
      history: [
        { role: 'user', content: sentinel },
        {
          role: 'assistant', content: 'Inspecting',
          toolCalls: [{
            id: 'call-1', name: 'asset.get', arguments: { id: sentinel },
            thoughtSignature: 'opaque-signature',
          }],
        },
        { role: 'tool', content: '{"data":{"id":"asset-1"},"success":true}', toolCallId: 'call-1' },
        { role: 'user', content: 'Now summarize' },
        { role: 'assistant', content: 'Final summary' },
      ],
      dedupSeeds: [{
        toolRef: { domain: 'asset', action: 'get' }, args: { id: sentinel },
        toolCallId: 'call-1', step: 1, wasError: false,
      }],
      resourceState,
      resourceCheckpoint: resource.checkpoint,
      lastSeq: 8,
    });
  });

  it('uses the latest shared resource checkpoint and rejects missing or mismatched state', () => {
    const codec = createSafeStorageCommanderRecoveryCodec(fakeSafeStorage());
    const resource = resourceFixture();
    const first = event(1, resource.state, 0);
    resource.child.settle('tool:1', 'tool', {
      tokens: { knowledge: 'known', value: 0 },
      toolCalls: 1,
      costUsd: { knowledge: 'known', value: 0 },
    });
    resource.setNow(8);
    const latestState = resource.root.snapshot({
      kind: 'settled', operationId: 'tool:1', source: 'tool',
    });
    const latestCheckpoint = resource.root.exportCheckpoint();
    const latest = event(2, latestState, 0);
    const events = [runStart(), first, latest, catalog(3)];
    const records: CommanderRecoveryRecord[] = [
      seed(),
      { kind: 'resource_checkpoint', checkpoint: resource.checkpoint },
      { kind: 'resource_checkpoint', checkpoint: latestCheckpoint },
      catalogRecord(),
    ];
    const sealed = sealCommanderRecoveryBatch(
      codec,
      null,
      events.map((entry, index) => ({ event: entry, record: records[index]! })),
    );

    expect(projectCommanderRecovery(
      { ...activeRun(), lastSeq: 3 }, recoveryRows(events, sealed.privatePayloads),
      codec, catalogRecord(),
    )).toMatchObject({ state: 'resumable', resourceCheckpoint: latestCheckpoint });

    const missing = sealCommanderRecoveryBatch(codec, null, [
      { event: runStart(), record: seed() },
      { event: first, record: { kind: 'boundary' } },
      { event: catalog(2), record: catalogRecord() },
    ]);
    expect(projectCommanderRecovery(
      { ...activeRun(), lastSeq: 2 },
      recoveryRows([runStart(), first, catalog(2)], missing.privatePayloads),
      codec, catalogRecord(),
    )).toMatchObject({
      state: 'recovery_required', reason: 'resource_checkpoint_private_payload_missing',
    });

    const altered = {
      ...resource.state,
      usage: { ...resource.state.usage, toolCalls: resource.state.usage.toolCalls + 1 },
    };
    const mismatchedEvent = event(1, altered, 0);
    const mismatched = sealCommanderRecoveryBatch(codec, null, [
      { event: runStart(), record: seed() },
      {
        event: mismatchedEvent,
        record: { kind: 'resource_checkpoint', checkpoint: resource.checkpoint },
      },
      { event: catalog(2), record: catalogRecord() },
    ]);
    expect(projectCommanderRecovery(
      { ...activeRun(), lastSeq: 2 },
      recoveryRows([runStart(), mismatchedEvent, catalog(2)], mismatched.privatePayloads),
      codec, catalogRecord(),
    )).toMatchObject({
      state: 'recovery_required', reason: 'resource_checkpoint_public_state_mismatch',
    });

    expect(() => sealCommanderRecoveryBatch(codec, null, [{
      event: first,
      record: {
        kind: 'resource_checkpoint',
        checkpoint: { ...resource.checkpoint, args: sentinel },
      } as never,
    }])).toThrow(/unsupported field args|invalid resource checkpoint/i);
  });

  it('distinguishes old terminal rows, legacy active rows, and a broken private chain', () => {
    const codec = createSafeStorageCommanderRecoveryCodec(fakeSafeStorage());
    const events = [runStart(), catalog(1)];
    const rows = recoveryRows(events, []);
    expect(projectCommanderRecovery(
      { ...activeRun(), status: 'completed', completedAt: 200, lastSeq: 1 },
      rows,
      codec,
      catalogRecord(),
    )).toMatchObject({ state: 'terminal', status: 'completed' });
    expect(projectCommanderRecovery(
      { ...activeRun(), lastSeq: 1 }, rows, codec, catalogRecord(),
    )).toMatchObject({ state: 'legacy_interrupted' });

    const sealed = sealCommanderRecoveryBatch(codec, null, [
      { event: events[0]!, record: seed() },
      { event: events[1]!, record: catalogRecord() },
    ]);
    const broken = recoveryRows(events, sealed.privatePayloads);
    broken[1]!.privatePayload = null;
    expect(projectCommanderRecovery(
      { ...activeRun(), lastSeq: 1 }, broken, codec, catalogRecord(),
    )).toMatchObject({ state: 'recovery_required', reason: 'private_payload_chain_incomplete' });
  });

  it('reads retry input only from a fully verified private run seed chain', () => {
    const codec = createSafeStorageCommanderRecoveryCodec(fakeSafeStorage());
    const events = [runStart(), catalog(1)];
    const sealed = sealCommanderRecoveryBatch(codec, null, [
      { event: events[0]!, record: seed() },
      { event: events[1]!, record: catalogRecord() },
    ]);
    const source = {
      ...activeRun(), status: 'failed' as const, completedAt: 200, lastSeq: 1,
    };
    const rows = recoveryRows(events, sealed.privatePayloads);

    expect(readVerifiedCommanderRecoverySeed(source, rows, codec)).toEqual(seed());
    rows[1]!.payload = JSON.stringify({ ...events[1], emittedAt: 999 });
    expect(() => readVerifiedCommanderRecoverySeed(source, rows, codec)).toThrow(/invalid/i);
  });

  it.each(['query', 'mutation', 'metered', 'tool_program'] as const)(
    'requires recovery instead of replaying any unmatched %s call',
    (effect) => {
      const codec = createSafeStorageCommanderRecoveryCodec(fakeSafeStorage());
      const events = [
        runStart(),
        catalog(1),
        event(2, { kind: 'public_progress', operationId: 'model:1', status: 'completed' }),
        event(3, {
          kind: 'tool_call', toolCallId: 'call-1',
          toolRef: { domain: 'canvas', action: 'mutate' }, status: 'started',
        }),
      ] as TimelineEvent[];
      const sealed = sealCommanderRecoveryBatch(codec, null, [
        { event: events[0]!, record: seed() },
        { event: events[1]!, record: catalogRecord() },
        {
          event: events[2]!,
          record: {
            kind: 'model_checkpoint', content: '', finishReason: 'tool_calls',
            toolCalls: [{ id: 'call-1', name: 'canvas.mutate', arguments: { secret: sentinel } }],
            completedStep: 1,
          },
        },
        {
          event: events[3]!,
          record: {
            kind: 'tool_call', toolCallId: 'call-1', toolName: 'canvas.mutate',
            args: { secret: sentinel }, effect,
          },
        },
      ]);

      expect(projectCommanderRecovery(
        { ...activeRun(), lastSeq: 3 },
        recoveryRows(events, sealed.privatePayloads),
        codec,
        catalogRecord(),
      )).toMatchObject({
        state: 'recovery_required', reason: 'orphan_tool_call', orphanToolCallId: 'call-1',
      });
    },
  );

  it('requires a private canonical result for every public tool result', () => {
    const codec = createSafeStorageCommanderRecoveryCodec(fakeSafeStorage());
    const events = [
      runStart(),
      catalog(1),
      event(2, { kind: 'public_progress', operationId: 'model:1', status: 'completed' }),
      event(3, {
        kind: 'tool_call', toolCallId: 'call-1',
        toolRef: { domain: 'asset', action: 'get' }, status: 'started',
      }),
      event(4, { kind: 'tool_result', toolCallId: 'call-1', status: 'succeeded' }),
    ] as TimelineEvent[];
    const sealed = sealCommanderRecoveryBatch(codec, null, [
      { event: events[0]!, record: seed() },
      { event: events[1]!, record: catalogRecord() },
      {
        event: events[2]!, record: {
          kind: 'model_checkpoint', content: '', finishReason: 'tool_calls',
          toolCalls: [{ id: 'call-1', name: 'asset.get', arguments: {} }], completedStep: 1,
        },
      },
      {
        event: events[3]!, record: {
          kind: 'tool_call', toolCallId: 'call-1', toolName: 'asset.get', args: {}, effect: 'query',
        },
      },
      { event: events[4]!, record: { kind: 'boundary' } },
    ]);

    expect(projectCommanderRecovery(
      { ...activeRun(), lastSeq: 4 }, recoveryRows(events, sealed.privatePayloads),
      codec, catalogRecord(),
    )).toMatchObject({ state: 'recovery_required', reason: 'tool_result_private_payload_missing' });
  });

  it('rejects missing, internally mismatched, and current catalog schema hashes', () => {
    const codec = createSafeStorageCommanderRecoveryCodec(fakeSafeStorage());
    const events = [runStart(), catalog(1)];

    const mismatched = sealCommanderRecoveryBatch(codec, null, [
      { event: events[0]!, record: seed() },
      {
        event: events[1]!,
        record: {
          ...catalogRecord(),
          toolSchemaHashes: {
            'asset.get': { inputSchemaHash: OTHER_HASH, outputSchemaHash: OUTPUT_HASH },
          },
        },
      },
    ]);
    expect(projectCommanderRecovery(
      { ...activeRun(), lastSeq: 1 }, recoveryRows(events, mismatched.privatePayloads),
      codec, catalogRecord(),
    )).toMatchObject({ state: 'recovery_required', reason: 'catalog_schema_hash_mismatch' });

    const valid = sealCommanderRecoveryBatch(codec, null, [
      { event: events[0]!, record: seed() },
      { event: events[1]!, record: catalogRecord() },
    ]);
    expect(projectCommanderRecovery(
      { ...activeRun(), lastSeq: 1 }, recoveryRows(events, valid.privatePayloads), codec,
      { ...catalogRecord(), catalogHash: OTHER_HASH },
    )).toMatchObject({ state: 'recovery_required', reason: 'catalog_drift' });

    const missingOutput = catalog(1);
    delete missingOutput.tools[0]!.outputSchemaHash;
    const missingEvents = [runStart(), missingOutput];
    const missing = sealCommanderRecoveryBatch(codec, null, [
      { event: missingEvents[0]!, record: seed() },
      { event: missingEvents[1]!, record: catalogRecord() },
    ]);
    expect(projectCommanderRecovery(
      { ...activeRun(), lastSeq: 1 }, recoveryRows(missingEvents, missing.privatePayloads),
      codec, catalogRecord(),
    )).toMatchObject({ state: 'recovery_required', reason: 'catalog_schema_hash_missing' });
  });
});
