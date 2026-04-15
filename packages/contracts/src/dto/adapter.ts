import type { GenerationRequest, GenerationResult, CostEstimate, JobStatus, GenerationType } from './job.js';
import type { AdapterError } from '../errors/index.js';
import type { ProviderProfile } from './provider-profile.js';

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

/**
 * Options passed to AIProviderAdapter.configure().
 * `generationType` tells the adapter which media type this configuration targets,
 * so multi-type adapters can route model/baseUrl to the correct internal slot.
 */
export interface AdapterConfigureOptions {
  baseUrl?: string;
  model?: string;
  /** The generation type this configuration targets (image, video, voice, etc.) */
  generationType?: GenerationType;
  [key: string]: unknown;
}

/**
 * Real-time progress update during generation.
 * Emitted by adapters that support streaming progress.
 */
export interface ProgressUpdate {
  type: 'progress';
  /** Progress percentage (0-100) */
  percentage: number;
  /** Human-readable description of current step */
  currentStep?: string;
  /** Array of log messages */
  logs?: string[];
  /** Position in queue (if queued) */
  queuePosition?: number;
  /** Estimated wait time in seconds */
  estimatedWaitTime?: number;
  /** Job ID for tracking */
  jobId?: string;
}

/**
 * Queue status update for async generation tasks.
 * Emitted when job status changes in the provider's queue.
 */
export interface QueueUpdate {
  /** Current job status */
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  /** Position in queue (if queued) */
  queuePosition?: number;
  /** Estimated wait time in seconds */
  estimatedWaitTime?: number;
  /** Human-readable description of current step */
  currentStep?: string;
  /** Job ID for tracking */
  jobId?: string;
}

/**
 * Callbacks for real-time generation updates.
 * Used with the subscribe() method for streaming progress.
 */
export interface SubscribeCallbacks {
  /** Called when queue status changes */
  onQueueUpdate?: (update: QueueUpdate) => void;
  /** Called when progress updates (percentage, step) */
  onProgress?: (update: ProgressUpdate) => void;
  /** Called when new log messages are available */
  onLog?: (log: string) => void;
}

/**
 * Execution capabilities supported by an adapter.
 * Indicates which advanced features the adapter implements.
 */
export interface AdapterExecutionCapabilities {
  /** Supports subscribe() method for real-time updates */
  subscribe: boolean;
  /** Can emit queue status updates */
  queueUpdates: boolean;
  /** Can emit progress percentage updates */
  progressUpdates: boolean;
  /** Supports webhook callbacks */
  webhook: boolean;
  /** Supports job cancellation */
  cancellation: boolean;
}

export interface AIProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: AdapterType | AdapterType[];
  readonly capabilities: Capability[];
  readonly maxConcurrent: number;
  /** Optional execution capabilities (streaming, webhooks, etc.) */
  readonly executionCapabilities?: AdapterExecutionCapabilities;

  configure(apiKey: string, options?: AdapterConfigureOptions): void;
  validate(): Promise<boolean>;
  generate(req: GenerationRequest): Promise<GenerationResult>;
  /**
   * Subscribe to real-time generation updates (optional).
   * Provides streaming progress, queue updates, and logs.
   * Falls back to generate() + polling if not implemented.
   */
  subscribe?(req: GenerationRequest, callbacks: SubscribeCallbacks): Promise<GenerationResult>;
  estimateCost(req: GenerationRequest): CostEstimate;
  checkStatus(jobId: string): Promise<JobStatus>;
  cancel(jobId: string): Promise<void>;
  /**
   * Normalize provider-specific errors into AdapterError (optional).
   * Used for standardized error handling and retry logic.
   */
  normalizeError?(error: unknown, status?: number): AdapterError;
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
  /** Model reasoning/thinking content (if available). Not sent to LLM on next turn. */
  reasoning?: string;
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
  /** Per-provider configuration for message construction and token estimation. */
  readonly profile?: ProviderProfile;
  /** Model context window in tokens, discovered from /models endpoint. */
  readonly contextWindow?: number;
  /** User-configured context window override. */
  readonly userContextWindow?: number;
  /** Effective context window: user override if set, else auto-detected. */
  readonly effectiveContextWindow?: number;

  configure(apiKey: string, options?: Record<string, unknown>): void;
  validate(): Promise<boolean>;

  /** Non-streaming completion */
  complete(messages: LLMMessage[], opts?: LLMRequestOptions): Promise<string>;

  /** Streaming completion — yields chunks */
  stream(messages: LLMMessage[], opts?: LLMRequestOptions): AsyncIterable<string>;

  /** Completion with tool-calling support — returns structured result */
  completeWithTools(messages: LLMMessage[], opts?: LLMRequestOptions): Promise<LLMCompletionResult>;
}
