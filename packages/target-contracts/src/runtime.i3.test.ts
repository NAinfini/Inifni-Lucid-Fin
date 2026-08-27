import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CapabilityCatalogSnapshotV1Schema } from './capability-catalog.js';
import { canonicalJson } from './canonical.js';
import {
  AgentSendDurableInputSchema,
  AgentSpawnDurableInputSchema,
  CanonicalModelRequestV1Schema,
  CanonicalModelResponseV1Schema,
  DurableCanonicalModelResponseV1Schema,
  ModelAdapterEventSchema,
  ModelAttemptRecordV1Schema,
  ModelResourceQuoteV1Schema,
  RuntimeLoopOutcomeSchema,
  ToolProgramDurableInputSchema,
  canonicalModelRequestHashInput,
  canonicalModelResponseHashInput,
  durableCanonicalModelResponseHashInput,
  runtimeLoopOutcomeHashInput,
} from './runtime.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);

function sha256(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input), 'utf8').digest('hex');
}

async function requestFixture() {
  const catalog = CapabilityCatalogSnapshotV1Schema.parse(
    JSON.parse(
      await readFile(new URL('../generated/tool-catalog.v1.json', import.meta.url), 'utf8'),
    ),
  );
  return CanonicalModelRequestV1Schema.parse({
    version: 1,
    runId: 'run.i3',
    modelAttemptId: 'model-attempt.i3.1',
    activationId: 'activation.i3.1',
    activationNumber: 1,
    attemptNumber: 1,
    provider: {
      providerId: 'provider.fake',
      model: 'fake-commander',
      reasoningStrength: null,
    },
    runRevision: 3,
    runContentHash: HASH_D,
    contextManifest: { id: 'manifest.i3', hash: HASH_A },
    capabilityCatalog: { id: 'catalog.i3', hash: catalog.catalogHash },
    eventHead: { sequence: 3, hash: HASH_B },
    compactionView: null,
    facts: [
      {
        type: 'message',
        eventSequence: 1,
        messageId: 'message.user.1',
        role: 'user',
        messageHash: HASH_C,
        blocks: [{ type: 'text', text: 'Inspect this Project.' }],
        attachments: [],
      },
      {
        type: 'tool_call',
        eventSequence: 2,
        dispatchOperationId: 'dispatch.tool-get.1',
        providerCallId: 'provider-call-1',
        toolId: 'tool.get',
        canonicalArguments: { names: ['project.get'] },
        argumentsHash: HASH_D,
      },
      {
        type: 'tool_result',
        eventSequence: 3,
        dispatchOperationId: 'dispatch.tool-get.1',
        providerCallId: 'provider-call-1',
        toolId: 'tool.get',
        outcome: { status: 'succeeded', data: { tools: [] } },
        outcomeHash: HASH_A,
      },
    ],
    capabilityIndex: catalog.capabilityIndex,
    skillIndex: [],
    materializedTools: [catalog.tools.find(({ id }) => id === 'tool.get')],
    locale: 'en-US',
    timeZone: 'UTC',
    limits: { maxInputTokens: 32_000, maxOutputTokens: 4_000 },
    reasoningStrength: null,
    systemPromptVersion: 'commander-minimal-v1',
  });
}

const USAGE = {
  inputTokens: { state: 'known' as const, value: 120 },
  outputTokens: { state: 'known' as const, value: 24 },
  cost: { state: 'estimated' as const, value: '0.01', currency: 'USD' },
};

const RESPONSE = {
  version: 1 as const,
  events: [
    { type: 'assistant_delta' as const, publicText: 'I will inspect the Project.' },
    {
      type: 'tool_call' as const,
      providerCallId: 'provider-call-1',
      toolId: 'project.get' as const,
      canonicalArguments: { projectId: 'project.i3' },
    },
    { type: 'usage' as const, usage: USAGE },
    { type: 'model_completed' as const, finishReason: 'tool_calls' as const },
  ],
};

