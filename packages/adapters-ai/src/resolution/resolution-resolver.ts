import {
  getBuiltinMediaProvider,
  getBuiltinProviderCapabilityProfile,
  listBuiltinMediaProviders,
  resolveBuiltinProviderId,
  type AIProviderAdapter,
  type GenerationRequest,
  type ResolutionIntent,
  type ResolutionOption,
  type ResolutionPreflightResult,
  type ResolutionSource,
  type ResolvedResolution,
} from '@lucid-fin/contracts';

export interface ResolutionPreflightInput {
  adapter: AIProviderAdapter;
  request: GenerationRequest;
  intent: ResolutionIntent;
  source: ResolutionSource;
}

export type AppliedResolutionPreflight = ResolutionPreflightResult & {
  request?: GenerationRequest;
};

/** Local-only provider resolution and cost preflight. No validate/generate call is made. */
export function preflightGenerationResolution(
  input: ResolutionPreflightInput,
): AppliedResolutionPreflight {
  const mediaType = input.request.type === 'video' ? 'video' : 'image';
  const context = { providerId: input.adapter.id, mediaType, source: input.source } as const;
  const resolved = input.adapter.resolutionController
    ? input.adapter.resolutionController.resolve(input.intent, context)
    : resolveBuiltinResolution(input.adapter.id, mediaType, input.intent, input.source);
  if (!resolved.supported) return resolved;

  const request = applyResolvedResolution(input.request, resolved.plan);
  const estimate = input.adapter.estimateCost(request);
  if (estimate.currency.toUpperCase() !== 'USD') {
    throw new Error(
      `Provider "${input.adapter.id}" returned a non-USD cost estimate for resolution preflight`,
    );
  }
  if (!Number.isFinite(estimate.estimatedCost) || estimate.estimatedCost < 0) {
    throw new Error(`Provider "${input.adapter.id}" returned an invalid resolution cost estimate`);
  }
  return {
    ...resolved,
    request,
    estimatedCostUsd: estimate.estimatedCost,
    currency: 'USD',
  };
}

export function resolveBuiltinResolution(
  providerId: string,
  mediaType: 'image' | 'video',
  intent: ResolutionIntent,
  source: ResolutionSource,
): ResolutionPreflightResult {
  const profile = getBuiltinProviderCapabilityProfile(providerId);
  const canonicalId = resolveBuiltinProviderId(providerId) ?? providerId.trim().toLowerCase();
  const catalog =
    getBuiltinMediaProvider(mediaType, providerId) ??
    getBuiltinMediaProvider(mediaType, canonicalId) ??
    listBuiltinMediaProviders(mediaType).find(
      (entry) => entry.adapterId === providerId || entry.adapterId === canonicalId,
    );
  if (!profile || profile.type !== mediaType) {
    if (intent.mode !== 'provider-default') {
      return failure(
        'UNDECLARED_CAPABILITY',
        `Provider "${providerId}" has not declared ${mediaType} resolution capabilities`,
        nativeOptions(catalog?.defaultResolution),
      );
    }
    return supported(providerId, mediaType, source, intent, undefined, undefined, false);
  }

  const tiers = resolutionTiers(providerId, [
    ...(profile.qualityTiers ?? []),
    ...(catalog?.qualityTiers ?? []),
  ]);
  const options = buildOptions(profile.resolutions, tiers, catalog?.defaultResolution);
  const aspectFailure = validateAspect(intent, profile.aspectRatios, options);
  if (aspectFailure) return aspectFailure;

  if (intent.mode === 'provider-default') {
    const native = parseDimensions(catalog?.defaultResolution ?? profile.resolutions?.[0]);
    return supported(
      providerId,
      mediaType,
      source,
      intent,
      native?.width,
      native?.height,
      providerId !== 'codex-imagegen' && Boolean(native),
      undefined,
      intent.aspectRatio,
    );
  }

  if (intent.mode === 'tier') {
    const tier = tiers.find((entry) => entry.toLowerCase() === intent.tier.toLowerCase());
    if (!tier) {
      return failure(
        'UNSUPPORTED_TIER',
        `Provider "${providerId}" does not support resolution tier "${intent.tier}"`,
        options,
      );
    }
    const estimated = dimensionsForTier(tier, intent.aspectRatio, profile.resolutions);
    return supported(
      providerId,
      mediaType,
      source,
      { ...intent, tier },
      estimated?.width,
      estimated?.height,
      Boolean(estimated),
      tier,
      intent.aspectRatio,
    );
  }

  const exactValue = `${intent.width}x${intent.height}`;
  const declaredExact =
    profile.resolutions?.find((entry) => entry.toLowerCase() === exactValue.toLowerCase()) ??
    (catalog?.defaultResolution?.toLowerCase() === exactValue.toLowerCase()
      ? catalog.defaultResolution
      : undefined);
  const flexibleExact =
    (!profile.resolutions || profile.resolutions.length === 0) &&
    typeof profile.maxDimension === 'number' &&
    intent.width <= profile.maxDimension &&
    intent.height <= profile.maxDimension;
  if (!declaredExact && !flexibleExact) {
    return failure(
      'UNSUPPORTED_EXACT',
      `Provider "${providerId}" does not support exact output ${exactValue}`,
      options,
    );
  }
  return supported(
    providerId,
    mediaType,
    source,
    intent,
    intent.width,
    intent.height,
    true,
    declaredExact,
    aspectOf(intent.width, intent.height),
  );
}

