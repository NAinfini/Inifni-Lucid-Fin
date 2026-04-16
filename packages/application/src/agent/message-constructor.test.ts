import { describe, it, expect } from 'vitest';
import { buildMessagesForRequest, destructLLMResponse } from './message-constructor.js';
import type { LLMMessage, LLMToolDefinition } from '@lucid-fin/contracts';
import { ToolResultCache } from './tool-result-cache.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STUB = '{"_cached":true}';

function sysMsg(content: string): LLMMessage {
  return { role: 'system', content };
}

function userMsg(content: string): LLMMessage {
  return { role: 'user', content };
}

function assistantMsg(content: string, toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>): LLMMessage {
  const msg: LLMMessage = { role: 'assistant', content };
  if (toolCalls) msg.toolCalls = toolCalls;
  return msg;
}

function toolMsg(toolCallId: string, content: string): LLMMessage {
  return { role: 'tool', content, toolCallId };
}

function simpleTool(name: string): LLMToolDefinition {
  return { name, description: `Tool ${name}`, parameters: { type: 'object', properties: {} } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildMessagesForRequest', () => {
  const baseInput = {
    tools: [simpleTool('canvas.getNode'), simpleTool('canvas.listNodes')],
    contextWindowTokens: 200000,
  };

  describe('basic budget enforcement', () => {
    it('passes through simple messages within budget', () => {
      const messages: LLMMessage[] = [
        sysMsg('You are a helpful assistant.'),
        userMsg('Hello'),
      ];
      const { wireMessages, buildCtx } = buildMessagesForRequest({ ...baseInput, messages });
      expect(wireMessages).toHaveLength(2);
      expect(wireMessages[0].role).toBe('system');
      expect(wireMessages[1].role).toBe('user');
      expect(buildCtx.historyMessagesTrimmed).toBe(0);
    });

    it('trims oldest history messages when over budget', () => {
      const longContent = 'x'.repeat(10000);
      const messages: LLMMessage[] = [
        sysMsg('System prompt'),
        userMsg(longContent),
        assistantMsg(longContent),
        userMsg(longContent),
        assistantMsg(longContent),
        userMsg('latest'),
      ];
      // Very small budget — should trim older messages
      const { wireMessages, buildCtx } = buildMessagesForRequest({
        ...baseInput,
        messages,
        contextWindowTokens: 100, // tiny budget
        reserveTokensForOutput: 10,
      });
      expect(buildCtx.historyMessagesTrimmed).toBeGreaterThan(0);
      // Latest user message should always be present
      expect(wireMessages[wireMessages.length - 1].content).toBe('latest');
    });

    it('keeps later system messages as active process guides before older history', () => {
      const longHistory = 'x'.repeat(4500);
      const processGuide = '[[process-prompt:image-node-generation]]\n[Process Guide: Image]\n' + 'guide '.repeat(300);
      const messages: LLMMessage[] = [
        sysMsg('Global system'),
        userMsg(longHistory),
        assistantMsg(longHistory),
        sysMsg(processGuide),
        userMsg('latest'),
      ];

      const { wireMessages } = buildMessagesForRequest({
        ...baseInput,
        messages,
        contextWindowTokens: 600,
        reserveTokensForOutput: 50,
      });

      expect(wireMessages[0].role).toBe('system');
      expect(wireMessages.some((message) => message.role === 'system' && message.content === processGuide)).toBe(true);
      expect(wireMessages.some((message) => message.role === 'user' && message.content === 'latest')).toBe(true);
      expect(wireMessages.some((message) => message.role === 'user' && message.content === longHistory)).toBe(false);
    });

    it('does not give unrelated later system messages special budget priority', () => {
      const longHistory = 'x'.repeat(4500);
      const normalSystemNote = '[Hint]\n' + 'batch faster '.repeat(400);
      const messages: LLMMessage[] = [
        sysMsg('Global system'),
        userMsg(longHistory),
        assistantMsg(longHistory),
        sysMsg(normalSystemNote),
        userMsg('latest'),
      ];

      const { wireMessages } = buildMessagesForRequest({
        ...baseInput,
        messages,
        contextWindowTokens: 600,
        reserveTokensForOutput: 50,
      });

      expect(wireMessages.some((message) => message.role === 'system' && message.content === normalSystemNote)).toBe(false);
      expect(wireMessages.some((message) => message.role === 'user' && message.content === 'latest')).toBe(true);
    });
  });

  describe('stub skipping (fully-stubbed groups)', () => {
    it('skips fully-stubbed assistant+tool groups from wireMessages', () => {
      const messages: LLMMessage[] = [
        sysMsg('System'),
        assistantMsg('', [
          { id: 'tc1', name: 'canvas.getNode', arguments: { nodeId: 'n1' } },
          { id: 'tc2', name: 'canvas.getNode', arguments: { nodeId: 'n2' } },
        ]),
        toolMsg('tc1', STUB),
        toolMsg('tc2', STUB),
        userMsg('continue'),
      ];
      const { wireMessages } = buildMessagesForRequest({ ...baseInput, messages });
      // The stubbed assistant + 2 tool messages should be skipped
      // Should only have: system + user
      expect(wireMessages).toHaveLength(2);
      expect(wireMessages[0].role).toBe('system');
      expect(wireMessages[1].content).toBe('continue');
    });

    it('keeps partially-stubbed groups (not all tools stubbed)', () => {
      const messages: LLMMessage[] = [
        sysMsg('System'),
        assistantMsg('', [
          { id: 'tc1', name: 'canvas.getNode', arguments: { nodeId: 'n1' } },
          { id: 'tc2', name: 'canvas.getNode', arguments: { nodeId: 'n2' } },
        ]),
        toolMsg('tc1', STUB),
        toolMsg('tc2', '{"success":true,"data":{"id":"n2","title":"Node 2"}}'),
        userMsg('continue'),
      ];
      const { wireMessages } = buildMessagesForRequest({ ...baseInput, messages });
      // The group is NOT fully stubbed — should be kept (assistant + non-stub tool)
      // stub tool messages are still in wireMessages since the group isn't fully stubbed
      expect(wireMessages.length).toBeGreaterThan(2);
      // The assistant message should be present
      expect(wireMessages.some(m => m.role === 'assistant' && m.toolCalls?.length === 2)).toBe(true);
    });

    it('handles non-contiguous tool results (dupMap pattern)', () => {
      // dupMap can push tool results AFTER other messages
      const messages: LLMMessage[] = [
        sysMsg('System'),
        assistantMsg('', [
          { id: 'tc1', name: 'canvas.getNode', arguments: { nodeId: 'n1' } },
          { id: 'tc2', name: 'canvas.getNode', arguments: { nodeId: 'n2' } },
        ]),
        toolMsg('tc1', STUB),
        userMsg('injected message'),
        toolMsg('tc2', STUB), // non-contiguous — pushed later by dupMap
        userMsg('continue'),
      ];
      const { wireMessages } = buildMessagesForRequest({ ...baseInput, messages });
      // All toolCalls have stubs (scanning full tail, not just contiguous)
      // So the group should be fully stubbed and skipped
      expect(wireMessages).toHaveLength(3); // system + injected + continue
      expect(wireMessages[1].content).toBe('injected message');
      expect(wireMessages[2].content).toBe('continue');
    });
  });

  describe('dangling tool result handling', () => {
    it('skips dangling tool result at cut boundary', () => {
      const messages: LLMMessage[] = [
        sysMsg('System'),
        toolMsg('orphan-tc', '{"success":true}'), // orphan tool result
        userMsg('Hello'),
      ];
      const { wireMessages } = buildMessagesForRequest({ ...baseInput, messages });
      // Should not start with a tool message
      const historyStart = wireMessages.findIndex(m => m.role !== 'system');
      expect(wireMessages[historyStart].role).not.toBe('tool');
    });
  });

  describe('cache injection', () => {
    it('appends cache to system prompt when cache has data', () => {
      const cache = new ToolResultCache();
      cache.absorbResult('canvas.getNode', {}, { success: true, data: { id: 'n1', title: 'Node' } }, 1);

      const messages: LLMMessage[] = [
        sysMsg('System prompt here'),
        userMsg('Get node'),
      ];

      const { wireMessages } = buildMessagesForRequest({
        ...baseInput,
        messages,
        cache,
      });

      // System prompt should have cache appended
      expect(wireMessages[0].content).toContain('System prompt here');
      expect(wireMessages[0].content).toContain('[Entity Cache');
      expect(wireMessages[0].content).toContain('canvas.getNode:n1');
    });

    it('does not modify system prompt when cache is empty', () => {
      const cache = new ToolResultCache();
      const messages: LLMMessage[] = [
        sysMsg('System prompt'),
        userMsg('Hello'),
      ];
      const { wireMessages } = buildMessagesForRequest({
        ...baseInput,
        messages,
        cache,
      });
      expect(wireMessages[0].content).toBe('System prompt');
    });

    it('subtracts cache size from history budget', () => {
      // Fill cache with enough data to squeeze history budget
      const cache = new ToolResultCache();
      for (let i = 0; i < 50; i++) {
        cache.absorbResult('canvas.getNode', {}, { success: true, data: { id: `node-${i}`, title: 'x'.repeat(500) } }, 1);
      }

      const longContent = 'y'.repeat(5000);
      const messages: LLMMessage[] = [
        sysMsg('System'),
        userMsg(longContent),
        assistantMsg(longContent),
        userMsg('latest'),
      ];

      const withCache = buildMessagesForRequest({
        ...baseInput,
        messages,
        contextWindowTokens: 50000,
        cache,
      });

      const withoutCache = buildMessagesForRequest({
        ...baseInput,
        messages,
        contextWindowTokens: 50000,
      });

      // With cache, more history should be trimmed
      expect(withCache.buildCtx.historyMessagesTrimmed).toBeGreaterThanOrEqual(
        withoutCache.buildCtx.historyMessagesTrimmed,
      );
    });

    it('drops older fully-cached get exchanges instead of sending both cache and raw tool payloads', () => {
      const cache = new ToolResultCache();
      cache.absorbResult(
        'canvas.getNode',
        { nodeId: 'n1' },
        { success: true, data: { id: 'n1', title: 'Node 1', description: 'cached' } },
        1,
      );

      const toolPayload = JSON.stringify({
        success: true,
        data: { id: 'n1', title: 'Node 1', description: 'x'.repeat(400) },
      });
      const messages: LLMMessage[] = [
        sysMsg('System prompt'),
        assistantMsg('', [
          { id: 'tc1', name: 'canvas.getNode', arguments: { nodeId: 'n1' } },
        ]),
        toolMsg('tc1', toolPayload),
        userMsg('continue'),
      ];

      const { wireMessages } = buildMessagesForRequest({
        ...baseInput,
        messages,
        cache,
      });

      expect(wireMessages).toHaveLength(2);
      expect(wireMessages[0].content).toContain('[Entity Cache');
      expect(wireMessages.some((message) => message.role === 'assistant' && message.toolCalls?.length)).toBe(false);
      expect(wireMessages.some((message) => message.role === 'tool')).toBe(false);
      expect(wireMessages[1].content).toBe('continue');
    });
  });

  describe('tool name sanitization', () => {
    it('sanitizes dot-separated tool names when profile requires it', () => {
      const messages: LLMMessage[] = [
        sysMsg('System'),
        userMsg('Hello'),
      ];
      const tools = [simpleTool('canvas.getNode'), simpleTool('canvas.listNodes')];
      const { wireTools, buildCtx } = buildMessagesForRequest({
        messages,
        tools,
        contextWindowTokens: 200000,
        profile: { providerId: 'test', charsPerToken: 3.5, sanitizeToolNames: true },
      });

      // Tool names should be sanitized (dots → underscores)
      expect(wireTools[0].name).toBe('canvas_getNode');
      expect(wireTools[1].name).toBe('canvas_listNodes');
      // Reverse map should be populated
      expect(buildCtx.toolNameReverseMap.get('canvas_getNode')).toBe('canvas.getNode');
    });

    it('sanitizes tool names in assistant toolCalls', () => {
      const messages: LLMMessage[] = [
        sysMsg('System'),
        assistantMsg('', [
          { id: 'tc1', name: 'canvas.getNode', arguments: { nodeId: 'n1' } },
        ]),
        toolMsg('tc1', '{"success":true}'),
        userMsg('continue'),
      ];
      const { wireMessages } = buildMessagesForRequest({
        messages,
        tools: [simpleTool('canvas.getNode')],
        contextWindowTokens: 200000,
        profile: { providerId: 'test', charsPerToken: 3.5, sanitizeToolNames: true },
      });
      // Find the assistant message in wire
      const assistantWire = wireMessages.find(m => m.role === 'assistant' && m.toolCalls?.length);
      expect(assistantWire?.toolCalls?.[0].name).toBe('canvas_getNode');
    });

    it('round-trips through destructLLMResponse correctly', () => {
      const messages: LLMMessage[] = [sysMsg('System'), userMsg('Hello')];
      const tools = [simpleTool('canvas.getNode')];
      const { buildCtx } = buildMessagesForRequest({
        messages,
        tools,
        contextWindowTokens: 200000,
        profile: { providerId: 'test', charsPerToken: 3.5, sanitizeToolNames: true },
      });

      // Simulate LLM response with sanitized name
      const rawResponse = {
        content: '',
        toolCalls: [{ id: 'tc1', name: 'canvas_getNode', arguments: { nodeId: 'n1' } }],
        finishReason: 'tool_calls' as const,
      };

      const result = destructLLMResponse(rawResponse, buildCtx);
      // Should un-sanitize back to original
      expect(result.toolCalls[0].name).toBe('canvas.getNode');
    });
  });

  describe('first-kept-assistant validation', () => {
    it('drops assistant+tool group if not all tool results present', () => {
      const messages: LLMMessage[] = [
        sysMsg('System'),
        assistantMsg('', [
          { id: 'tc1', name: 'canvas.getNode', arguments: {} },
          { id: 'tc2', name: 'canvas.getNode', arguments: {} },
        ]),
        toolMsg('tc1', '{"success":true}'),
        // tc2 result is MISSING
        userMsg('continue'),
      ];
      const { wireMessages } = buildMessagesForRequest({ ...baseInput, messages });
      // The broken exchange (assistant + tool) should be dropped
      // Only system + user should remain
      expect(wireMessages).toHaveLength(2);
      expect(wireMessages[0].role).toBe('system');
      expect(wireMessages[1].role).toBe('user');
    });
  });
});

