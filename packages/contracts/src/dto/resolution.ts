/** Media types governed by the unified resolution policy. */
export type ResolutionMediaType = 'reference-image' | 'image' | 'video';

/**
 * A user/AI-authored resolution request. Provider defaults are explicit so a
 * node can bypass a Canvas policy without inventing pixels locally.
 */
export type ResolutionIntent =
  | { mode: 'provider-default'; aspectRatio?: string }
  | { mode: 'exact'; width: number; height: number }
  | { mode: 'tier'; tier: string; aspectRatio?: string };

export type ResolutionSource = 'node' | 'canvas' | 'provider';

export interface ResolutionPolicy {
  referenceImage?: ResolutionIntent;
  image?: ResolutionIntent;
  video?: ResolutionIntent;
}

export interface ResolutionOption {
  id: string;
  label: string;
  mode: ResolutionIntent['mode'];
  width?: number;
  height?: number;
  tier?: string;
  aspectRatio?: string;
  estimatedOutput?: { width?: number; height?: number };
}

export interface ResolutionCapabilities {
  semantics: 'exact' | 'tier' | 'fixed' | 'aspect-only' | 'best-effort';
  nativeDefault: ResolutionOption;
  options: ResolutionOption[];
  exactConstraints?: {
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    maxPixels?: number;
    widthMultiple?: number;
    heightMultiple?: number;
    aspectRatios?: string[];
  };
}

export interface ResolutionResolveContext {
  providerId: string;
  mediaType: Extract<ResolutionMediaType, 'image' | 'video'>;
  source: ResolutionSource;
}

export interface ResolvedResolution extends ResolutionResolveContext {
  requested: ResolutionIntent;
  width?: number;
  height?: number;
  tier?: string;
  aspectRatio?: string;
  /** Exact provider payload value when the provider uses a named size/tier. */
  providerValue?: string;
  /** False for best-effort/provider-default APIs that do not promise pixels. */
  outputKnown: boolean;
}

export type ResolutionPreflightFailureCode =
  'UNSUPPORTED_EXACT' | 'UNSUPPORTED_TIER' | 'UNSUPPORTED_ASPECT_RATIO' | 'UNDECLARED_CAPABILITY';

export type ResolutionPreflightResult =
  | {
      supported: true;
      plan: ResolvedResolution;
      estimatedCostUsd?: number;
      currency: 'USD';
      warnings: string[];
    }
  | {
      supported: false;
      code: ResolutionPreflightFailureCode;
      reason: string;
      alternatives: ResolutionOption[];
    };

/** Durable requested/resolved/actual facts for a generated asset. */
export interface ResolutionAudit {
  requested: ResolutionIntent;
  resolved: ResolvedResolution;
  actual?: { width: number; height: number };
  estimatedCostUsd?: number;
  reportedActualCostUsd?: number;
}

export interface AdapterResolutionController {
  readonly capabilities: ResolutionCapabilities;
  resolve(intent: ResolutionIntent, context: ResolutionResolveContext): ResolutionPreflightResult;
}

export type FinalExportFitMode = 'contain' | 'cover' | 'stretch';
