/**
 * Claude parity test — Phase G2b-2.
 *
 * The G2b-1 `serializeForOpenAI` produces the unified `LLMMessage[]` wire
 * format that BOTH the OpenAI and Claude adapters consume. This test proves
 * that the same serializer, driven by the Claude profile, produces output
 * equivalent to `buildMessagesForRequest` under Claude semantics.
 *
 * Claude profile differs from OpenAI only in:
 *   - charsPerToken: 3.5 (vs 4.0)
 *   - maxUtilization: 0.90 (vs 0.95)
 *   - sanitizeToolNames: true (same as OpenAI)
 *
 * Adapter-specific wire conversion (Claude's `content: [{type:'tool_use'}]`
 * blocks) happens INSIDE `ClaudeAdapter.splitSystem()`, NOT here.
 */

import { describe, it, expect } from 'vitest';
import { serializeForOpenAI } from './openai.js';
import { ContextGraph } from '../context-graph.js';
import { buildMessagesForRequest } from '../../message-constructor.js';
import type {
  ContextItem,
  ToolKey,
  LLMMessage,
  LLMToolDefinition,
  ProviderProfile,
} from '@lucid-fin/contracts';
import { freshContextItemId } from '@lucid-fin/contracts-parse';

function mkId() { return freshContextItemId(); }

const CLAUDE_PROFILE: ProviderProfile = {
  providerId: 'claude',
  charsPerToken: 3.5,
  sanitizeToolNames: true,
  maxUtilization: 0.90,
  outputReserveTokens: 4096,
};

const TOOLS: LLMToolDefinition[] = [
  {
    name: 'canvas.getNode',
    description: 'Get a node by id',
    parameters: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] },
  },
];

describe('graph serializer under Claude profile', () => {
  it('matches legacy on system + user + assistant + tool-result', () => {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are Claude.' },
      { role: 'user', content: 'Get node n1.' },
      {
        role: 'assistant',
        content: 'fetching',
        toolCalls: [{ id: 'tc1', name: 'canvas.getNode', arguments: { nodeId: 'n1' } }],
      },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'tc1' },
    ];

    const graph = new ContextGraph();
    graph.add({
      kind: 'guide', itemId: mkId(), producedAtStep: 0,
      guideKey: 'system-root', content: 'You are Claude.',
    } as ContextItem);
    graph.add({
      kind: 'user-message', itemId: mkId(), producedAtStep: 1, content: 'Get node n1.',
    } as ContextItem);
    graph.add({
      kind: 'assistant-turn', itemId: mkId(), producedAtStep: 1,
      content: 'fetching',
      toolCalls: [{ id: 'tc1', name: 'canvas.getNode', arguments: { nodeId: 'n1' } }],
    } as ContextItem);
    graph.add({
      kind: 'tool-result', itemId: mkId(), producedAtStep: 1,
      toolKey: 'canvas.getNode' as ToolKey, paramsHash: '{"nodeId":"n1"}',
      content: '{"ok":true}', schemaVersion: 1, toolCallId: 'tc1',
    } as ContextItem);

    const legacy = buildMessagesForRequest({
      messages, tools: TOOLS, profile: CLAUDE_PROFILE, contextWindowTokens: 200000,
    });

    const graphOut = serializeForOpenAI({
      graph, tools: TOOLS, profile: CLAUDE_PROFILE, contextWindowTokens: 200000,
    });

    // Wire tools must match (sanitized by Claude profile)
    expect(graphOut.wireTools.map((t) => t.name))
      .toEqual(legacy.wireTools.map((t) => t.name));
    expect(graphOut.wireTools[0]!.name).toBe('canvas_getNode');

    // Role sequence matches
    expect(graphOut.wireMessages.map((m) => m.role))
      .toEqual(legacy.wireMessages.map((m) => m.role));

    // System content starts with the root prompt
    expect(graphOut.wireMessages[0]!.content.startsWith('You are Claude.')).toBe(true);

    // Tool-call name sanitized by Claude profile
    const gAsst = graphOut.wireMessages.find((m) => m.role === 'assistant')!;
    expect(gAsst.toolCalls![0]!.name).toBe('canvas_getNode');

    // Reverse map agrees
    expect(graphOut.toolNameReverseMap.get('canvas_getNode'))
      .toBe(legacy.buildCtx.toolNameReverseMap.get('canvas_getNode'));
  });

  it('respects Claude charsPerToken=3.5 when budgeting history', () => {
    const graph = new ContextGraph();
    graph.add({
      kind: 'guide', itemId: mkId(), producedAtStep: 0,
      guideKey: 'g', content: 'root',
    } as ContextItem);

    // Add 20 large user messages (20k chars total)
    for (let i = 0; i < 20; i++) {
      graph.add({
        kind: 'user-message', itemId: mkId(), producedAtStep: i + 1,
        content: 'x'.repeat(1000),
      } as ContextItem);
    }

    // Context window 6k tokens — after output reserve 4096, ~1904 budget;
    // with Claude's 3.5 cpt, that's ~6664 chars. Can only fit ~6 msgs.
    const graphOut = serializeForOpenAI({
      graph, tools: [], profile: CLAUDE_PROFILE, contextWindowTokens: 6000,
    });

    expect(graphOut.wireMessages[0]!.role).toBe('system');
    const userMsgs = graphOut.wireMessages.filter((m) => m.role === 'user');
    expect(userMsgs.length).toBeLessThan(20);
    expect(userMsgs.length).toBeGreaterThanOrEqual(1);
    // Newest message must be present (legacy parity: always keep last)
    expect(userMsgs.at(-1)!.content).toBe('x'.repeat(1000));
  });

  it('process-prompt placement matches legacy under Claude profile', () => {
    const ppContent = '[[process-prompt:image-gen]]\nProcess details';
    const messages: LLMMessage[] = [
      { role: 'system', content: 'ROOT' },
      { role: 'user', content: 'first' },
      { role: 'system', content: ppContent },
      { role: 'user', content: 'second' },
    ];

    const graph = new ContextGraph();
    graph.add({ kind: 'guide', itemId: mkId(), producedAtStep: 0, guideKey: 'r', content: 'ROOT' } as ContextItem);
    graph.add({ kind: 'user-message', itemId: mkId(), producedAtStep: 1, content: 'first' } as ContextItem);
    graph.add({ kind: 'system-message', itemId: mkId(), producedAtStep: 2, content: ppContent } as ContextItem);
    graph.add({ kind: 'user-message', itemId: mkId(), producedAtStep: 3, content: 'second' } as ContextItem);

    const legacy = buildMessagesForRequest({
      messages, tools: [], profile: CLAUDE_PROFILE, contextWindowTokens: 200000,
    });
    const graphOut = serializeForOpenAI({
      graph, tools: [], profile: CLAUDE_PROFILE, contextWindowTokens: 200000,
    });

    expect(graphOut.wireMessages.map((m) => m.role))
      .toEqual(legacy.wireMessages.map((m) => m.role));
    expect(graphOut.wireMessages[0]!.content).toContain('ROOT');
    expect(graphOut.wireMessages[1]!.content).toContain('[[process-prompt:');
  });
});