describe('destructLLMResponse', () => {
  it('deduplicates tool calls by ID', () => {
    const ctx = {
      profile: { providerId: 'test', charsPerToken: 3.5, sanitizeToolNames: false },
      toolNameReverseMap: new Map<string, string>(),
      estimatedTokensUsed: 0,
      historyMessagesTrimmed: 0,
    };

    const raw = {
      content: '',
      toolCalls: [
        { id: 'tc1', name: 'canvas.getNode', arguments: { nodeId: 'n1' } },
        { id: 'tc1', name: 'canvas.getNode', arguments: { nodeId: 'n1' } }, // duplicate
        { id: 'tc2', name: 'canvas.listNodes', arguments: {} },
      ],
      finishReason: 'tool_calls' as const,
    };

    const result = destructLLMResponse(raw, ctx);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].id).toBe('tc1');
    expect(result.toolCalls[1].id).toBe('tc2');
  });

  it('returns raw result when no tool calls', () => {
    const ctx = {
      profile: { providerId: 'test', charsPerToken: 3.5, sanitizeToolNames: false },
      toolNameReverseMap: new Map<string, string>(),
      estimatedTokensUsed: 0,
      historyMessagesTrimmed: 0,
    };

    const raw = { content: 'Hello', toolCalls: [], finishReason: 'stop' as const };
    const result = destructLLMResponse(raw, ctx);
    expect(result).toBe(raw); // Same reference — no copy needed
  });
});
