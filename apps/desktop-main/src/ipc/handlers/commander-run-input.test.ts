import { describe, expect, it } from 'vitest';
import type { CommanderStartRequest } from '@lucid-fin/contracts';
import {
  buildCommanderRunInputFacts,
  chunkCommanderRunInputFacts,
} from './commander-run-input.js';

function request(overrides: Partial<CommanderStartRequest> = {}): CommanderStartRequest {
  return {
    sessionId: 'session-1',
    defaultCanvasId: 'canvas-1',
    authorizedCanvasIds: ['canvas-1', 'canvas-2'],
    intent: { kind: 'user_message', message: 'Make a film' },
    selectedNodes: [{ canvasId: 'canvas-2', nodeId: 'node-1' }],
    ...overrides,
  };
}

describe('Commander run input facts', () => {
  it('projects only bounded authority references and typed request identity', () => {
    expect(
      buildCommanderRunInputFacts(request(), [
        {
          ordinal: 0,
          role: 'reference',
          contentHash: 'a'.repeat(64),
          originalName: 'secret-local-name.png',
          mimeType: 'image/png',
        },
      ]),
    ).toEqual([
      { kind: 'value', key: 'request_kind', value: 'user_message' },
      { kind: 'value', key: 'permission_mode', value: 'normal' },
      { kind: 'authority_ref', authority: 'canvas', relation: 'run_scope', id: 'canvas-1' },
      { kind: 'authority_ref', authority: 'canvas', relation: 'run_scope', id: 'canvas-2' },
      {
        kind: 'authority_ref',
        authority: 'canvas_node',
        relation: 'selected_input',
        id: 'node-1',
        scopeId: 'canvas-2',
      },
      {
        kind: 'authority_ref',
        authority: 'cas',
        relation: 'attachment',
        id: 'a'.repeat(64),
        contentHash: 'a'.repeat(64),
      },
    ]);
  });

  it('persists the selected permission mode for exact root retry recovery', () => {
    expect(buildCommanderRunInputFacts(request({ permissionMode: 'strict' }), [])).toContainEqual({
      kind: 'value',
      key: 'permission_mode',
      value: 'strict',
    });
  });

  it('records host bindings without treating host instructions as user text', () => {
    const facts = buildCommanderRunInputFacts(
      request({
        intent: {
          kind: 'media_prompt_assembly',
          taskListId: 'task-list-1',
          promptAssemblyId: 'assembly-1',
          label: 'Continue media assembly',
        },
      }),
      [],
    );
    expect(facts).toContainEqual({ kind: 'value', key: 'request_kind', value: 'media_prompt_assembly' });
    expect(facts).toContainEqual({
      kind: 'authority_ref',
      authority: 'task_list',
      relation: 'bound_input',
      id: 'task-list-1',
    });
    expect(facts).toContainEqual({
      kind: 'authority_ref',
      authority: 'prompt_assembly',
      relation: 'bound_input',
      id: 'assembly-1',
    });
    expect(JSON.stringify(facts)).not.toContain('Continue media assembly');
  });

  it('splits large scope projections into schema-bounded immutable chunks', () => {
    const facts = Array.from({ length: 257 }, (_, index) => ({
      kind: 'value' as const,
      key: `key-${index}`,
      value: `value-${index}`,
    }));
    const chunks = chunkCommanderRunInputFacts(facts);
    expect(chunks.map((chunk) => chunk.length)).toEqual([128, 128, 1]);
    chunks[0]![0] = { kind: 'value', key: 'changed', value: 'changed' };
    expect(facts[0]).toEqual({ kind: 'value', key: 'key-0', value: 'value-0' });
  });
});
