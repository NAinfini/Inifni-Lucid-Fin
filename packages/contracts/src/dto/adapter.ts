import type {
  GenerationRequest,
  GenerationResult,
  CostEstimate,
  JobStatus,
  GenerationType,
} from './generation.js';
import type { AdapterError } from '../errors/index.js';
import type { ProviderProfile } from './provider-profile.js';
import type { AdapterResolutionController } from './resolution.js';
import type { OAuthProviderTarget } from '../oauth-provider.js';

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
  | 'image-understanding'
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

/**
 * Declares how an adapter consumes visual conditioning inputs.
 *
 * The generic `image-to-*` capabilities only prove that a provider can accept
 * one primary image.  Adapters must opt in here before callers may send more
 * than one ordered reference image or a distinct final-frame constraint.
 */
export interface AdapterConditioningCapabilities {
  /** Ordered generic references (character, location, equipment, or style). */
  referenceImages?: {
    maxImages: number;
    preservesOrder: boolean;
    /** Explicit opt-in when generic references may coexist with source/first/last frame inputs. */
    canCombineWithFrameImages?: boolean;
  };
  /** Accepts a dedicated first-frame image in addition to generic references. */
  firstFrame?: boolean;
  /** Accepts a dedicated last-frame image in addition to generic references. */
  lastFrame?: boolean;
}

/** Provider-facing prompt bounds checked before validation, billing, or submission. */
export interface AdapterPromptLimits {
  maxPromptChars: number;
  maxNegativePromptChars?: number;
  negativePrompt: 'native' | 'embedded' | 'unsupported' | 'unknown';
}

export interface AIProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly type: AdapterType | AdapterType[];
  readonly capabilities: Capability[];
  readonly maxConcurrent: number;
  /** How credentials are supplied. Managed adapters own auth outside the API-key keychain. */
  readonly credentialMode?: 'api-key' | 'oauth' | 'none';
  /** Capability-scoped OAuth identity used by managed adapters. */
  readonly oauthTarget?: OAuthProviderTarget;
  /** Optional execution capabilities (streaming, webhooks, etc.) */
  readonly executionCapabilities?: AdapterExecutionCapabilities;
  /** Explicit visual-conditioning limits. Missing declarations fail closed. */
  readonly conditioningCapabilities?: AdapterConditioningCapabilities;
  /** Optional pure, no-network resolution capability declaration. */
  readonly resolutionController?: AdapterResolutionController;
  /** Pure request-aware prompt capability declaration. */
  getPromptLimits?(request: GenerationRequest): AdapterPromptLimits;

  configure(apiKey: string, options?: AdapterConfigureOptions): void;
  validate(): Promise<boolean>;
  generate(req: GenerationRequest): Promise<GenerationResult>;
  /** Retrieve the completed asset for providers whose initial response only reserves a job. */
  getResult?(jobId: string): Promise<GenerationResult>;
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
  /** Provider reasoning that must be replayed during tool-call continuation. */
  reasoning?: string;
  toolCalls?: LLMToolCall[];
  toolCallId?: string; // for role='tool' messages
}

interface LLMToolSchemaBase {
  description?: string;
  nullable?: boolean;
}

export type LLMToolParameter =
  | (LLMToolSchemaBase & {
      type: 'string';
      enum?: string[];
    })
  | (LLMToolSchemaBase & {
      type: 'number';
      enum?: number[];
    })
  | (LLMToolSchemaBase & {
      type: 'boolean';
      enum?: boolean[];
    })
  | (LLMToolSchemaBase & {
      type: 'object';
      properties: Record<string, LLMToolParameter>;
      required?: string[];
      additionalProperties?: boolean | LLMToolParameter;
    })
  | (LLMToolSchemaBase & {
      type: 'array';
      items: LLMToolParameter;
    })
  | (LLMToolSchemaBase & {
      const: string | number | boolean | null;
    })
  | (LLMToolSchemaBase & {
      anyOf: LLMToolParameter[];
    });

