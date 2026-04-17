/**
 * OpenAI serializer golden tests — Phase G2a-4.
 *
 * Builds a graph with 1 user, 1 assistant, 2 tool results,
 * 1 entity snapshot, 1 guide; asserts the exact message array shape.
 */

import { describe, it, expect } from 'vitest';
import { serializeForOpenAI } from './openai.js';
import { ContextGraph } from '../context-graph.js';
import type { ContextItem, ToolKey, TokenBudget } from '@lucid-fin/contracts';
import { freshContextItemId } from '@lucid-fin/contracts-parse';

function mkId() {
  return freshContextItemId();
}

describe('serializeForOpenAI', () => {
  it('golden test: 1 guide + 1 user + 1 assistant + 2 tool-results + 1 entity-snapshot', () => {
    const graph = new ContextGraph();

    // Guide — should appear first as a system message
    const guideItem: ContextItem = {
      kind: 'guide',
      itemId: mkId(),
      producedAtStep: 0,
      guideKey: 'workflow-basics',
      content: 'Always check canvas state before modifying nodes.',
    };

    // User message
    const userItem: ContextItem = {
      kind: 'user-message',
      itemId: mkId(),
      producedAtStep: 1,
      content: 'Update the scene.',
    };

    // Assistant turn with 2 tool calls
    const assistantItem: ContextItem = {
      kind: 'assistant-turn',
      itemId: mkId(),
      producedAtStep: 1,
      content: "I'll check the canvas first.",
      toolCalls: [
        { id: 'tc1', name: 'canvas.getState', arguments: {} },
        { id: 'tc2', name: 'canvas.getNode', arguments: { nodeId: 'n1' } },
      ],
    };

    // Tool result 1
    const toolResult1: ContextItem = {
      kind: 'tool-result',
      itemId: mkId(),
      producedAtStep: 1,
      toolKey: 'canvas.getState' as ToolKey,
      paramsHash: '{}',
      content: { success: true, data: { nodes: 3 } },
      schemaVersion: 1,
      toolCallId: 'tc1',
    };

    // Tool result 2
    const toolResult2: ContextItem = {
      kind: 'tool-result',
      itemId: mkId(),
      producedAtStep: 1,
      toolKey: 'canvas.getNode' as ToolKey,
      paramsHash: '{"nodeId":"n1"}',
      content: { success: true, data: { id: 'n1', type: 'character' } },
      schemaVersion: 1,
      toolCallId: 'tc2',
    };

    // Entity snapshot
    const snapshotItem: ContextItem = {
      kind: 'entity-snapshot',
      itemId: mkId(),
      producedAtStep: 2,
      entityRef: { entityType: 'character', entityId: 'c1' },
      snapshot: { id: 'c1', name: 'Alice' },
    };

    graph.add(guideItem);
    graph.add(userItem);
    graph.add(assistantItem);
    graph.add(toolResult1);
    graph.add(toolResult2);
    graph.add(snapshotItem);

    const budget: TokenBudget = { tokens: 100000, charsPerToken: 4 };
    const messages = serializeForOpenAI(graph, budget);

    // Guide must be first and is a system message
    expect(messages[0]).toStrictEqual({ role: 'system', content: guideItem.content });

    // User message
    expect(messages[1]).toStrictEqual({ role: 'user', content: userItem.content });

    // Assistant turn with tool_calls
    expect(messages[2]).toMatchObject({
      role: 'assistant',
      content: assistantItem.content,
    });
    expect(messages[2]!.toolCalls).toHaveLength(2);
    expect(messages[2]!.toolCalls![0]!.name).toBe('canvas.getState');
    expect(messages[2]!.toolCalls![1]!.name).toBe('canvas.getNode');

    // Tool result 1
    expect(messages[3]).toMatchObject({
      role: 'tool',
      toolCallId: 'tc1',
    });
    const tc1Content = JSON.parse(messages[3]!.content);
    expect(tc1Content.success).toBe(true);

    // Tool result 2
    expect(messages[4]).toMatchObject({
      role: 'tool',
      toolCallId: 'tc2',
    });

    // Entity snapshot becomes a system message
    expect(messages[5]).toMatchObject({
      role: 'system',
    });
    expect(messages[5]!.content).toContain('[Entity snapshot]');

    // Total: 6 messages
    expect(messages).toHaveLength(6);
  });

  it('respects token budget — drops oldest non-guide items when over budget', () => {
    const graph = new ContextGraph();

    graph.add({
      kind: 'guide',
      itemId: mkId(),
      producedAtStep: 0,
      guideKey: 'g',
      content: 'guide',
    });

    // Add many large user messages
    for (let i = 0; i < 10; i++) {
      graph.add({
        kind: 'user-message',
        itemId: mkId(),
        producedAtStep: i + 1,
        content: 'x'.repeat(1000),
      });
    }

    // Tiny budget: only the guide + 1 user message should fit
    const budget: TokenBudget = { tokens: 300, charsPerToken: 4 };
    const messages = serializeForOpenAI(graph, budget);

    // Guide always present
    expect(messages[0]).toMatchObject({ role: 'system', content: 'guide' });
    // At least something fits after the guide
    expect(messages.length).toBeGreaterThanOrEqual(1);
    // Not all 10 user messages should be included (budget too tight)
    const userMsgs = messages.filter((m) => m.role === 'user');
    expect(userMsgs.length).toBeLessThan(10);
  });

  it('reference items resolve to the referenced item', () => {
    const graph = new ContextGraph();

    const userItem: ContextItem = {
      kind: 'user-message',
      itemId: mkId(),
      producedAtStep: 1,
      content: 'original message',
    };
    const refItem: ContextItem = {
      kind: 'reference',
      itemId: mkId(),
      producedAtStep: 2,
      referencedItemId: userItem.itemId,
    };

    graph.add(userItem);
    graph.add(refItem);

    const budget: TokenBudget = { tokens: 100000, charsPerToken: 4 };
    const messages = serializeForOpenAI(graph, budget);

    // The reference should render as the referenced user message (content duplicated)
    const userMessages = messages.filter((m) => m.role === 'user');
    expect(userMessages.length).toBe(2);
    expect(userMessages[0]!.content).toBe('original message');
    expect(userMessages[1]!.content).toBe('original message');
  });

  it('session-summary becomes a system message wrapped in <summary> tags', () => {
    const graph = new ContextGraph();
    graph.add({
      kind: 'session-summary',
      itemId: mkId(),
      producedAtStep: 5,
      stepsFrom: 1,
      stepsTo: 5,
      content: 'Earlier: checked canvas, added 3 nodes.',
    });

    const budget: TokenBudget = { tokens: 100000, charsPerToken: 4 };
    const messages = serializeForOpenAI(graph, budget);

    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('system');
    expect(messages[0]!.content).toContain('<summary>');
    expect(messages[0]!.content).toContain('Earlier: checked canvas');
  });
});
