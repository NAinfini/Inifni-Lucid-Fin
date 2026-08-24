import { describe, expect, it } from 'vitest';
import { parseStrict } from '../../parse.js';
import {
  CommanderContextCacheSchema,
  CommanderStreamPayloadSchema,
  commanderCancelChannel,
  commanderEventsHydrateChannel,
  commanderRunControlChannel,
  commanderRunTreeChannel,
  commanderStartChannel,
  commanderToolAnswerChannel,
  commanderToolDecisionChannel,
} from './batch-09.js';

describe('commander tool-action IPC contracts', () => {
  it('accepts only the quick-ACK start and run-keyed control contracts', () => {
    expect(
      parseStrict(
        commanderStartChannel.schemas.response,
        { runId: 'run-1', sessionId: 'session-1', acceptedAt: 10 },
        { name: 'commander:start.response' },
      ),
    ).toEqual({ runId: 'run-1', sessionId: 'session-1', acceptedAt: 10 });
    expect(() =>
      parseStrict(
        commanderCancelChannel.schemas.request,
        { canvasId: 'canvas-1' },
        { name: 'commander:cancel.request' },
      ),
    ).toThrow();
    expect(
      parseStrict(
        commanderEventsHydrateChannel.schemas.request,
        { runId: 'run-1', afterSeq: 3 },
        { name: 'commander:events:hydrate.request' },
      ),
    ).toEqual({ runId: 'run-1', afterSeq: 3 });
  });

  it('keeps the context window and output limits as separate start fields', () => {
    expect(
      parseStrict(
        commanderStartChannel.schemas.request,
        {
          defaultCanvasId: 'canvas-1',
          authorizedCanvasIds: ['canvas-1'],
          sessionId: 'session-1',
          intent: { kind: 'user_message', message: 'Plan a scene' },
          selectedNodes: [],
          contextWindowTokens: 120_000,
          maxOutputTokens: 4_096,
        },
        { name: 'commander:start.request' },
      ),
    ).toMatchObject({ contextWindowTokens: 120_000, maxOutputTokens: 4_096 });
  });

  it('accepts typed execution-unit metadata and rejects invalid root/child shapes', () => {
    const base = {
      authorizedCanvasIds: ['canvas-1'],
      sessionId: 'session-1',
      intent: { kind: 'user_message' as const, message: 'Inspect continuity' },
      selectedNodes: [],
    };

    expect(
      parseStrict(
        commanderStartChannel.schemas.request,
        {
          ...base,
          workType: 'subagent',
          parentRunId: 'run-parent',
          displayName: 'Continuity review',
          objective: 'Find continuity conflicts without changing the Canvas.',
        },
        { name: 'commander:start.request' },
      ),
    ).toMatchObject({ workType: 'subagent', parentRunId: 'run-parent' });

    expect(() =>
      parseStrict(
        commanderStartChannel.schemas.request,
        { ...base, workType: 'subagent' },
        { name: 'commander:start.request' },
      ),
    ).toThrow();
    expect(() =>
      parseStrict(
        commanderStartChannel.schemas.request,
        { ...base, workType: 'agent', parentRunId: 'run-parent' },
        { name: 'commander:start.request' },
      ),
    ).toThrow();
  });

  it('defines strict unified run-control and stable tree contracts', () => {
    expect(
      parseStrict(
        commanderRunControlChannel.schemas.request,
        { runId: 'run-1', action: 'message', message: 'Check the final shot.' },
        { name: 'commander:run:control.request' },
      ),
    ).toEqual({ runId: 'run-1', action: 'message', message: 'Check the final shot.' });
    expect(() =>
      parseStrict(
        commanderRunControlChannel.schemas.request,
        { runId: 'run-1', action: 'message' },
        { name: 'commander:run:control.request' },
      ),
    ).toThrow();
    expect(() =>
      parseStrict(
        commanderRunControlChannel.schemas.request,
        { runId: 'run-1', action: 'pause', message: 'hidden instruction' },
        { name: 'commander:run:control.request' },
      ),
    ).toThrow();

    expect(
      parseStrict(
        commanderRunControlChannel.schemas.response,
        {
          accepted: false,
          action: 'pause',
          runId: 'run-1',
          affectedRunIds: [],
          code: 'runtime_unavailable',
        },
        { name: 'commander:run:control.response' },
      ),
    ).toMatchObject({ accepted: false, code: 'runtime_unavailable' });
    expect(
      parseStrict(
        commanderRunTreeChannel.schemas.request,
        { sessionId: 'session-1' },
        { name: 'commander:run:tree.request' },
      ),
    ).toEqual({ sessionId: 'session-1' });
  });

  it('accepts zero-valued resource budgets and rejects invalid start budget fields', () => {
    const request = {
      authorizedCanvasIds: [],
      sessionId: 'session-1',
      intent: { kind: 'user_message' as const, message: 'Plan a scene' },
      selectedNodes: [],
    };
    const resourceBudget = {
      maxTokens: 0,
      maxToolCalls: 0,
      maxWallTimeMs: 0,
      maxCostUsd: 0,
    };

    expect(
      parseStrict(
        commanderStartChannel.schemas.request,
        { ...request, resourceBudget, continuationOfRunId: 'run-previous' },
        { name: 'commander:start.request' },
      ),
    ).toMatchObject({ resourceBudget, continuationOfRunId: 'run-previous' });

    for (const invalidBudget of [
      { maxTokens: -1 },
      { maxTokens: Number.NaN },
      { maxCostUsd: Number.POSITIVE_INFINITY },
      { maxToolCalls: 0.5 },
      { maxWallTimeMs: Number.MAX_SAFE_INTEGER + 1 },
      { maxTokens: 0, extra: true },
    ]) {
      expect(() =>
        parseStrict(
          commanderStartChannel.schemas.request,
          { ...request, resourceBudget: invalidBudget },
          { name: 'commander:start.request' },
        ),
      ).toThrow();
    }
    expect(() =>
      parseStrict(
        commanderStartChannel.schemas.request,
        { ...request, maxSteps: 0 },
        { name: 'commander:start.request' },
      ),
    ).toThrow();
  });

  it('rejects renderer-owned conversation history as a second model-context source', () => {
    expect(() =>
      parseStrict(
        commanderStartChannel.schemas.request,
        {
          authorizedCanvasIds: [],
          sessionId: 'session-1',
          intent: { kind: 'user_message', message: 'Plan a scene' },
          selectedNodes: [],
          history: [{ role: 'user', content: 'stale renderer copy' }],
        },
        { name: 'commander:start.request' },
      ),
    ).toThrow();
  });

  it('preserves authorization order, removes exact duplicates, and binds the default Canvas', () => {
    const base = {
      sessionId: 'session-1',
      intent: { kind: 'user_message', message: 'Plan a scene' },
      selectedNodes: [],
    };
    expect(
      parseStrict(
        commanderStartChannel.schemas.request,
        {
          ...base,
          defaultCanvasId: 'canvas-2',
          authorizedCanvasIds: ['canvas-2', 'canvas-1', 'canvas-2'],
        },
        { name: 'commander:start.request' },
      ),
    ).toMatchObject({
      defaultCanvasId: 'canvas-2',
      authorizedCanvasIds: ['canvas-2', 'canvas-1'],
    });
    expect(
      parseStrict(
        commanderStartChannel.schemas.request,
        { ...base, authorizedCanvasIds: [] },
        { name: 'commander:start.request' },
      ),
    ).toMatchObject({ authorizedCanvasIds: [] });
    expect(() =>
      parseStrict(
        commanderStartChannel.schemas.request,
        {
          ...base,
          defaultCanvasId: 'canvas-2',
          authorizedCanvasIds: ['canvas-1'],
        },
        { name: 'commander:start.request' },
      ),
    ).toThrow('defaultCanvasId must be included in authorizedCanvasIds');
  });

  it('deduplicates selected Canvas-node pairs and rejects selection outside the scope', () => {
    const base = {
      sessionId: 'session-1',
      intent: { kind: 'user_message', message: 'Inspect selection' },
      authorizedCanvasIds: ['canvas-1', 'canvas-2'],
    };
    expect(
      parseStrict(
        commanderStartChannel.schemas.request,
        {
          ...base,
          selectedNodes: [
            { canvasId: 'canvas-2', nodeId: 'node-1' },
            { canvasId: 'canvas-1', nodeId: 'node-1' },
            { canvasId: 'canvas-2', nodeId: 'node-1' },
          ],
        },
        { name: 'commander:start.request' },
      ).selectedNodes,
    ).toEqual([
      { canvasId: 'canvas-2', nodeId: 'node-1' },
      { canvasId: 'canvas-1', nodeId: 'node-1' },
    ]);
    expect(() =>
      parseStrict(
        commanderStartChannel.schemas.request,
        {
          ...base,
          selectedNodes: [{ canvasId: 'canvas-3', nodeId: 'node-1' }],
        },
        { name: 'commander:start.request' },
      ),
    ).toThrow('selectedNodes must reference an authorized Canvas');
  });

  it('requires a runId for tool decisions and accepts the explicit ACK union', () => {
    expect(() =>
      parseStrict(
        commanderToolDecisionChannel.schemas.request,
        { canvasId: 'canvas-1', toolCallId: 'call-1', approved: true },
        { name: 'commander:tool:decision.request' },
      ),
    ).toThrow();

    expect(
      parseStrict(
        commanderToolDecisionChannel.schemas.response,
        { accepted: true, delivery: 'active_run' },
        { name: 'commander:tool:decision.response' },
      ),
    ).toEqual({ accepted: true, delivery: 'active_run' });
  });

  it('accepts rejected answer ACKs and rejects unrecognized codes', () => {
    expect(
      parseStrict(
        commanderToolAnswerChannel.schemas.response,
        { accepted: false, code: 'stale_run' },
        { name: 'commander:tool:answer.response' },
      ),
    ).toEqual({ accepted: false, code: 'stale_run' });

    expect(() =>
      parseStrict(
        commanderToolAnswerChannel.schemas.response,
        { accepted: false, code: 'unknown' },
        { name: 'commander:tool:answer.response' },
      ),
    ).toThrow();
  });

  it('preserves an optional CAS preview on askUser choices', () => {
    const previewAssetHash = 'a'.repeat(64);
    const parsed = parseStrict(
      CommanderStreamPayloadSchema,
      {
        wireVersion: 2,
        sessionId: 'session-1',
        event: {
          kind: 'question_prompt',
          runId: 'run-1',
          step: 2,
          seq: 3,
          emittedAt: 4,
          questionId: 'question-1',
          prompt: 'Choose a style',
          options: [{ id: 'warm', label: 'Warm', previewAssetHash }],
          allowFreeText: false,
        },
      },
      { name: 'commander:stream.payload' },
    );

    expect(parsed.event).toMatchObject({
      kind: 'question_prompt',
      options: [{ id: 'warm', label: 'Warm', previewAssetHash }],
    });
    expect(parsed.sessionId).toBe('session-1');
  });

  it('accepts a frozen capability catalog and rejects malformed hashes', () => {
    const payload = {
      wireVersion: 2,
      sessionId: 'session-1',
      event: {
        kind: 'catalog_frozen',
        runId: 'run-1',
        step: 0,
        seq: 1,
        emittedAt: 4,
        catalogHash: 'a'.repeat(64),
        tools: [
          {
            name: 'canvas.get',
            description: 'Read a Canvas',
            tier: 1,
            tags: ['canvas', 'read'],
            contexts: ['canvas'],
            inputSchemaHash: 'b'.repeat(64),
          },
        ],
      },
    };

    expect(
      parseStrict(CommanderStreamPayloadSchema, payload, {
        name: 'commander:stream.payload',
      }).event,
    ).toMatchObject({ kind: 'catalog_frozen', tools: [{ name: 'canvas.get' }] });
    expect(() =>
      parseStrict(
        CommanderStreamPayloadSchema,
        {
          ...payload,
          event: { ...payload.event, catalogHash: 'not-a-hash' },
        },
        { name: 'commander:stream.payload' },
      ),
    ).toThrow();
  });

  it('requires strict resource-state and cause shapes', () => {
    const event = {
      kind: 'resource_state' as const,
      schemaVersion: 1 as const,
      cause: { kind: 'reserved' as const, operationId: 'model:1', source: 'model' as const },
      usage: {
        tokens: { knowledge: 'known' as const, value: 0 },
        toolCalls: 0,
        wallTimeMs: 0,
        costUsd: { knowledge: 'unknown' as const },
      },
      remaining: {
        tokens: { state: 'unlimited' as const },
        toolCalls: { state: 'estimated' as const, value: 0 },
        wallTimeMs: { state: 'known' as const, value: 0 },
        costUsd: { state: 'unknown' as const },
      },
      clock: { state: 'active' as const, activeMs: 0, changedAt: 4 },
      runId: 'run-1',
      step: 0,
      seq: 1,
      emittedAt: 4,
    };
    const parse = (value: Record<string, unknown>) =>
      parseStrict(
        CommanderStreamPayloadSchema,
        { wireVersion: 2, sessionId: 'session-1', event: value },
        { name: 'commander:stream.payload' },
      );

    expect(
      parse({
        kind: 'run_start',
        intent: 'Plan a scene',
        resourceBudget: {},
        continuationOfRunId: 'run-previous',
        runId: 'run-1',
        step: 0,
        seq: 0,
        emittedAt: 4,
      }).event,
    ).toMatchObject({ kind: 'run_start', resourceBudget: {}, continuationOfRunId: 'run-previous' });
    expect(() =>
      parse({
        kind: 'run_start',
        intent: 'Plan a scene',
        runId: 'run-1',
        step: 0,
        seq: 0,
        emittedAt: 4,
      }),
    ).toThrow();
    expect(parse(event).event).toMatchObject({ kind: 'resource_state', usage: { toolCalls: 0 } });
    expect(
      parse({
        ...event,
        cause: {
          kind: 'boundary',
          blocker: { kind: 'resource_budget', metric: 'tokens', reason: 'exhausted' },
        },
      }).event,
    ).toMatchObject({ kind: 'resource_state', cause: { kind: 'boundary' } });

    for (const invalidEvent of [
      { ...event, usage: { ...event.usage, tokens: { knowledge: 'known', value: -1 } } },
      { ...event, usage: { ...event.usage, tokens: { knowledge: 'known', value: Number.NaN } } },
      {
        ...event,
        usage: {
          ...event.usage,
          tokens: { knowledge: 'known', value: Number.POSITIVE_INFINITY },
        },
      },
      { ...event, cause: { ...event.cause, extra: true } },
      {
        ...event,
        usage: { ...event.usage, tokens: { knowledge: 'known', value: 0, extra: true } },
      },
      { ...event, extra: true },
    ]) {
      expect(() => parse(invalidEvent)).toThrow();
    }
  });

  it('requires blockers for blocked runs while retaining legacy terminal hydration', () => {
    const runEnd = {
      kind: 'run_end' as const,
      status: 'blocked' as const,
      blocker: { kind: 'resource_budget' as const, metric: 'tokens' as const, reason: 'exhausted' as const },
      runId: 'run-1',
      step: 0,
      seq: 1,
      emittedAt: 4,
    };
    const parseEvent = (event: Record<string, unknown>) =>
      parseStrict(
        CommanderStreamPayloadSchema,
        { wireVersion: 2, sessionId: 'session-1', event },
        { name: 'commander:stream.payload' },
      );

    expect(parseEvent(runEnd).event).toMatchObject({ status: 'blocked', blocker: runEnd.blocker });
    expect(() => parseEvent({ ...runEnd, blocker: undefined })).toThrow();
    expect(() => parseEvent({ ...runEnd, status: 'completed' })).toThrow();

    expect(
      parseStrict(
        commanderEventsHydrateChannel.schemas.response,
        {
          run: {
            id: 'legacy-run',
            sessionId: 'session-1',
            authorizedCanvasIds: [],
            intent: 'legacy',
            status: 'max_steps',
            acceptedAt: 1,
            lastSeq: 1,
            attachments: [],
          },
          events: [{ ...runEnd, status: 'max_steps', blocker: undefined }],
        },
        { name: 'commander:events:hydrate.response' },
      ),
    ).toMatchObject({ run: { status: 'max_steps' }, events: [{ status: 'max_steps' }] });

    expect(
      parseStrict(
        CommanderContextCacheSchema,
        {
          kind: 'commander_context_cache',
          version: 2,
          projectorVersion: 1,
          sessionId: 'session-1',
          runs: [{
            runId: 'run-1',
            acceptedAt: 1,
            status: 'blocked',
            throughSeq: 1,
            eventHash: 'a'.repeat(64),
            items: [{ kind: 'terminal_summary', runId: 'run-1', status: 'blocked' }],
          }],
          projectionHash: 'a'.repeat(64),
        },
        { name: 'CommanderContextCache' },
      ),
    ).toMatchObject({ runs: [{ status: 'blocked', items: [{ status: 'blocked' }] }] });
  });

  it('accepts bounded public progress, resource usage, and tool artifacts', () => {
    const common = { runId: 'run-1', step: 1, emittedAt: 4 };
    const usage = parseStrict(
      CommanderStreamPayloadSchema,
      {
        wireVersion: 2,
        sessionId: 'session-1',
        event: {
          kind: 'resource_usage',
          ...common,
          seq: 2,
          operationId: 'model:1',
          source: 'model',
          promptTokens: 12,
          completionTokens: 5,
          reasoningTokens: 3,
        },
      },
      { name: 'commander:stream.payload' },
    );
    expect(usage.event).toMatchObject({ kind: 'resource_usage', promptTokens: 12 });

    const result = parseStrict(
      CommanderStreamPayloadSchema,
      {
        wireVersion: 2,
        sessionId: 'session-1',
        event: {
          kind: 'tool_result',
          ...common,
          seq: 3,
          toolCallId: 'call-1',
          status: 'succeeded',
          summary: 'Updated the run checklist',
          artifacts: [{
            kind: 'checklist',
            id: 'checklist-1',
            items: [{ id: 'item-1', label: 'Inspect footage', status: 'done' }],
          }],
          durationMs: 8,
        },
      },
      { name: 'commander:stream.payload' },
    );
    expect(result.event).toMatchObject({ kind: 'tool_result', artifacts: [{ kind: 'checklist' }] });
  });

  it('rejects private, unbounded, and unknown public event fields', () => {
    const envelope = (event: Record<string, unknown>) => ({
      wireVersion: 2,
      sessionId: 'session-1',
      event: { runId: 'run-1', step: 1, seq: 2, emittedAt: 4, ...event },
    });
    const parse = (event: Record<string, unknown>) =>
      parseStrict(CommanderStreamPayloadSchema, envelope(event), {
        name: 'commander:stream.payload',
      });

    expect(() => parse({ kind: 'thinking', content: 'private', isDelta: true })).toThrow();
    expect(() =>
      parse({
        kind: 'tool_call',
        toolCallId: 'call-1',
        toolRef: { domain: 'canvas', action: 'get' },
        status: 'started',
        args: { secret: 'never-public' },
      }),
    ).toThrow();
    expect(() =>
      parse({
        kind: 'resource_usage',
        operationId: 'model:1',
        source: 'model',
        promptTokens: -1,
      }),
    ).toThrow();
    expect(() =>
      parse({
        kind: 'tool_result',
        toolCallId: 'call-1',
        status: 'succeeded',
        summary: 'x'.repeat(241),
      }),
    ).toThrow();
  });

  it('accepts strict context facts from run input and unavailable tool results', () => {
    const parseEvent = (event: Record<string, unknown>) =>
      parseStrict(
        CommanderStreamPayloadSchema,
        {
          wireVersion: 2,
          sessionId: 'session-1',
          event: { runId: 'run-1', step: 1, seq: 2, emittedAt: 4, ...event },
        },
        { name: 'commander:stream.payload' },
      );

    expect(
      parseEvent({
        kind: 'context_fact',
        schemaVersion: 1,
        source: { kind: 'run_input' },
        completeness: 'complete',
        facts: [
          {
            kind: 'authority_ref',
            authority: 'canvas_node',
            relation: 'selected_input',
            id: 'node-1',
            scopeId: 'canvas-1',
            revision: 2,
            contentHash: 'a'.repeat(64),
          },
          { kind: 'value', key: 'request', value: 'Make it warmer' },
        ],
      }).event,
    ).toMatchObject({ kind: 'context_fact', completeness: 'complete' });

    expect(
      parseEvent({
        kind: 'context_fact',
        schemaVersion: 1,
        source: { kind: 'tool_result', toolCallId: 'call-1', toolResultSeq: 8 },
        completeness: 'unavailable',
        facts: [],
      }).event,
    ).toMatchObject({ kind: 'context_fact', completeness: 'unavailable' });
  });

  it('enforces context-fact completeness, source limits, bounds, and closed sets', () => {
    const parseFacts = (
      facts: unknown[],
      source: Record<string, unknown> = { kind: 'run_input' },
      completeness = 'complete',
    ) =>
      parseStrict(
        CommanderStreamPayloadSchema,
        {
          wireVersion: 2,
          sessionId: 'session-1',
          event: {
            kind: 'context_fact',
            schemaVersion: 1,
            source,
            completeness,
            facts,
            runId: 'run-1',
            step: 1,
            seq: 2,
            emittedAt: 4,
          },
        },
        { name: 'commander:stream.payload' },
      );
    const valueFact = { kind: 'value', key: 'request', value: 'ok' };
    const authorityFact = {
      kind: 'authority_ref',
      authority: 'canvas',
      relation: 'read',
      id: 'canvas-1',
    };

    for (const authority of [
      'asset_entry',
      'character',
      'equipment',
      'location',
      'script',
      'preset',
      'shot_template',
      'snapshot',
      'color_style',
      'run_checklist',
    ]) {
      expect(() => parseFacts([{ ...authorityFact, authority }])).not.toThrow();
    }

    expect(() => parseFacts([])).toThrow();
    expect(() => parseFacts([valueFact], { kind: 'run_input' }, 'unavailable')).toThrow();
    expect(() => parseFacts(Array.from({ length: 129 }, () => valueFact))).toThrow();
    expect(() =>
      parseFacts(
        Array.from({ length: 33 }, () => valueFact),
        { kind: 'tool_result', toolCallId: 'call-1', toolResultSeq: 3 },
      ),
    ).toThrow();

    for (const fact of [
      { ...authorityFact, authority: 'model_private' },
      { ...authorityFact, relation: 'guessed' },
      { ...authorityFact, id: 'x'.repeat(161) },
      { ...authorityFact, scopeId: 'x'.repeat(161) },
      { ...authorityFact, revision: -1 },
      { ...authorityFact, contentHash: 'not-a-sha256' },
      { ...valueFact, key: 'x'.repeat(81) },
      { ...valueFact, value: 'x'.repeat(241) },
    ]) {
      expect(() => parseFacts([fact])).toThrow();
    }
  });

  it('parses only public Commander context-cache items', () => {
    const hash = 'a'.repeat(64);
    const cache = {
      kind: 'commander_context_cache',
      version: 2,
      projectorVersion: 1,
      sessionId: 'session-1',
      runs: [
        {
          runId: 'run-1',
          acceptedAt: 10,
          status: 'completed',
          throughSeq: 7,
          eventHash: hash,
          items: [
            { kind: 'user_input', runId: 'run-1', seq: 0, content: 'Make a film' },
            {
              kind: 'run_context',
              runId: 'run-1',
              seq: 1,
              facts: [{ kind: 'value', key: 'request_kind', value: 'user_message' }],
            },
            { kind: 'assistant_text', runId: 'run-1', step: 1, content: 'Working' },
            {
              kind: 'tool_observation',
              runId: 'run-1',
              toolCallId: 'call-1',
              toolName: 'canvas.get',
              status: 'completed',
              summary: 'Read the Canvas',
              details: { nodeCount: 2 },
              artifacts: [{ kind: 'canvas_node', id: 'node-1' }],
              contextFacts: [
                {
                  kind: 'authority_ref',
                  authority: 'canvas',
                  relation: 'read',
                  id: 'canvas-1',
                },
              ],
            },
            {
              kind: 'interaction',
              runId: 'run-1',
              seq: 5,
              interaction: 'confirmation',
              content: 'Approved',
            },
            {
              kind: 'terminal_summary',
              runId: 'run-1',
              status: 'completed',
              summary: 'Done',
            },
          ],
        },
      ],
      projectionHash: hash,
    };

    expect(
      parseStrict(CommanderContextCacheSchema, cache, { name: 'CommanderContextCache' }),
    ).toEqual(cache);

    const parseItem = (item: Record<string, unknown>) =>
      parseStrict(
        CommanderContextCacheSchema,
        { ...cache, runs: [{ ...cache.runs[0], items: [item] }] },
        { name: 'CommanderContextCache' },
      );
    for (const item of [
      { kind: 'user_input', runId: 'run-1', seq: 0, content: 'input', reasoning: 'private' },
      {
        kind: 'assistant_text',
        runId: 'run-1',
        step: 1,
        content: 'text',
        thoughtSignature: 'private',
      },
      { kind: 'run_context', runId: 'run-1', seq: 1, facts: [] },
      {
        kind: 'run_context',
        runId: 'run-1',
        seq: 1,
        facts: Array.from({ length: 129 }, () => ({
          kind: 'value',
          key: 'request_kind',
          value: 'user_message',
        })),
      },
      {
        kind: 'run_context',
        runId: 'run-1',
        seq: 1,
        facts: [{ kind: 'value', key: 'request_kind', value: 'user_message' }],
        providerPayload: 'private',
      },
      {
        kind: 'tool_observation',
        runId: 'run-1',
        toolCallId: 'call-1',
        toolName: 'canvas.get',
        status: 'completed',
        args: { raw: true },
      },
      {
        kind: 'tool_observation',
        runId: 'run-1',
        toolCallId: 'call-1',
        toolName: 'canvas.get',
        status: 'completed',
        result: { raw: true },
      },
      {
        kind: 'tool_observation',
        runId: 'run-1',
        toolCallId: 'call-1',
        toolName: 'canvas.get',
        status: 'completed',
        contextFacts: [
          {
            kind: 'authority_ref',
            authority: 'model_private',
            relation: 'read',
            id: 'private-1',
          },
        ],
      },
      { kind: 'terminal_summary', runId: 'run-1', status: 'accepted' },
      { kind: 'terminal_summary', runId: 'run-1', status: 'running' },
    ]) {
      expect(() => parseItem(item)).toThrow();
    }

    expect(() =>
      parseStrict(
        CommanderContextCacheSchema,
        {
          ...cache,
          runs: Array.from({ length: 513 }, (_, index) => ({
            ...cache.runs[0],
            runId: `run-${index}`,
          })),
        },
        { name: 'CommanderContextCache' },
      ),
    ).toThrow();

    expect(() =>
      parseStrict(
        CommanderContextCacheSchema,
        {
          ...cache,
          runs: [
            {
              ...cache.runs[0],
              items: Array.from({ length: 5_001 }, () => ({
                kind: 'user_input',
                runId: 'run-1',
                seq: 0,
                content: 'input',
              })),
            },
          ],
        },
        { name: 'CommanderContextCache' },
      ),
    ).toThrow();

    for (const item of [
      { kind: 'user_input', runId: 'run-1', seq: 0, content: 'x'.repeat(64_001) },
      { kind: 'assistant_text', runId: 'run-1', step: 1, content: 'x'.repeat(64_001) },
      {
        kind: 'interaction',
        runId: 'run-1',
        seq: 1,
        interaction: 'answer',
        content: 'x'.repeat(64_001),
      },
    ]) {
      expect(() => parseItem(item)).toThrow();
    }
  });
});
