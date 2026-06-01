export interface CopywritingToolDeps {
  callLLM: (systemPrompt: string, userText: string) => Promise<string>;
}