export type LLMToolInputSchema = Extract<LLMToolParameter, { type: 'object' }>;

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: LLMToolInputSchema;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Opaque Gemini continuation token; must be returned byte-for-byte. */
  thoughtSignature?: string;
  /** The provider requested this call in-turn and the host bridge already executed it. */
  handledByProviderLoop?: boolean;
}

export interface LLMToolResult {
  toolCallId: string;
  content: string;
}

export interface ProviderToolExecutionResult {
  toolCallId: string;
  content: string;
  success: boolean;
}

export interface ProviderToolBridge {
  execute(call: LLMToolCall): Promise<ProviderToolExecutionResult>;
}

export type LLMFinishReason = 'stop' | 'tool_calls' | 'length' | 'error';

/**
 * Events produced by a streaming LLM adapter. The orchestrator consumes
 * these via `for await` and forwards each to the renderer so reasoning,
 * text, and tool-call arguments stream token-by-token. Tool arg JSON is
 * accumulated per `id` across `tool_call_args_delta` events and finalized
 * by `tool_call_complete`.
 */
export type LLMStreamEvent =
  | { kind: 'reasoning_delta'; delta: string }
  | { kind: 'text_delta'; delta: string }
  | { kind: 'tool_call_started'; id: string; name: string }
  | { kind: 'tool_call_args_delta'; id: string; delta: string }
  | {
      kind: 'tool_call_complete';
      id: string;
      name: string;
      arguments: Record<string, unknown>;
      thoughtSignature?: string;
      handledByProviderLoop?: boolean;
    }
  | {
      kind: 'usage';
      promptTokens?: number;
      completionTokens?: number;
      reasoningTokens?: number;
    }
  | { kind: 'finished'; finishReason: LLMFinishReason };

export interface LLMRequestOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  tools?: LLMToolDefinition[];
  toolChoice?: 'auto' | 'none' | { name: string };
  /** Cancels the underlying fetch and ends the iterator. */
  signal?: AbortSignal;
  /** Host-owned execution bridge for providers whose tool loop remains inside one turn. */
  providerToolBridge?: ProviderToolBridge;
}

/**
 * Pre-execution billing fact supplied by an adapter. Approximate price
 * tables are not sufficient: `upper_bound` must be a finite conservative
 * ceiling for this exact request, while `free` is an explicit provider
 * guarantee. Missing capability is treated as `unknown`.
 */
export type LLMCostUpperBound =
  | { kind: 'free' }
  | { kind: 'upper_bound'; knowledge: 'known' | 'estimated'; amountUsd: number }
  | { kind: 'unknown' };

export interface LLMAdapter {
  readonly id: string;
  readonly name: string;
  readonly capabilities: Capability[];
  readonly credentialMode?: 'api-key' | 'oauth' | 'none';
  readonly oauthTarget?: OAuthProviderTarget;
  readonly toolLoopMode?: 'host-returned' | 'provider-managed';
  /** Per-provider configuration for message construction and token estimation. */
  readonly profile?: ProviderProfile;
  /** Model context window in tokens, discovered from /models endpoint. */
  readonly contextWindow?: number;
  /** User-configured context window override. */
  readonly userContextWindow?: number;
  /** Effective context window: user override if set, else auto-detected. */
  readonly effectiveContextWindow?: number;

  /** Pure request quote used before any network call or billable work. */
  quoteCostUpperBound?(messages: readonly LLMMessage[], opts: LLMRequestOptions): LLMCostUpperBound;

  configure(apiKey: string, options?: Record<string, unknown>): void;
  validate(): Promise<boolean>;

  /** Non-streaming completion */
  complete(messages: LLMMessage[], opts?: LLMRequestOptions): Promise<string>;

  /** Streaming text-only completion — yields chunks */
  stream(messages: LLMMessage[], opts?: LLMRequestOptions): AsyncIterable<string>;

  /**
   * Streaming completion with tool-calling support. The returned async
   * iterable yields `LLMStreamEvent`s — reasoning/text deltas, tool-call
   * start/args-delta/complete, usage, and a final `finished`. Cancellable
   * via `opts.signal`.
   */
  completeWithTools(
    messages: LLMMessage[],
    opts?: LLMRequestOptions,
  ): Promise<AsyncIterable<LLMStreamEvent>>;
}
