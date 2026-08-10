import type {
  AdapterPromptLimits,
  AIProviderAdapter,
  GenerationRequest,
} from '@lucid-fin/contracts';

export const DEFAULT_GENERATION_PROMPT_LIMITS: AdapterPromptLimits = {
  maxPromptChars: 12_000,
  maxNegativePromptChars: 4_000,
  negativePrompt: 'unknown',
};

export interface GenerationPromptAudit {
  promptChars: number;
  negativePromptChars: number;
  limits: AdapterPromptLimits;
}

/** Fail locally before provider validation, billing, or submission. */
export function preflightGenerationPrompt(
  adapter: AIProviderAdapter,
  request: GenerationRequest,
): GenerationPromptAudit {
  const limits = adapter.getPromptLimits?.(request) ?? DEFAULT_GENERATION_PROMPT_LIMITS;
  const promptChars = request.prompt.length;
  const negativePromptChars = request.negativePrompt?.length ?? 0;

  if (!request.prompt.trim()) {
    throw new Error(`Provider "${adapter.id}" requires a non-empty generation prompt`);
  }
  if (promptChars > limits.maxPromptChars) {
    throw new Error(
      `Provider "${adapter.id}" accepts at most ${limits.maxPromptChars} prompt characters; received ${promptChars}`,
    );
  }
  if (negativePromptChars > 0 && limits.negativePrompt === 'unsupported') {
    throw new Error(
      `Provider "${adapter.id}" does not support a separate negative prompt; choose a compatible provider or remove the negative constraints`,
    );
  }
  if (
    negativePromptChars > 0 &&
    limits.maxNegativePromptChars !== undefined &&
    negativePromptChars > limits.maxNegativePromptChars
  ) {
    throw new Error(
      `Provider "${adapter.id}" accepts at most ${limits.maxNegativePromptChars} negative-prompt characters; received ${negativePromptChars}`,
    );
  }

  return { promptChars, negativePromptChars, limits };
}
