import type { GenerationRequest, GenerationResult, CostEstimate, JobStatus } from './job.js';

export type AdapterType = 'text' | 'image' | 'video' | 'voice' | 'music' | 'sfx';

export type Capability =
  | 'text-to-image'
  | 'image-to-image'
  | 'text-to-video'
  | 'image-to-video'
  | 'text-to-voice'
  | 'text-to-music'
  | 'text-to-sfx'
  | 'text-generation'
  | 'script-expand'
  | 'scene-breakdown'
  | 'character-extract'
  | 'prompt-enhance';

export interface AIProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: AdapterType | AdapterType[];
  readonly capabilities: Capability[];
  readonly maxConcurrent: number;

  configure(apiKey: string, options?: Record<string, unknown>): void;
  validate(): Promise<boolean>;
  generate(req: GenerationRequest): Promise<GenerationResult>;
  estimateCost(req: GenerationRequest): CostEstimate;
  checkStatus(jobId: string): Promise<JobStatus>;
  cancel(jobId: string): Promise<void>;
}

// --- LLM Adapter (separate from media adapters) ---

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: Array<{ data: string; mimeType: string }>; // base64-encoded image data for vision models
  toolCalls?: LLMToolCall[];
  toolCallId?: string; // for role='tool' messages
}

export interface LLMToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  enum?: string[];
  required?: boolean;
  properties?: Record<string, LLMToolParameter>;
  items?: LLMToolParameter;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, LLMToolParameter>;
    required?: string[];
  };
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMToolResult {
  toolCallId: string;
  content: string;
}

export interface LLMCompletionResult {
  content: string;
  toolCalls: LLMToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
}

export interface LLMRequestOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  tools?: LLMToolDefinition[];
  toolChoice?: 'auto' | 'none' | { name: string };
}

export interface LLMAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: Capability[];

  configure(apiKey: string, options?: Record<string, unknown>): void;
  validate(): Promise<boolean>;

  /** Non-streaming completion */
  complete(messages: LLMMessage[], opts?: LLMRequestOptions): Promise<string>;

  /** Streaming completion — yields chunks */
  stream(messages: LLMMessage[], opts?: LLMRequestOptions): AsyncIterable<string>;

  /** Completion with tool-calling support — returns structured result */
  completeWithTools(messages: LLMMessage[], opts?: LLMRequestOptions): Promise<LLMCompletionResult>;
}
