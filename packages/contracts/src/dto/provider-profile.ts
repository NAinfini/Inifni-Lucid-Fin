/**
 * Per-provider configuration for message construction and token estimation.
 * Lives in contracts so both `application` and `adapters-ai` can import it.
 */
export interface ProviderProfile {
  /** Provider identifier matching LLMAdapter.id */
  readonly providerId: string;

  /**
   * Average characters per token for budget estimation.
   * - OpenAI GPT-4o / GPT-5: 4.0
   * - Claude (English avg): 3.5
   * - Gemini: 4.0
   * - Ollama / local: 3.5 (conservative)
   */
  readonly charsPerToken: number;

  /**
   * Whether tool names must have `.` replaced with `_` before sending.
   * true: OpenAI-compatible, Claude
   * false: Gemini, Ollama, Cohere
   */
  readonly sanitizeToolNames: boolean;

  /**
   * Max context window utilization ratio. Default 0.95.
   * Reasoning models (o3/o4) need more headroom for CoT → use 0.80.
   * Local models are less reliable at capacity → use 0.85.
   */
  readonly maxUtilization?: number;

  /**
   * Tokens reserved for output generation. Default 4096.
   * Reasoning models need 8192+ for chain-of-thought.
   */
  readonly outputReserveTokens?: number;

  /**
   * Whether this is a reasoning model (uses max_completion_tokens instead of max_tokens).
   */
  readonly reasoningModel?: boolean;
}

export const DEFAULT_PROVIDER_PROFILE: ProviderProfile = {
  providerId: 'unknown',
  charsPerToken: 3.5,
  sanitizeToolNames: false,
  maxUtilization: 0.95,
  outputReserveTokens: 4096,
};
