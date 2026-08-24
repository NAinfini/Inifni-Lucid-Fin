import type { LLMMessage, LLMToolCall } from '@lucid-fin/contracts';

interface IndexedToolCall {
  toolName: string;
  arguments: unknown;
  msgIndex: number;
}

export interface IndexedToolMessage {
  msgIndex: number;
  toolCallId: string;
  toolName?: string;
  arguments?: unknown;
  paramsHash: string;
  compositeKey: string;
}

function stringifyArguments(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ success: false, error: 'Failed to serialize tool result' });
  }
}

/**
 * Single-pass association between transcript tool results and their nearest
 * preceding assistant call. Tool call ids are not globally unique for every
 * provider, so tool-message entries retain their resolved call metadata and
 * occurrence key rather than relying on a later id lookup.
 */
export class TranscriptIndex {
  private toolCallMap = new Map<string, IndexedToolCall>();
  private toolMessagesByIndex = new Map<number, IndexedToolMessage>();
  private firstToolMessageIndexByCallId = new Map<string, number>();
  private latestToolMessageIndexByCallId = new Map<string, number>();
  private toolMessagesInOrder: IndexedToolMessage[] = [];
  private toolMessagesByDomain = new Map<string, IndexedToolMessage[]>();
  private compositeOccurrences = new Map<string, number>();
  private scannedLength = 0;

  rebuild(messages: readonly LLMMessage[]): void {
    this.clear();
    this.sync(messages);
  }

  /** Index only transcript entries appended since the last scan. */
  sync(messages: readonly LLMMessage[]): void {
    if (messages.length < this.scannedLength) {
      this.rebuild(messages);
      return;
    }

    for (let msgIndex = this.scannedLength; msgIndex < messages.length; msgIndex += 1) {
      const message = messages[msgIndex]!;
      if (message.role === 'assistant' && message.toolCalls?.length) {
        this.registerAssistantToolCalls(msgIndex, message.toolCalls);
        continue;
      }
      if (message.role === 'tool' && message.toolCallId) {
        this.registerToolMessage(msgIndex, message.toolCallId);
      }
    }
    this.scannedLength = messages.length;
  }

  registerAssistantToolCalls(msgIndex: number, toolCalls: readonly LLMToolCall[]): void {
    for (const toolCall of toolCalls) {
      if (this.toolCallMap.get(toolCall.id)?.msgIndex === msgIndex) continue;
      this.toolCallMap.set(toolCall.id, {
        toolName: toolCall.name,
        arguments: toolCall.arguments,
        msgIndex,
      });
    }
  }

  toolMessageAt(msgIndex: number): IndexedToolMessage | undefined {
    return this.toolMessagesByIndex.get(msgIndex);
  }

  toolMessages(): readonly IndexedToolMessage[] {
    return this.toolMessagesInOrder;
  }

  toolMessagesForDomain(domain: string): readonly IndexedToolMessage[] {
    return this.toolMessagesByDomain.get(domain) ?? [];
  }

  latestToolMessageIndex(toolCallId: string): number | undefined {
    return this.latestToolMessageIndexByCallId.get(toolCallId);
  }

  firstToolMessageIndex(toolCallId: string): number | undefined {
    return this.firstToolMessageIndexByCallId.get(toolCallId);
  }

  resolveToolName(toolCallId: string): string | undefined {
    return this.toolCallMap.get(toolCallId)?.toolName;
  }

  resolveToolMsgIndex(toolCallId: string): number | undefined {
    return this.toolCallMap.get(toolCallId)?.msgIndex;
  }

  clear(): void {
    this.toolCallMap.clear();
    this.toolMessagesByIndex.clear();
    this.firstToolMessageIndexByCallId.clear();
    this.latestToolMessageIndexByCallId.clear();
    this.toolMessagesInOrder = [];
    this.toolMessagesByDomain.clear();
    this.compositeOccurrences.clear();
    this.scannedLength = 0;
  }

  private registerToolMessage(msgIndex: number, toolCallId: string): void {
    const call = this.toolCallMap.get(toolCallId);
    const toolKey = call?.toolName ?? 'unknown';
    const paramsHash = call ? stringifyArguments(call.arguments) : toolCallId;
    const base = `${toolCallId}|${toolKey}|${paramsHash}`;
    const occurrence = (this.compositeOccurrences.get(base) ?? 0) + 1;
    this.compositeOccurrences.set(base, occurrence);
    const indexed: IndexedToolMessage = {
      msgIndex,
      toolCallId,
      toolName: call?.toolName,
      arguments: call?.arguments,
      paramsHash,
      compositeKey: `${base}#${occurrence}`,
    };
    this.toolMessagesByIndex.set(msgIndex, indexed);
    if (!this.firstToolMessageIndexByCallId.has(toolCallId)) {
      this.firstToolMessageIndexByCallId.set(toolCallId, msgIndex);
    }
    this.latestToolMessageIndexByCallId.set(toolCallId, msgIndex);
    this.toolMessagesInOrder.push(indexed);
    if (indexed.toolName) {
      const domain = indexed.toolName.split('.')[0];
      if (domain) {
        const messages = this.toolMessagesByDomain.get(domain) ?? [];
        messages.push(indexed);
        this.toolMessagesByDomain.set(domain, messages);
      }
    }
  }
}