/** Mirror a host-approved plan into the legacy adapter request shape. */
export function applyResolvedResolution(
  request: GenerationRequest,
  resolution: ResolvedResolution,
): GenerationRequest {
  const params = { ...(request.params ?? {}) };
  for (const key of ['resolution', 'size', 'imageSize', 'aspect_ratio', 'aspectRatio', 'ratio']) {
    delete params[key];
  }

  if (resolution.requested.mode === 'provider-default') {
    const aspect = resolution.requested.aspectRatio;
    if (aspect) params[resolution.mediaType === 'video' ? 'aspect_ratio' : 'aspectRatio'] = aspect;
    return { ...request, width: undefined, height: undefined, resolution, params };
  }

  if (resolution.tier) params.resolution = resolution.providerValue ?? resolution.tier;
  if (resolution.aspectRatio) {
    params[resolution.mediaType === 'video' ? 'aspect_ratio' : 'aspectRatio'] =
      resolution.aspectRatio;
  }
  return {
    ...request,
    width: resolution.requested.mode === 'exact' ? resolution.width : undefined,
    height: resolution.requested.mode === 'exact' ? resolution.height : undefined,
    resolution,
    params,
  };
}

function supported(
  providerId: string,
  mediaType: 'image' | 'video',
  source: ResolutionSource,
  requested: ResolutionIntent,
  width: number | undefined,
  height: number | undefined,
  outputKnown: boolean,
  providerValue?: string,
  aspectRatio?: string,
): ResolutionPreflightResult {
  return {
    supported: true,
    plan: {
      providerId,
      mediaType,
      source,
      requested,
      width,
      height,
      ...(requested.mode === 'tier' ? { tier: requested.tier } : {}),
      aspectRatio,
      providerValue,
      outputKnown,
    },
    currency: 'USD',
    warnings: outputKnown ? [] : ['Provider does not guarantee exact output pixels'],
  };
}

function failure(
  code: Extract<ResolutionPreflightResult, { supported: false }>['code'],
  reason: string,
  alternatives: ResolutionOption[],
): ResolutionPreflightResult {
  return { supported: false, code, reason, alternatives };
}

