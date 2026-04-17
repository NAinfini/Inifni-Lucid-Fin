/**
 * Parity test: graph serializer output vs legacy buildMessagesForRequest.
 *
 * The G2b-1 OpenAI serializer replaces `buildMessagesForRequest` as the
 * source of wire messages + wire tools + reverse map. It must produce
 * equivalent output (same roles, same content, same tool-name sanitization)
 * for representative scenarios: primary system + history, process prompts,
 * tool calls + results, cache summary injection, budget trimming.
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

const OPENAI_PROFILE: ProviderProfile = {
  providerId: 'openai',
  charsPerToken: 4,
  sanitizeToolNames: true,
  outputReserveTokens: 4096,
};

const TOOLS: LLMToolDefinition[] = [
  {
    name: 'canvas.getNode',
    description: 'Get a node by id',
    parameters: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] },
  },
];

describe('graph serializer ↔ legacy parity', () => {
  it('matches legacy on system + user + assistant + tool-result', () => {
    // Legacy messages array
    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are an agent.' },
      { role: 'user', content: 'Get node n1.' },
      {
        role: 'assistant',
        content: 'fetching',
        toolCalls: [{ id: 'tc1', name: 'canvas.getNode', arguments: { nodeId: 'n1' } }],
      },
      { role: 'tool', content: '{"ok":true}', toolCallId: 'tc1' },
    ];

    // Graph equivalent
    const graph = new ContextGraph();
    graph.add({
      kind: 'guide', itemId: mkId(), producedAtStep: 0,
      guideKey: 'system-root', content: 'You are an agent.',
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
      messages, tools: TOOLS, profile: OPENAI_PROFILE, contextWindowTokens: 128000,
    });

    const graphOut = serializeForOpenAI({
      graph, tools: TOOLS, profile: OPENAI_PROFILE, contextWindowTokens: 128000,
    });

    // Wire tools must match (sanitized)
    expect(graphOut.wireTools.map((t) => t.name))
      .toEqual(legacy.wireTools.map((t) => t.name));

    // Roles sequence must match
    expect(graphOut.wireMessages.map((m) => m.role))
      .toEqual(legacy.wireMessages.map((m) => m.role));

    // System content must start with the root system prompt (legacy may append cache, so compare prefix)
    expect(graphOut.wireMessages[0]!.content.startsWith('You are an agent.')).toBe(true);
    expect(legacy.wireMessages[0]!.content.startsWith('You are an agent.')).toBe(true);

    // Assistant tool-call name sanitized identically
    const gAsst = graphOut.wireMessages.find((m) => m.role === 'assistant')!;
    const lAsst = legacy.wireMessages.find((m) => m.role === 'assistant')!;
    expect(gAsst.toolCalls![0]!.name).toBe(lAsst.toolCalls![0]!.name);
    expect(gAsst.toolCalls![0]!.name).toBe('canvas_getNode'); // sanitized

    // Reverse maps agree on the one sanitized tool
    expect(graphOut.toolNameReverseMap.get('canvas_getNode'))
      .toBe(legacy.buildCtx.toolNameReverseMap.get('canvas_getNode'));
  });

  it('process-prompt placement matches legacy (between primary system and history)', () => {
    const ppContent = '[[process-prompt:image-gen]]\nProcess details here';
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
      messages, tools: [], profile: OPENAI_PROFILE, contextWindowTokens: 128000,
    });
    const graphOut = serializeForOpenAI({
      graph, tools: [], profile: OPENAI_PROFILE, contextWindowTokens: 128000,
    });

    expect(graphOut.wireMessages.map((m) => m.role))
      .toEqual(legacy.wireMessages.map((m) => m.role));

    // Order: system(ROOT), system(process-prompt), user(first), user(second)
    expect(graphOut.wireMessages[0]!.content).toContain('ROOT');
    expect(graphOut.wireMessages[1]!.content).toContain('[[process-prompt:');
    expect(legacy.wireMessages[0]!.content).toContain('ROOT');
    expect(legacy.wireMessages[1]!.content).toContain('[[process-prompt:');
  });
});
