import { describe, expect, it, vi } from 'vitest';
import type { CommanderRunRecord, TimelineEvent } from '@lucid-fin/contracts';
import { projectCommanderContext } from './event-context-projector.js';
import { createSubagentTools, type SubagentToolHost } from './subagent-tools.js';

function tool(name: string) {
  const found = createSubagentTools().find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing ${name}`);
  return found;
}

describe('model-directed subagent tools', () => {
  it('lets the model name and scope a child without exposing its instructions publicly', async () => {
    const host: SubagentToolHost = {
      spawn: vi.fn(async () => ({
        success: true,
        data: {
          runId: 'child-1',
          status: 'accepted',
          displayName: 'Continuity audit',
          objective: 'Check visual continuity',
          completed: false,
        },
      })),
      wait: vi.fn(),
      result: vi.fn(),
    };
    const definition = tool('agent.spawn');
    const args = {
      displayName: ' Continuity audit ',
      objective: ' Check visual continuity ',
      instructions: 'SECRET_DELEGATION_INSTRUCTIONS',
      authorizedCanvasIds: ['canvas-1'],
      selectedNodes: [{ canvasId: 'canvas-1', nodeId: 'node-1' }],
      contextRefs: [
        {
          kind: 'authority_ref',
          authority: 'asset_entry',
          relation: 'read',
          id: 'asset-1',
        },
      ],
      resourceBudget: { maxTokens: 1000 },
      permissionMode: 'strict',
    };

    const result = await definition.execute(args, {
      subagents: host,
      operationId: 'tool:1:0:call-1',
    });

    expect(host.spawn).toHaveBeenCalledWith(
      {
        ...args,
        displayName: 'Continuity audit',
        objective: 'Check visual continuity',
      },
      'tool:1:0:call-1',
    );
    expect(result.success).toBe(true);
    const projection = definition.projectPublicResult?.(result, args);
    expect(projection).toEqual({
      summary: 'Subagent started.',
      details: {
        runId: 'child-1',
        status: 'accepted',
        displayName: 'Continuity audit',
      },
      context: {
        completeness: 'complete',
        facts: [
          {
            kind: 'authority_ref',
            authority: 'commander_run',
            relation: 'created',
            id: 'child-1',
          },
        ],
      },
    });
    expect(JSON.stringify(projection)).not.toContain('SECRET_DELEGATION_INSTRUCTIONS');
    expect(definition.projectPublicArguments?.(args)).toEqual({});
  });

  it('preserves the spawned child Run reference in the replayed model view', () => {
    const spawn = tool('agent.spawn');
    const projection = spawn.projectPublicResult?.(
      {
        success: true,
        data: {
          runId: 'child-1',
          status: 'accepted',
          displayName: 'Continuity audit',
          completed: false,
        },
      },
      {},
    );
    const run: CommanderRunRecord = {
      id: 'root',
      sessionId: 'session-1',
      authorizedCanvasIds: [],
      intent: 'Delegate',
      workType: 'agent',
      status: 'completed',
      acceptedAt: 1,
      lastSeq: 4,
      attachments: [],
    };
    const events: TimelineEvent[] = [
      {
        kind: 'run_start', runId: 'root', step: 0, seq: 0, emittedAt: 1,
        intent: 'Delegate', resourceBudget: {}, workType: 'agent',
      },
      {
        kind: 'tool_call', runId: 'root', step: 1, seq: 1, emittedAt: 2,
        toolCallId: 'call-1', toolRef: { domain: 'agent', action: 'spawn' }, status: 'started',
      },
      {
        kind: 'tool_result', runId: 'root', step: 1, seq: 2, emittedAt: 3,
        toolCallId: 'call-1', status: 'succeeded', summary: projection?.summary,
        details: projection?.details,
      },
      {
        kind: 'context_fact', runId: 'root', step: 1, seq: 3, emittedAt: 3,
        schemaVersion: 1, source: { kind: 'tool_result', toolCallId: 'call-1', toolResultSeq: 2 },
        completeness: 'complete', facts: projection?.context?.facts ?? [],
      },
      {
        kind: 'run_end', runId: 'root', step: 1, seq: 4, emittedAt: 4, status: 'completed',
      },
    ];

    const cache = projectCommanderContext({ sessionId: 'session-1', runs: [{ run, events }] });

    expect(cache.runs[0]?.items).toContainEqual(expect.objectContaining({
      kind: 'tool_observation',
      toolName: 'agent.spawn',
      contextFacts: [
        {
          kind: 'authority_ref',
          authority: 'commander_run',
          relation: 'created',
          id: 'child-1',
        },
      ],
    }));
  });

  it('fails closed when the host is missing or the bounded input is invalid', async () => {
    await expect(tool('agent.wait').execute({ runId: 'child-1', timeoutMs: 60_001 })).resolves.toMatchObject({
      success: false,
      errorClass: 'validation',
    });
    await expect(tool('agent.result').execute({ runId: 'child-1' })).resolves.toMatchObject({
      success: false,
      errorClass: 'fatal',
    });
  });
});
