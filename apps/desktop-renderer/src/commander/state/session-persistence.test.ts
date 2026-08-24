import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMANDER_SESSIONS_KEY, MAX_STORAGE_BYTES } from './constants.js';
import { createCommanderSessionRuntime } from './helpers.js';
import { loadPersistedSessions, persistSessions } from './session-persistence.js';
import type { CommanderSession } from './types.js';

describe('persistSessions', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('serializes each session at most twice when trimming an oversized history', () => {
    const serializationCounts = new Map<string, number>();
    const sessions = Array.from({ length: 12 }, (_, index) => {
      const id = `session-${index}`;
      const session: CommanderSession & { toJSON(): CommanderSession } = {
        id,
        defaultCanvasId: null,
        title: id,
        messages: [
          {
            id: `message-${index}`,
            role: 'user',
            content: 'x'.repeat(Math.ceil(MAX_STORAGE_BYTES / 3)),
            timestamp: index,
          },
        ],
        messageCount: 1,
        runtime: createCommanderSessionRuntime(),
        createdAt: index,
        updatedAt: index,
        toJSON() {
          serializationCounts.set(id, (serializationCounts.get(id) ?? 0) + 1);
          const { toJSON: _toJSON, ...plain } = this;
          return plain;
        },
      };
      return session;
    });

    persistSessions(sessions);

    const stored = localStorage.getItem(COMMANDER_SESSIONS_KEY);
    expect(stored).not.toBeNull();
    expect(stored!.length).toBeLessThanOrEqual(MAX_STORAGE_BYTES);
    expect(JSON.parse(stored!)).toHaveLength(2);
    expect(Math.max(...serializationCounts.values())).toBeLessThanOrEqual(2);
  });

  it('removes legacy reasoning and raw tool payloads before storage or Redux hydration', () => {
    const reasoningSecret = 'SECRET_REASONING_SENTINEL';
    const toolSecret = 'SECRET_TOOL_SENTINEL';
    const errorSecret = 'SECRET_ERROR_SENTINEL';
    const session = {
      id: 'session-private',
      defaultCanvasId: null,
      title: 'Private legacy session',
      messages: [{
        id: 'assistant-1',
        role: 'assistant',
        content: 'Public answer',
        timestamp: 1,
        segments: [
          { kind: 'thinking', id: 'reasoning-1', content: reasoningSecret, collapsed: false },
          { kind: 'phase_note', id: 'error-1', note: 'llm_retry', detail: errorSecret },
          {
            kind: 'tool',
            id: 'tool-segment-1',
            toolCall: {
              id: 'call-1',
              name: 'asset.create',
              startedAt: 1,
              status: 'done',
              arguments: { secret: toolSecret },
              result: { secret: toolSecret },
              errorCode: errorSecret,
              artifacts: [{ kind: 'asset', id: 'asset-public', label: 'Opening shot' }],
            },
          },
        ],
        toolCalls: [{
          id: 'call-1',
          name: 'asset.create',
          startedAt: 1,
          status: 'done',
          arguments: { secret: toolSecret },
          result: { secret: toolSecret },
          errorCode: errorSecret,
          artifacts: [{ kind: 'asset', id: 'asset-public', label: 'Opening shot' }],
        }],
      }],
      messageCount: 1,
      runtime: createCommanderSessionRuntime(),
      createdAt: 1,
      updatedAt: 1,
    } as unknown as CommanderSession;

    persistSessions([session]);
    const stored = localStorage.getItem(COMMANDER_SESSIONS_KEY) ?? '';
    expect(stored).not.toContain(reasoningSecret);
    expect(stored).not.toContain(toolSecret);
    expect(stored).not.toContain(errorSecret);
    expect(stored).toContain('asset-public');

    const hydrated = loadPersistedSessions();
    expect(JSON.stringify(hydrated)).not.toContain(reasoningSecret);
    expect(JSON.stringify(hydrated)).not.toContain(toolSecret);
    expect(JSON.stringify(hydrated)).not.toContain(errorSecret);
    expect(hydrated[0]?.messages[0]?.segments).toEqual([
      expect.objectContaining({
        kind: 'tool',
        toolCall: expect.objectContaining({ artifacts: [{ kind: 'asset', id: 'asset-public', label: 'Opening shot' }] }),
      }),
    ]);
  });

  it('persists only the typed cumulative resource state and blocked reason', () => {
    const secret = 'SECRET_RESOURCE_SENTINEL';
    const session = {
      id: 'session-budget',
      defaultCanvasId: null,
      title: 'Budgeted run',
      messages: [{
        id: 'assistant-run-1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        segments: [{
          kind: 'resource_state',
          id: 'resource-state-run-1',
          cause: {
            kind: 'boundary',
            blocker: { kind: 'resource_budget', metric: 'cost', reason: 'unavailable' },
            privateDetail: secret,
          },
          usage: {
            tokens: { knowledge: 'known', value: 17 },
            toolCalls: 2,
            wallTimeMs: 65_000,
            costUsd: { knowledge: 'unknown' },
            privateDetail: secret,
          },
          remaining: {
            tokens: { state: 'known', value: 83 },
            toolCalls: { state: 'unlimited' },
            wallTimeMs: { state: 'known', value: 55_000 },
            costUsd: { state: 'unknown' },
            privateDetail: secret,
          },
          clock: { state: 'stopped', activeMs: 65_000, changedAt: 2, privateDetail: secret },
        }],
        runMeta: {
          status: 'blocked',
          collapsed: true,
          startedAt: 1,
          completedAt: 2,
          summary: { excerpt: '', toolCount: 0, failedToolCount: 0, durationMs: 1 },
          blocker: { kind: 'resource_budget', metric: 'cost', reason: 'unavailable' },
          privateDetail: secret,
        },
      }],
      messageCount: 1,
      runtime: createCommanderSessionRuntime(),
      createdAt: 1,
      updatedAt: 2,
    } as unknown as CommanderSession;

    persistSessions([session]);
    const stored = localStorage.getItem(COMMANDER_SESSIONS_KEY) ?? '';
    expect(stored).not.toContain(secret);

    const message = loadPersistedSessions()[0]?.messages[0];
    expect(message?.segments).toEqual([
      {
        kind: 'resource_state',
        id: 'resource-state-run-1',
        cause: {
          kind: 'boundary',
          blocker: { kind: 'resource_budget', metric: 'cost', reason: 'unavailable' },
        },
        usage: {
          tokens: { knowledge: 'known', value: 17 },
          toolCalls: 2,
          wallTimeMs: 65_000,
          costUsd: { knowledge: 'unknown' },
        },
        remaining: {
          tokens: { state: 'known', value: 83 },
          toolCalls: { state: 'unlimited' },
          wallTimeMs: { state: 'known', value: 55_000 },
          costUsd: { state: 'unknown' },
        },
        clock: { state: 'stopped', activeMs: 65_000, changedAt: 2 },
      },
    ]);
    expect(message?.runMeta?.blocker).toEqual({
      kind: 'resource_budget',
      metric: 'cost',
      reason: 'unavailable',
    });
  });
});
