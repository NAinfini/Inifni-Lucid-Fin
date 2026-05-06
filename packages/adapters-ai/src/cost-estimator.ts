/**
 * Centralized cost estimation utility.
 *
 * Wraps the per-adapter `estimateCost()` with confidence signals and a
 * standardized disclaimer so the UI can display appropriate caveats.
 */

import type { CostEstimate, GenerationRequest, GenerationType } from '@lucid-fin/contracts';
import { getProviderPricing, type ProviderPricing } from './provider-pricing.js';

export type CostConfidence = 'exact' | 'approximate' | 'unknown';

export interface EnrichedCostEstimate {
  /** Estimated cost in USD */
  estimatedCostUsd: number;
  /** How reliable the estimate is */
  confidence: CostConfidence;
  /** Human-readable disclaimer */
  disclaimer: string;
}

const DISCLAIMER_APPROXIMATE = 'Estimate only — actual cost may vary';
const DISCLAIMER_UNKNOWN = 'Cost unknown for this provider';
const DISCLAIMER_LOCAL = 'Local provider — no API cost';

/**
 * Produce an enriched cost estimate for a provider + generation request.
 *
 * Priority:
 *  1. If an adapter-returned `CostEstimate` is provided, use it as the
 *     numeric value and mark confidence based on whether we have pricing data.
 *  2. If no adapter estimate, fall back to the centralized pricing table.
 *  3. Unknown providers return confidence 'unknown' with cost 0.
 */
export function estimateCost(
  providerId: string,
  generationType: GenerationType,
  request: Pick<GenerationRequest, 'prompt' | 'duration' | 'width' | 'height'>,
  adapterEstimate?: CostEstimate,
): EnrichedCostEstimate {
  const pricing = getProviderPricing(providerId);

  // Local / self-hosted providers
  if (isLocalProvider(providerId)) {
    return {
      estimatedCostUsd: 0,
      confidence: 'exact',
      disclaimer: DISCLAIMER_LOCAL,
    };
  }

  // If the adapter already computed a cost, use it
  if (adapterEstimate && adapterEstimate.estimatedCost > 0) {
    return {
      estimatedCostUsd: adapterEstimate.estimatedCost,
      confidence: pricing ? 'approximate' : 'approximate',
      disclaimer: DISCLAIMER_APPROXIMATE,
    };
  }

  // Fall back to centralized pricing table
  if (pricing) {
    const cost = computeFromPricing(pricing, generationType, request);
    if (cost > 0) {
      return {
        estimatedCostUsd: cost,
        confidence: 'approximate',
        disclaimer: DISCLAIMER_APPROXIMATE,
      };
    }
  }

  // Unknown
  return {
    estimatedCostUsd: 0,
    confidence: 'unknown',
    disclaimer: DISCLAIMER_UNKNOWN,
  };
}

function isLocalProvider(providerId: string): boolean {
  const LOCAL_IDS = new Set(['ollama', 'comfyui', 'sd-webui', 'musicgen']);
  return LOCAL_IDS.has(providerId);
}

function computeFromPricing(
  pricing: ProviderPricing,
  generationType: GenerationType,
  request: Pick<GenerationRequest, 'prompt' | 'duration' | 'width' | 'height'>,
): number {
  switch (generationType) {
    case 'image':
      return pricing.perImage ?? 0;

    case 'video':
      return (pricing.perVideoSecond ?? 0) * (request.duration ?? 5);

    case 'voice':
      if (pricing.perCharacter != null) {
        return pricing.perCharacter * (request.prompt?.length ?? 0);
      }
      return (pricing.perAudioSecond ?? 0) * (request.duration ?? 5);

    case 'music':
    case 'sfx':
      return (pricing.perAudioSecond ?? 0) * (request.duration ?? 10);

    case 'text':
      // LLM cost depends on actual token usage which varies wildly.
      // Provide a rough estimate based on prompt length.
      if (pricing.inputPer1kTokens != null) {
        const estimatedInputTokens = Math.ceil((request.prompt?.length ?? 0) / 4);
        const estimatedOutputTokens = 500; // rough default
        return (
          (estimatedInputTokens / 1000) * pricing.inputPer1kTokens +
          (estimatedOutputTokens / 1000) * (pricing.outputPer1kTokens ?? 0)
        );
      }
      return 0;

    default:
      return 0;
  }
}