function validateAspect(
  intent: ResolutionIntent,
  supportedRatios: string[] | undefined,
  alternatives: ResolutionOption[],
): ResolutionPreflightResult | null {
  const requestedRatio =
    intent.mode === 'exact' ? aspectOf(intent.width, intent.height) : intent.aspectRatio;
  if (!requestedRatio || !supportedRatios?.length) return null;
  const requestedValue = ratioValue(requestedRatio);
  const matches = supportedRatios.some((candidate) => {
    const candidateValue = ratioValue(candidate);
    return (
      requestedValue != null &&
      candidateValue != null &&
      Math.abs(candidateValue - requestedValue) / candidateValue < 0.015
    );
  });
  return matches
    ? null
    : failure(
        'UNSUPPORTED_ASPECT_RATIO',
        `Requested aspect ratio ${requestedRatio} is not supported`,
        alternatives,
      );
}

function buildOptions(
  resolutions: string[] | undefined,
  tiers: string[],
  nativeDefault: string | undefined,
): ResolutionOption[] {
  const options = nativeOptions(nativeDefault);
  for (const value of resolutions ?? []) {
    const dimensions = parseDimensions(value);
    if (dimensions && !options.some((entry) => entry.id === `exact:${value}`)) {
      options.push({ id: `exact:${value}`, label: value, mode: 'exact', ...dimensions });
    }
  }
  for (const tier of tiers) {
    options.push({ id: `tier:${tier}`, label: tier, mode: 'tier', tier });
  }
  return options;
}

function nativeOptions(defaultResolution: string | undefined): ResolutionOption[] {
  const dimensions = parseDimensions(defaultResolution);
  return [
    {
      id: 'provider-default',
      label: defaultResolution ? `Provider default (${defaultResolution})` : 'Provider default',
      mode: 'provider-default',
      ...(dimensions ? { estimatedOutput: dimensions } : {}),
    },
  ];
}

function resolutionTiers(providerId: string, qualityTiers: string[] | undefined): string[] {
  const normalized = providerId.trim().toLowerCase();
  const explicit = normalized.includes('minimax') ? ['768P', '2K'] : [];
  return [...new Set([...explicit, ...(qualityTiers ?? []).filter(isResolutionTier)])];
}

function isResolutionTier(value: string): boolean {
  return /^(?:\d{3,4}p|[1248]k|[14]mp)$/i.test(value.trim());
}

function dimensionsForTier(
  tier: string,
  aspectRatio: string | undefined,
  resolutions: string[] | undefined,
): { width: number; height: number } | undefined {
  const normalized = tier.toUpperCase();
  const declared = (resolutions ?? []).map(parseDimensions).filter(Boolean) as Array<{
    width: number;
    height: number;
  }>;
  if (normalized.endsWith('P')) {
    const height = Number.parseInt(normalized, 10);
    const exact = declared.find((entry) => Math.min(entry.width, entry.height) === height);
    if (exact) return exact;
    return dimensionsFromHeight(height, aspectRatio ?? '16:9');
  }
  const maxDimension = normalized === '4K' ? 3840 : normalized === '2K' ? 2048 : undefined;
  if (!maxDimension) return undefined;
  const exact = declared.find((entry) => Math.max(entry.width, entry.height) === maxDimension);
  if (exact) return exact;
  return dimensionsFromWidth(maxDimension, aspectRatio ?? '16:9');
}

function dimensionsFromHeight(height: number, ratio: string): { width: number; height: number } {
  const value = ratioValue(ratio) ?? 16 / 9;
  if (value >= 1) return { width: even(Math.round(height * value)), height };
  return { width: height, height: even(Math.round(height / value)) };
}

function dimensionsFromWidth(width: number, ratio: string): { width: number; height: number } {
  const value = ratioValue(ratio) ?? 16 / 9;
  if (value >= 1) return { width, height: even(Math.round(width / value)) };
  return { width: even(Math.round(width * value)), height: width };
}

function even(value: number): number {
  return value % 2 === 0 ? value : value + 1;
}

function parseDimensions(value: string | undefined): { width: number; height: number } | undefined {
  const match = value?.match(/^(\d+)x(\d+)$/i);
  if (!match) return undefined;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function aspectOf(width: number, height: number): string {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function ratioValue(value: string): number | undefined {
  const match = value.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return undefined;
  const denominator = Number(match[2]);
  return denominator > 0 ? Number(match[1]) / denominator : undefined;
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}