describe('I3 canonical runtime contracts', () => {
  it('binds every model request to the exact durable Run snapshot', async () => {
    const request = await requestFixture();
    expect(request.runRevision).toBe(3);
    expect(request.runContentHash).toBe(HASH_D);
    expect(CanonicalModelRequestV1Schema.safeParse({ ...request, runRevision: -1 }).success).toBe(
      false,
    );
    expect(
      CanonicalModelRequestV1Schema.safeParse({ ...request, runContentHash: 'not-a-hash' }).success,
    ).toBe(false);
  });

  it('keeps a model agent.spawn objective out of the durable response shape', async () => {
    const request = await requestFixture();
    const raw = CanonicalModelResponseV1Schema.parse({
      version: 1,
      events: [
        {
          type: 'tool_call',
          providerCallId: 'provider-call.spawn',
          toolId: 'agent.spawn',
          canonicalArguments: {
            displayName: 'Private comparison',
            objective: 'SENTINEL_PRIVATE_OBJECTIVE',
            publicSummary: 'Compare the selected shots.',
            contextRefs: [],
            toolAllowlist: null,
            permissionCeiling: null,
            budgetCaps: null,
            expectedParentRevision: request.runRevision,
          },
        },
        { type: 'usage', usage: USAGE },
        { type: 'model_completed', finishReason: 'tool_calls' },
      ],
    });
    const safeInput = AgentSpawnDurableInputSchema.parse({
      displayName: 'Private comparison',
      objectiveHash: createHash('sha256')
        .update('SENTINEL_PRIVATE_OBJECTIVE', 'utf8')
        .digest('hex'),
      publicSummary: 'Compare the selected shots.',
      contextRefs: [],
      toolAllowlist: null,
      permissionCeiling: null,
      budgetCaps: null,
      expectedParentRevision: request.runRevision,
    });
    const durable = DurableCanonicalModelResponseV1Schema.parse({
      ...raw,
      events: raw.events.map((event) =>
        event.type === 'tool_call' ? { ...event, canonicalArguments: safeInput } : event,
      ),
    });
    expect(JSON.stringify(durable)).not.toContain('SENTINEL_PRIVATE_OBJECTIVE');
    expect(DurableCanonicalModelResponseV1Schema.safeParse(raw).success).toBe(false);
    expect(
      AgentSpawnDurableInputSchema.safeParse({ ...safeInput, objective: 'private' }).success,
    ).toBe(false);
    expect(() =>
      ModelAttemptRecordV1Schema.parse({
        id: 'model-attempt.spawn.1',
        runId: request.runId,
        activationId: request.activationId,
        attemptNumber: request.attemptNumber,
        provider: request.provider,
        state: 'succeeded',
        request,
        requestHash: sha256(canonicalModelRequestHashInput(request)),
        response: raw,
        responseHash: sha256(canonicalModelResponseHashInput(raw)),
        usage: USAGE,
        createdAt: '2026-08-15T00:00:00.000Z',
        finishedAt: '2026-08-15T00:00:01.000Z',
      }),
    ).toThrow();
    expect(sha256(durableCanonicalModelResponseHashInput(durable))).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps a model agent.send direction out of the durable response shape', () => {
    const raw = CanonicalModelResponseV1Schema.parse({
      version: 1,
      events: [
        {
          type: 'tool_call',
          providerCallId: 'provider-call.send',
          toolId: 'agent.send',
          canonicalArguments: {
            childRunId: 'run.child.private',
            expectedChildRevision: 3,
            message: 'SENTINEL_PRIVATE_AGENT_SEND_DIRECTION',
            contextRefs: [],
          },
        },
        { type: 'usage', usage: USAGE },
        { type: 'model_completed', finishReason: 'tool_calls' },
      ],
    });
    const safeInput = AgentSendDurableInputSchema.parse({
      childRunId: 'run.child.private',
      expectedChildRevision: 3,
      messageHash: createHash('sha256')
        .update('SENTINEL_PRIVATE_AGENT_SEND_DIRECTION', 'utf8')
        .digest('hex'),
      contextRefs: [],
    });
    const durable = DurableCanonicalModelResponseV1Schema.parse({
      ...raw,
      events: raw.events.map((event) =>
        event.type === 'tool_call' ? { ...event, canonicalArguments: safeInput } : event,
      ),
    });

    expect(JSON.stringify(durable)).not.toContain('SENTINEL_PRIVATE_AGENT_SEND_DIRECTION');
    expect(DurableCanonicalModelResponseV1Schema.safeParse(raw).success).toBe(false);
    expect(
      AgentSendDurableInputSchema.safeParse({ ...safeInput, message: 'private' }).success,
    ).toBe(false);
  });

  it('keeps a versioned tool.program AST out of the durable response shape', async () => {
    const request = await requestFixture();
    const program = {
      version: 1,
      displayName: 'Private history lookup',
      expectedRunRevision: request.runRevision,
      contextRefs: [],
      steps: [
        {
          stepId: 'step.history',
          operation: 'call',
          invocation: {
            toolId: 'history.query',
            toolVersion: '1.0.0',
            input: {
              sources: ['message'],
              eventTypes: [],
              subjects: [],
              actors: [],
              time: { from: null, to: null },
              page: { cursor: null, limit: 20 },
            },
          },
        },
      ],
    };
    const raw = CanonicalModelResponseV1Schema.parse({
      version: 1,
      events: [
        {
          type: 'tool_call',
          providerCallId: 'provider-call.program',
          toolId: 'tool.program',
          canonicalArguments: program,
        },
        { type: 'usage', usage: USAGE },
        { type: 'model_completed', finishReason: 'tool_calls' },
      ],
    });
    const safeInput = ToolProgramDurableInputSchema.parse({
      version: 1,
      displayName: program.displayName,
      expectedRunRevision: program.expectedRunRevision,
      contextRefs: program.contextRefs,
      programHash: sha256(program),
      calls: [
        {
          stepId: 'step.history',
          callIndex: 0,
          toolId: 'history.query',
          toolVersion: '1.0.0',
          inputHash: sha256(program.steps[0]!.invocation.input),
        },
      ],
    });
    const durable = DurableCanonicalModelResponseV1Schema.parse({
      ...raw,
      events: raw.events.map((event) =>
        event.type === 'tool_call' ? { ...event, canonicalArguments: safeInput } : event,
      ),
    });

    expect(JSON.stringify(durable)).not.toContain('sources');
    expect(DurableCanonicalModelResponseV1Schema.safeParse(raw).success).toBe(false);
    expect(
      ToolProgramDurableInputSchema.safeParse({
        ...safeInput,
        calls: [{ ...safeInput.calls[0], input: program.steps[0]!.invocation.input }],
      }).success,
    ).toBe(false);
  });

  it('hashes every durable request fact while excluding transient and secret-bearing fields', async () => {
    const request = await requestFixture();
    const preimage = canonicalModelRequestHashInput(request);
    const firstHash = sha256(preimage);

    expect(
      sha256(
        canonicalModelRequestHashInput({
          ...request,
          eventHead: { ...request.eventHead, hash: HASH_C },
        }),
      ),
    ).not.toBe(firstHash);
    expect(
      sha256(
        canonicalModelRequestHashInput({
          ...request,
          facts: request.facts.map((fact, index) =>
            index === 0 && fact.type === 'message'
              ? { ...fact, blocks: [{ type: 'text' as const, text: 'Changed durable text.' }] }
              : fact,
          ),
        }),
      ),
    ).not.toBe(firstHash);

    for (const forbidden of [
      'abortSignal',
      'clock',
      'credential',
      'rawProviderBody',
      'requestHook',
    ]) {
      expect(
        CanonicalModelRequestV1Schema.safeParse({ ...request, [forbidden]: 'private' }).success,
      ).toBe(false);
    }
    expect(request.capabilityIndex).toHaveLength(40);
    expect(request.skillIndex).toEqual([]);
    expect(request.materializedTools.map(({ id }) => id)).toEqual(['tool.get']);
    expect(() =>
      CanonicalModelRequestV1Schema.parse({
        ...request,
        facts: [request.facts[1], request.facts[0], request.facts[2]],
      }),
    ).toThrow();
  });

  it('accepts only a hash-bound parent direction reference as a child model fact', async () => {
    const request = await requestFixture();
    const parentDirection = {
      type: 'parent_direction' as const,
      eventSequence: 1,
      inboxMessageId: 'inbox.child.1',
      parentRunId: 'run.parent.1',
      parentEventId: 'event.parent.1',
      directionHash: HASH_A,
    };
    expect(
      CanonicalModelRequestV1Schema.parse({ ...request, facts: [parentDirection] }).facts,
    ).toEqual([parentDirection]);
    expect(
      CanonicalModelRequestV1Schema.safeParse({
        ...request,
        facts: [{ ...parentDirection, objective: 'Private child objective.' }],
      }).success,
    ).toBe(false);
  });

  it('accepts only a sorted metadata-only Skill index', async () => {
    const request = await requestFixture();
    const first = {
      id: 'skill.alpha',
      name: 'Alpha review',
      description: 'Review alpha evidence.',
      version: '1.0.0',
      contentHash: HASH_A,
      provenance: 'installed' as const,
      trust: 'reviewed' as const,
    };
    const second = { ...first, id: 'skill.beta', name: 'Beta review', contentHash: HASH_B };
    expect(
      CanonicalModelRequestV1Schema.parse({ ...request, skillIndex: [first, second] }),
    ).toMatchObject({ skillIndex: [first, second] });
    expect(
      CanonicalModelRequestV1Schema.safeParse({
        ...request,
        skillIndex: [{ ...first, content: 'Hidden instructions must not be indexed.' }],
      }).success,
    ).toBe(false);
    expect(
      CanonicalModelRequestV1Schema.safeParse({ ...request, skillIndex: [second, first] }).success,
    ).toBe(false);
  });

  it('normalizes only public adapter events and produces one terminal canonical response', () => {
    const response = CanonicalModelResponseV1Schema.parse(RESPONSE);
    const responseHash = sha256(canonicalModelResponseHashInput(response));
    expect(
      sha256(
        canonicalModelResponseHashInput({
          ...response,
          events: response.events.map((event, index) =>
            index === 0 && event.type === 'assistant_delta'
              ? { ...event, publicText: 'Changed public text.' }
              : event,
          ),
        }),
      ),
    ).not.toBe(responseHash);

    for (const forbidden of ['reasoning', 'thought', 'rawBody', 'headers', 'credential', 'stack']) {
      expect(
        ModelAdapterEventSchema.safeParse({
          type: 'assistant_delta',
          publicText: 'Visible text.',
          [forbidden]: 'private',
        }).success,
      ).toBe(false);
    }
    expect(
      ModelAdapterEventSchema.parse({
        type: 'model_checkpoint',
        continuation: { state: 'unavailable', reason: 'not_persisted' },
      }),
    ).toEqual({
      type: 'model_checkpoint',
      continuation: { state: 'unavailable', reason: 'not_persisted' },
    });
    expect(
      ModelAdapterEventSchema.parse({
        type: 'model_failed',
        typedCode: 'process_interrupted',
        retrySafety: 'never',
        providerState: 'unknown',
      }),
    ).toMatchObject({ typedCode: 'process_interrupted' });
    expect(() =>
      CanonicalModelResponseV1Schema.parse({
        ...RESPONSE,
        events: [...RESPONSE.events, { type: 'assistant_delta', publicText: 'Too late.' }],
      }),
    ).toThrow();
    expect(() =>
      CanonicalModelResponseV1Schema.parse({
        ...RESPONSE,
        events: RESPONSE.events.filter(({ type }) => type !== 'usage'),
      }),
    ).toThrow();
    expect(() =>
      CanonicalModelResponseV1Schema.parse({
        ...RESPONSE,
        events: [RESPONSE.events[1], RESPONSE.events[1], RESPONSE.events[2], RESPONSE.events[3]],
      }),
    ).toThrow();
    expect(() =>
      CanonicalModelResponseV1Schema.parse({
        ...RESPONSE,
        events: [
          RESPONSE.events[1],
          RESPONSE.events[2],
          {
            type: 'model_failed',
            typedCode: 'provider_state_unknown',
            retrySafety: 'receipt_reconcile_only',
            providerState: 'unknown',
          },
        ],
      }),
    ).toThrow();
  });

  it('binds model attempt state to its canonical request, response, usage, and finish boundary', async () => {
    const request = await requestFixture();
    const response = CanonicalModelResponseV1Schema.parse(RESPONSE);
    const requestHash = sha256(canonicalModelRequestHashInput(request));
    const responseHash = sha256(canonicalModelResponseHashInput(response));

    const record = ModelAttemptRecordV1Schema.parse({
      id: 'model-attempt.i3.1',
      runId: request.runId,
      activationId: request.activationId,
      attemptNumber: request.attemptNumber,
      provider: request.provider,
      state: 'succeeded',
      request,
      requestHash,
      response,
      responseHash,
      usage: USAGE,
      createdAt: '2026-08-15T00:00:00.000Z',
      finishedAt: '2026-08-15T00:00:01.000Z',
    });
    expect(record.state).toBe('succeeded');
    expect(() => ModelAttemptRecordV1Schema.parse({ ...record, finishedAt: null })).toThrow();
    expect(() => ModelAttemptRecordV1Schema.parse({ ...record, response: null })).toThrow();
    expect(() => ModelAttemptRecordV1Schema.parse({ ...record, runId: 'run.other' })).toThrow();
    expect(() =>
      ModelAttemptRecordV1Schema.parse({
        ...record,
        usage: { ...USAGE, outputTokens: { state: 'known', value: 25 } },
      }),
    ).toThrow();
  });

  it('keeps quotes and normalized loop outcomes strict and hashable', () => {
    expect(ModelResourceQuoteV1Schema.parse(USAGE)).toEqual(USAGE);
    const outcome = RuntimeLoopOutcomeSchema.parse({
      status: 'succeeded',
      data: { project: { id: 'project.i3', revision: 0 } },
    });
    expect(sha256(runtimeLoopOutcomeHashInput(outcome))).toMatch(/^[a-f0-9]{64}$/);
    expect(RuntimeLoopOutcomeSchema.safeParse({ status: 'invented', data: {} }).success).toBe(
      false,
    );
    expect(
      RuntimeLoopOutcomeSchema.safeParse({ ...outcome, rawProviderBody: 'private' }).success,
    ).toBe(false);
    for (const schema of [
      CanonicalModelRequestV1Schema,
      ModelResourceQuoteV1Schema,
      ModelAdapterEventSchema,
      CanonicalModelResponseV1Schema,
      ModelAttemptRecordV1Schema,
      RuntimeLoopOutcomeSchema,
    ]) {
      expect(() =>
        z.toJSONSchema(schema, { io: 'output', unrepresentable: 'throw' }),
      ).not.toThrow();
    }
  });
});
