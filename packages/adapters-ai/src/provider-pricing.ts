/**
 * Centralized provider pricing data for cost estimation.
 *
 * Prices are approximate and based on publicly available pricing pages
 * as of 2026-05. Actual costs depend on account tier, volume discounts,
 * and provider-side changes. Always treat these as estimates.
 */

export interface ProviderPricing {
  providerId: string;
  /** Per-image cost in USD (for image generation providers) */
  perImage?: number;
  /** Per-video-second cost in USD (for video generation providers) */
  perVideoSecond?: number;
  /** Per-audio-second cost in USD (for audio/voice providers) */
  perAudioSecond?: number;
  /** Per-character cost in USD (for TTS providers) */
  perCharacter?: number;
  /** Per-1k-token input cost in USD (for LLM providers) */
  inputPer1kTokens?: number;
  /** Per-1k-token output cost in USD (for LLM providers) */
  outputPer1kTokens?: number;
  /** ISO-8601 date when this pricing was last verified */
  lastUpdated: string;
}

/**
 * Known provider pricing table.
 *
 * Keys match the adapter `id` field used throughout the system.
 * Local/self-hosted providers (ollama, comfyui, sd-webui, musicgen)
 * are intentionally omitted — they cost $0.
 */
export const PROVIDER_PRICING: Record<string, ProviderPricing> = {
  // ── Image providers ────────────────────────────────────────
  'openai-dalle': {
    providerId: 'openai-dalle',
    perImage: 0.04, // DALL-E 3 1024x1024; 0.08 for larger
    lastUpdated: '2026-05-01',
  },
  flux: {
    providerId: 'flux',
    perImage: 0.003,
    lastUpdated: '2026-05-01',
  },
  ideogram: {
    providerId: 'ideogram',
    perImage: 0.08,
    lastUpdated: '2026-05-01',
  },
  recraft: {
    providerId: 'recraft',
    perImage: 0.04,
    lastUpdated: '2026-05-01',
  },
  leonardo: {
    providerId: 'leonardo',
    perImage: 0.02,
    lastUpdated: '2026-05-01',
  },
  'google-imagen-3': {
    providerId: 'google-imagen-3',
    perImage: 0.04,
    lastUpdated: '2026-05-01',
  },

  // ── Video providers ────────────────────────────────────────
  runway: {
    providerId: 'runway',
    perVideoSecond: 0.05,
    lastUpdated: '2026-05-01',
  },
  kling: {
    providerId: 'kling',
    perVideoSecond: 0.07,
    lastUpdated: '2026-05-01',
  },
  luma: {
    providerId: 'luma',
    perVideoSecond: 0.06,
    lastUpdated: '2026-05-01',
  },
  pika: {
    providerId: 'pika',
    perVideoSecond: 0.04,
    lastUpdated: '2026-05-01',
  },
  minimax: {
    providerId: 'minimax',
    perVideoSecond: 0.05,
    lastUpdated: '2026-05-01',
  },
  veo: {
    providerId: 'veo',
    perVideoSecond: 0.05,
    lastUpdated: '2026-05-01',
  },
  higgsfield: {
    providerId: 'higgsfield',
    perVideoSecond: 0.05,
    lastUpdated: '2026-05-01',
  },
  hunyuan: {
    providerId: 'hunyuan',
    perVideoSecond: 0.04,
    lastUpdated: '2026-05-01',
  },
  wan: {
    providerId: 'wan',
    perVideoSecond: 0.04,
    lastUpdated: '2026-05-01',
  },
  seedance: {
    providerId: 'seedance',
    perVideoSecond: 0.05,
    lastUpdated: '2026-05-01',
  },

  // ── Voice / TTS providers ─────────────────────────────────
  elevenlabs: {
    providerId: 'elevenlabs',
    perCharacter: 0.0003, // $0.30 per 1k chars
    lastUpdated: '2026-05-01',
  },
  'openai-tts': {
    providerId: 'openai-tts',
    perCharacter: 0.000015, // $0.015 per 1k chars
    lastUpdated: '2026-05-01',
  },
  cartesia: {
    providerId: 'cartesia',
    perCharacter: 0.00015, // $0.15 per 1k chars
    lastUpdated: '2026-05-01',
  },
  'fish-audio': {
    providerId: 'fish-audio',
    perCharacter: 0.00003,
    lastUpdated: '2026-05-01',
  },
  playht: {
    providerId: 'playht',
    perCharacter: 0.0001, // $0.10 per 1k chars
    lastUpdated: '2026-05-01',
  },

  // ── SFX providers ─────────────────────────────────────────
  'elevenlabs-sfx': {
    providerId: 'elevenlabs-sfx',
    perAudioSecond: 0.01,
    lastUpdated: '2026-05-01',
  },

  // ── Music providers ───────────────────────────────────────
  suno: {
    providerId: 'suno',
    perAudioSecond: 0.01,
    lastUpdated: '2026-05-01',
  },
  udio: {
    providerId: 'udio',
    perAudioSecond: 0.01,
    lastUpdated: '2026-05-01',
  },
  'stability-audio': {
    providerId: 'stability-audio',
    perAudioSecond: 0.01,
    lastUpdated: '2026-05-01',
  },

  // ── LLM providers ─────────────────────────────────────────
  'openai-llm': {
    providerId: 'openai-llm',
    inputPer1kTokens: 0.005,
    outputPer1kTokens: 0.015,
    lastUpdated: '2026-05-01',
  },
  'claude-llm': {
    providerId: 'claude-llm',
    inputPer1kTokens: 0.003,
    outputPer1kTokens: 0.015,
    lastUpdated: '2026-05-01',
  },
  'gemini-llm': {
    providerId: 'gemini-llm',
    inputPer1kTokens: 0.00025,
    outputPer1kTokens: 0.001,
    lastUpdated: '2026-05-01',
  },
  'deepseek-llm': {
    providerId: 'deepseek-llm',
    inputPer1kTokens: 0.00014,
    outputPer1kTokens: 0.00028,
    lastUpdated: '2026-05-01',
  },
  'grok-llm': {
    providerId: 'grok-llm',
    inputPer1kTokens: 0.003,
    outputPer1kTokens: 0.015,
    lastUpdated: '2026-05-01',
  },
  'cohere-llm': {
    providerId: 'cohere-llm',
    inputPer1kTokens: 0.001,
    outputPer1kTokens: 0.002,
    lastUpdated: '2026-05-01',
  },
  'qwen-llm': {
    providerId: 'qwen-llm',
    inputPer1kTokens: 0.0005,
    outputPer1kTokens: 0.0015,
    lastUpdated: '2026-05-01',
  },
};

/**
 * Look up pricing for a provider by its adapter ID.
 * Returns `undefined` for unknown or local providers.
 */
export function getProviderPricing(providerId: string): ProviderPricing | undefined {
  return PROVIDER_PRICING[providerId];
}
