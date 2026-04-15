export class TranscriptIndex {
  private toolCallMap = new Map<string, { toolName: string; msgIndex: number }>();

  registerAssistantToolCalls(
    msgIndex: number,
    toolCalls: Array<{ id: string; name: string }>,
  ): void {
    for (const toolCall of toolCalls) {
      this.toolCallMap.set(toolCall.id, { toolName: toolCall.name, msgIndex });
    }
  }

  resolveToolName(toolCallId: string): string | undefined {
    return this.toolCallMap.get(toolCallId)?.toolName;
  }

  resolveToolMsgIndex(toolCallId: string): number | undefined {
    return this.toolCallMap.get(toolCallId)?.msgIndex;
  }

  clear(): void {
    this.toolCallMap.clear();
  }
}
