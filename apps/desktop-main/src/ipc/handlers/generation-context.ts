import {
  preflightGenerationPrompt,
  preflightGenerationResolution,
  resolveEffectiveResolutionIntent,
  type AdapterRegistry,
} from '@lucid-fin/adapters-ai';
import { compilePrompt, type PromptMode } from '@lucid-fin/application';
import type {
  AIProviderAdapter,
  AudioNodeData,
  Canvas,
  CanvasNode,
  Capability,
  GenerationRequest,
  GenerationType,
  ImageNodeData,
  PresetTrackSet,
  VideoNodeData,
} from '@lucid-fin/contracts';
import { BUILT_IN_PRESET_LIBRARY, getBuiltinMediaProvider } from '@lucid-fin/contracts';
import { resolveCanvasVisualStylePolicy } from '@lucid-fin/shared-utils';
import type { CAS, Keychain } from '@lucid-fin/storage';
import log from '../../logger.js';
import { isStoredKeyAllowedForBaseUrl } from './provider-host-allowlist.js';
import {
  type BuiltGenerationContext,
  type CanvasGenerationDeps,
  type GenerationMediaConfig,
  type ProviderConfigOverride,
  DEFAULT_AUDIO_DURATION,
  DEFAULT_VIDEO_DURATION,
  MAX_VARIANTS,
  buildAdhocAdapter,
  resolveStoredProviderApiKey,
  normalizeErrorMessage,
  normalizeOptionalString,
  resolveImg2ImgSourcePath,
  resolvePositiveInteger,
} from './generation-helpers.js';
import {
  applyStyleGuideDefaultsToEmptyTracks,
  collectConnectedTextContent,
  findConnectedImageHash,
  hasCharacterRefs,
  hasEquipmentRefs,
  hasLocationRefs,
  hasPresetTracks,
  loadCurrentProjectStyleGuide,
  resolveCharacterEntities,
  resolveLocationEntities,
  resolveEntityRefsAndImages,
  resolveVideoFrameReferenceImageSet,
  resolveVideoFrameReferenceImages,
  resolveStandaloneEquipment,
} from './generation-prompt-compiler.js';

// ---------------------------------------------------------------------------
// Generation context builder
// ---------------------------------------------------------------------------

export async function buildGenerationContext(
  deps: CanvasGenerationDeps,
  input: {
    canvasId: string;
    nodeId: string;
    requestedProviderId?: string;
    requestedProviderConfig?: ProviderConfigOverride;
    requestedVariantCount?: number;
    requestedSeed?: number;
    // Commander-authored creative body. It never bypasses deterministic style compilation.
    finalPrompt?: string;
    /** Host-only exact-prompt mode for additive refinement from a stored asset. */
    promptInputMode?: 'base' | 'precompiled';
    /** Approved production ignores mutable Canvas draft styling. */
    styleAuthority?: 'canvas' | 'visual-constitution';
  },
): Promise<BuiltGenerationContext> {
  const canvas = deps.canvasStore.get(input.canvasId);
  if (!canvas) throw new Error(`Canvas not found: ${input.canvasId}`);

  const node = canvas.nodes.find((entry) => entry.id === input.nodeId);
  if (!node) throw new Error(`Node not found: ${input.nodeId}`);
  if (node.type === 'text') {
    throw new Error('Text nodes cannot be generated');
  }

  const generableNodeType: 'image' | 'video' | 'audio' =
    node.type === 'backdrop' ? 'image' : node.type;

  const connectedTextContent = collectConnectedTextContent(canvas, node.id);
  const entityRefsAndImages = resolveEntityRefsAndImages(deps.db, node);
  const mode = determinePromptMode(canvas, node, entityRefsAndImages.referenceImages.length > 0);
  const generationType = determineGenerationType(node);
  const providerId = resolveNodeProviderId(node, input.requestedProviderId);
  const adapter = await resolveAdapter(
    deps.adapterRegistry,
    providerId,
    generationType,
    mode,
    input.requestedProviderConfig,
    deps.keychain,
    deps.cas,
  );
  const nodeData = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  const variantCount = resolveVariantCount(nodeData, input.requestedVariantCount);
  const baseSeed = resolveBaseSeed(nodeData, input.requestedSeed);
  const canvasVisualStyle =
    input.styleAuthority === 'visual-constitution'
      ? undefined
      : resolveCanvasVisualStylePolicy(canvas.settings);
  const projectStyleGuide =
    input.styleAuthority === 'visual-constitution' || canvasVisualStyle
      ? undefined
      : loadCurrentProjectStyleGuide(deps.db);
  const nodePresetTracks = hasPresetTracks(nodeData) ? nodeData.presetTracks : undefined;

  const presetTracks =
    generableNodeType === 'audio'
      ? undefined
      : projectStyleGuide
        ? applyStyleGuideDefaultsToEmptyTracks(
            nodePresetTracks,
            projectStyleGuide,
            BUILT_IN_PRESET_LIBRARY,
          )
        : nodePresetTracks;
  const characterRefs = hasCharacterRefs(nodeData) ? nodeData.characterRefs : undefined;
  const equipmentRefs = hasEquipmentRefs(nodeData) ? nodeData.equipmentRefs : undefined;
  const locationRefs = hasLocationRefs(nodeData) ? nodeData.locationRefs : undefined;

  const resolvedCharacters = resolveCharacterEntities(deps.db, characterRefs);
  const resolvedLocations = resolveLocationEntities(deps.db, locationRefs);
  const resolvedEquipment = resolveStandaloneEquipment(deps.db, equipmentRefs, resolvedCharacters);
  const referenceImages = entityRefsAndImages.referenceImages;
  const videoFrameReferenceImages =
    generableNodeType === 'video' ? resolveVideoFrameReferenceImageSet(canvas, node) : undefined;
  const connectedSourceHash =
    generableNodeType === 'video' ? findConnectedImageHash(canvas, node.id) : undefined;
  const sourceNodeData =
    node.type === 'image' || node.type === 'video'
      ? (node.data as ImageNodeData | VideoNodeData)
      : undefined;
  const sourceImageHash =
    normalizeOptionalString(sourceNodeData?.sourceImageHash) ??
    (generableNodeType === 'video' && !videoFrameReferenceImages?.first
      ? connectedSourceHash
      : undefined);

  // Select the best prompt for this generation type:
  // All nodes: prompt > title
  const suppliedPrompt = normalizeOptionalString(input.finalPrompt);
  const precompiledPrompt = input.promptInputMode === 'precompiled' ? suppliedPrompt : undefined;
  const effectivePrompt =
    (input.promptInputMode !== 'precompiled' ? suppliedPrompt : undefined) ??
    normalizeOptionalString(nodeData.prompt) ??
    node.title;

  const compiled = compilePrompt({
    nodeType: generableNodeType,
    prompt: effectivePrompt,
    negativePrompt: normalizeOptionalString(nodeData.negativePrompt),
    presetTracks: presetTracks as PresetTrackSet | undefined,
    characterRefs,
    equipmentRefs,
    locationRefs,
    characters: resolvedCharacters.length > 0 ? resolvedCharacters : undefined,
    equipmentItems: resolvedEquipment.length > 0 ? resolvedEquipment : undefined,
    locations: resolvedLocations.length > 0 ? resolvedLocations : undefined,
    connectedTextContent,
    providerId: adapter.id,
    mode,
    presetLibrary: BUILT_IN_PRESET_LIBRARY,
    referenceImages,
    referenceBindings: entityRefsAndImages.referenceBindings,
    visualStylePolicy: canvasVisualStyle?.policy,
    styleGuide: projectStyleGuide
      ? {
          artStyle: projectStyleGuide.global.artStyle,
          lighting: projectStyleGuide.global.lighting,
          colorPalette: projectStyleGuide.global.colorPalette.primary,
        }
      : undefined,
  });

  // The host may preserve an exact stored provider prompt only for additive
  // refinement. preparePromptRefinement verifies its style provenance first.
  if (precompiledPrompt) {
    compiled.prompt = precompiledPrompt;
    log.info('[prompt] using stored provider prompt for additive refinement', {
      category: 'prompt-compiler',
      canvasId: input.canvasId,
      nodeId: input.nodeId,
      wordCount: precompiledPrompt.split(/\s+/).filter(Boolean).length,
    });
  }

  if (compiled.diagnostics.length > 0) {
    for (const diag of compiled.diagnostics) {
      const level = diag.severity === 'warning' ? 'warn' : 'info';
      log[level](`[prompt] ${diag.message}`, {
        category: 'prompt-compiler',
        canvasId: input.canvasId,
        nodeId: input.nodeId,
        type: diag.type,
        source: diag.source,
      });
    }
    log.debug('[prompt] compilation summary', {
      category: 'prompt-compiler',
      wordCount: compiled.wordCount,
      segmentCount: compiled.segments.length,
      diagnosticCount: compiled.diagnostics.length,
    });
  }
  const mediaConfig = resolveMediaDimensions(node, generationType, canvas);
  const { fps, ...mediaRequest } = mediaConfig;

  const videoData = node.type === 'video' ? (node.data as VideoNodeData) : undefined;

  const imageOrVideoData =
    node.type === 'image' || node.type === 'video'
      ? (node.data as ImageNodeData | VideoNodeData)
      : undefined;

  let requestBase: GenerationRequest = {
    type: generationType,
    providerId: adapter.id,
    prompt: compiled.prompt,
    negativePrompt: compiled.negativePrompt,
    referenceImages: compiled.referenceImages,
    seed: baseSeed,
    audio: videoData?.audio,
    quality: videoData?.quality,
    params: mergeGenerationParams(compiled.params, fps),
    ...mediaRequest,
    sourceImageHash,
    frameReferenceImages:
      videoFrameReferenceImages?.first || videoFrameReferenceImages?.last
        ? videoFrameReferenceImages
        : undefined,
    img2imgStrength: imageOrVideoData?.img2imgStrength,
    steps: imageOrVideoData?.steps,
    cfgScale: imageOrVideoData?.cfgScale,
    scheduler: normalizeOptionalString(imageOrVideoData?.scheduler),
    emotionVector:
      generableNodeType === 'audio' ? (nodeData as AudioNodeData).emotionVector : undefined,
  };

  preflightGenerationPrompt(adapter, requestBase);
  ensureAdapterConditioningSupports(adapter, requestBase, deps.cas);

  let resolutionPreflight: BuiltGenerationContext['resolutionPreflight'];
  if (generationType === 'image' || generationType === 'video') {
    const effective = resolveEffectiveResolutionIntent({
      mediaType: generationType,
      canvasSettings: canvas.settings,
      nodeData: node.data as ImageNodeData | VideoNodeData,
    });
    const preflight = preflightGenerationResolution({
      adapter,
      request: requestBase,
      intent: effective.intent,
      source: effective.source,
    });
    if (!preflight.supported || !preflight.request) {
      const alternatives = preflight.supported
        ? ''
        : preflight.alternatives.map((option) => option.label).join(', ');
      const reason = preflight.supported
        ? 'Resolution request could not be applied'
        : preflight.reason;
      throw new Error(
        `${reason}${alternatives ? `. Supported alternatives: ${alternatives}` : ''}`,
      );
    }
    const appliedRequest = preflight.request;
    requestBase = appliedRequest;
    resolutionPreflight = { ...preflight, request: appliedRequest };
  }

  const resolvedEntityRefs =
    generableNodeType !== 'audio'
      ? {
          characterRefs: entityRefsAndImages.characterRefs,
          equipmentRefs: entityRefsAndImages.equipmentRefs,
          locationRefs: entityRefsAndImages.locationRefs,
        }
      : {};

  return {
    canvas,
    node,
    requestBase,
    adapter,
    nodeType: generableNodeType,
    generationType,
    mode,
    variantCount,
    baseSeed,
    compiled,
    visualStyle: canvasVisualStyle?.provenance,
    resolutionPreflight,
    resolvedEntityRefs,
  };
}

// ---------------------------------------------------------------------------
// Prompt mode / generation type
// ---------------------------------------------------------------------------

export function determinePromptMode(
  canvas: Canvas,
  node: CanvasNode,
  hasEntityReferenceImages = false,
): PromptMode {
  if (node.type === 'image' || node.type === 'backdrop') {
    const data = node.data as ImageNodeData;
    if (normalizeOptionalString(data.sourceImageHash) || hasEntityReferenceImages) {
      return 'image-to-image';
    }
    return 'text-to-image';
  }
  if (node.type === 'video') {
    const data = node.data as VideoNodeData;
    if (hasEntityReferenceImages) {
      return 'image-to-video';
    }
    if (resolveVideoFrameReferenceImages(canvas, node).length > 0) {
      return 'image-to-video';
    }
    if (normalizeOptionalString(data.sourceImageHash)) {
      return 'image-to-video';
    }
    const connectedSource = findConnectedImageHash(canvas, node.id);
    if (connectedSource) {
      return 'image-to-video';
    }
    return 'text-to-video';
  }
  // Audio nodes — mode is not used by audio adapters, but return a sensible value
  return 'text-to-image';
}

/**
 * Fail closed before cost reservation/provider submission when a request would
 * otherwise drop, reorder, or exceed an adapter's visual conditioning inputs.
 */
export function ensureAdapterConditioningSupports(
  adapter: AIProviderAdapter,
  request: GenerationRequest,
  cas?: CAS,
): void {
  const references = request.referenceImages ?? [];
  const source = normalizeOptionalString(request.sourceImageHash);
  const firstFrame = normalizeOptionalString(request.frameReferenceImages?.first);
  const lastFrame = normalizeOptionalString(request.frameReferenceImages?.last);
  const declared = adapter.conditioningCapabilities;

  if (cas) {
    for (const hash of [source, ...references, firstFrame, lastFrame]) {
      if (hash && !resolveImg2ImgSourcePath(hash, cas)) {
        throw new Error(
          `Provider "${adapter.id}" cannot start because reference asset "${hash}" is missing from CAS`,
        );
      }
    }
  }

  if (request.type === 'image') {
    if (references.length > 0 && !declared?.referenceImages) {
      throw new Error(
        `Provider "${adapter.id}" does not declare support for ordered reference images`,
      );
    }
    const inputCount = references.length + (source ? 1 : 0);
    if (declared?.referenceImages && inputCount > declared.referenceImages.maxImages) {
      throw new Error(
        `Provider "${adapter.id}" supports at most ${declared.referenceImages.maxImages} reference images; received ${inputCount}`,
      );
    }
    if (references.length > 1 && declared?.referenceImages?.preservesOrder !== true) {
      throw new Error(`Provider "${adapter.id}" cannot preserve ordered reference images`);
    }
    return;
  }

  if (request.type !== 'video') return;

  if (lastFrame && declared?.lastFrame !== true) {
    throw new Error(`Provider "${adapter.id}" does not declare last-frame conditioning support`);
  }
  if (references.length > 1 && !declared?.referenceImages) {
    throw new Error(
      `Provider "${adapter.id}" accepts only one primary conditioning image; received ${references.length} ordered references`,
    );
  }
  if (declared?.referenceImages) {
    const genericCount = references.length + (source ? 1 : 0);
    if (genericCount > declared.referenceImages.maxImages) {
      throw new Error(
        `Provider "${adapter.id}" supports at most ${declared.referenceImages.maxImages} generic reference images; received ${genericCount}`,
      );
    }
    if (references.length > 1 && !declared.referenceImages.preservesOrder) {
      throw new Error(`Provider "${adapter.id}" cannot preserve ordered reference images`);
    }
    if (
      references.length > 0 &&
      (source || firstFrame || lastFrame) &&
      declared.referenceImages.canCombineWithFrameImages !== true
    ) {
      throw new Error(
        `Provider "${adapter.id}" cannot combine ordered references with first, last, or source frame images`,
      );
    }
  }

  const primaryInputCount = (source ? 1 : 0) + references.length + (firstFrame ? 1 : 0);
  if (!declared?.referenceImages && primaryInputCount > 1) {
    throw new Error(
      `Provider "${adapter.id}" accepts one primary conditioning image; the request contains ${primaryInputCount}`,
    );
  }
  if (declared?.referenceImages && firstFrame && (source || references.length > 0)) {
    if (declared.firstFrame !== true) {
      throw new Error(
        `Provider "${adapter.id}" cannot combine a first-frame constraint with generic references`,
      );
    }
  }
  if (source && firstFrame) {
    throw new Error(
      `Provider "${adapter.id}" cannot preserve both source-image and first-frame semantics`,
    );
  }
}

export function determineGenerationType(node: CanvasNode): GenerationType {
  if (node.type === 'image' || node.type === 'backdrop') return 'image';
  if (node.type === 'video') return 'video';
  const audio = node.data as AudioNodeData;
  return audio.audioType;
}

export function resolveNodeProviderId(
  node: CanvasNode,
  requestedProviderId?: string,
): string | undefined {
  if (requestedProviderId) return normalizeOptionalString(requestedProviderId);
  const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  return normalizeOptionalString(data.providerId);
}

// ---------------------------------------------------------------------------
// Adapter resolution
// ---------------------------------------------------------------------------

export async function resolveAdapter(
  registry: AdapterRegistry,
  requestedProviderId: string | undefined,
  generationType: GenerationType,
  mode: PromptMode,
  providerConfig?: ProviderConfigOverride,
  keychain?: Keychain,
  cas?: CAS,
): Promise<AIProviderAdapter> {
  const canonicalProviderId = normalizeOptionalString(requestedProviderId);
  if (canonicalProviderId) {
    const adapter =
      registry.resolve?.(canonicalProviderId, generationType) ?? registry.get(canonicalProviderId);
    if (adapter) {
      try {
        ensureAdapterSupports(adapter, generationType, mode);
      } catch (error) {
        if (providerConfig && keychain) {
          log.warn(
            '[canvas:generation] registered adapter incompatible with requested media type, falling back to ad-hoc provider config',
            {
              category: 'canvas-generation',
              requestedProviderId,
              canonicalProviderId,
              adapterId: adapter.id,
              generationType,
              mode,
              error: normalizeErrorMessage(error),
            },
          );
          return buildAdhocAdapter(
            canonicalProviderId,
            providerConfig,
            keychain,
            generationType,
            cas,
          );
        }
        throw error;
      }
      if (adapter.credentialMode === 'oauth') {
        return adapter;
      }
      const apiKey = await resolveProviderApiKey(
        keychain,
        canonicalProviderId,
        providerConfig,
        generationType === 'image' || generationType === 'video' ? generationType : undefined,
      );
      const options: Record<string, unknown> = { generationType };
      if (providerConfig?.baseUrl) {
        options.baseUrl = providerConfig.baseUrl;
      }
      if (providerConfig?.model) {
        options.model = providerConfig.model;
      }
      adapter.configure(apiKey ?? '', options);
      return adapter;
    }
    const builtinMediaProvider =
      generationType === 'image' || generationType === 'video'
        ? getBuiltinMediaProvider(generationType, canonicalProviderId)
        : undefined;
    if (builtinMediaProvider) {
      throw new Error(
        `Built-in ${generationType} provider "${canonicalProviderId}" has no registered adapter (${builtinMediaProvider.adapterId})`,
      );
    }
    if (providerConfig && keychain) {
      return buildAdhocAdapter(canonicalProviderId, providerConfig, keychain, generationType, cas);
    }
  }

  const candidates = registry.list(mapGenerationTypeToAdapterType(generationType));
  const supported = candidates.find((adapter) => {
    try {
      ensureAdapterSupports(adapter, generationType, mode);
      return true;
    } catch {
      /* adapter doesn't support this generation type/mode — skip it */
      return false;
    }
  });
  if (!supported) {
    throw new Error(`No configured adapter available for ${generationType}`);
  }
  if (supported.credentialMode === 'oauth') {
    return supported;
  }
  const fallbackApiKey = await resolveProviderApiKey(
    keychain,
    supported.id,
    providerConfig,
    generationType === 'image' || generationType === 'video' ? generationType : undefined,
  );
  supported.configure(fallbackApiKey ?? '', { generationType });
  return supported;
}

async function resolveProviderApiKey(
  keychain: Keychain | undefined,
  providerId: string,
  providerConfig?: ProviderConfigOverride,
  group?: 'image' | 'video',
): Promise<string | undefined> {
  if (providerConfig?.apiKey) {
    return providerConfig.apiKey;
  }
  if (!keychain) {
    return undefined;
  }

  // Security: never send the stored key to a renderer-supplied baseUrl that is
  // not a canonical host for this provider. A compromised renderer could
  // otherwise exfiltrate the key by pointing baseUrl at an arbitrary host.
  if (!isStoredKeyAllowedForBaseUrl(providerId, providerConfig?.baseUrl, group)) {
    log.warn('[canvas:generation] refusing to attach stored key to untrusted baseUrl', {
      category: 'canvas-generation',
      providerId,
      baseUrl: providerConfig?.baseUrl,
    });
    return undefined;
  }

  return resolveStoredProviderApiKey(keychain, providerId, group);
}

export function ensureAdapterSupports(
  adapter: AIProviderAdapter,
  generationType: GenerationType,
  mode: PromptMode,
): void {
  const adapterTypes = Array.isArray(adapter.type) ? adapter.type : [adapter.type];
  const expectedType = mapGenerationTypeToAdapterType(generationType);
  if (!adapterTypes.includes(expectedType)) {
    const msg = `Provider "${adapter.id}" does not support ${generationType}`;
    log.warn(msg, { providerId: adapter.id, generationType, adapterTypes });
    throw new Error(msg);
  }

  const requiredCapability = resolveRequiredCapability(generationType, mode);
  if (requiredCapability && !adapter.capabilities.includes(requiredCapability)) {
    const msg = `Provider "${adapter.id}" does not support capability ${requiredCapability}`;
    log.warn(msg, {
      providerId: adapter.id,
      requiredCapability,
      capabilities: adapter.capabilities,
    });
    throw new Error(msg);
  }
}

function resolveRequiredCapability(
  generationType: GenerationType,
  mode: PromptMode,
): Capability | undefined {
  if (generationType === 'image') {
    return mode === 'image-to-image' ? 'image-to-image' : 'text-to-image';
  }
  if (generationType === 'video') {
    return mode === 'image-to-video' ? 'image-to-video' : 'text-to-video';
  }
  if (generationType === 'voice') return 'text-to-voice';
  if (generationType === 'music') return 'text-to-music';
  if (generationType === 'sfx') return 'text-to-sfx';
  return undefined;
}

export function mapGenerationTypeToAdapterType(
  generationType: GenerationType,
): 'image' | 'video' | 'voice' | 'music' | 'sfx' {
  if (generationType === 'image') return 'image';
  if (generationType === 'video') return 'video';
  if (generationType === 'voice') return 'voice';
  if (generationType === 'music') return 'music';
  return 'sfx';
}

export function mapGenerationTypeToAssetType(
  generationType: GenerationType,
): 'image' | 'video' | 'audio' {
  if (generationType === 'image') return 'image';
  if (generationType === 'video') return 'video';
  return 'audio';
}

// ---------------------------------------------------------------------------
// Variant / seed / media config
// ---------------------------------------------------------------------------

export function resolveVariantCount(
  data: ImageNodeData | VideoNodeData | AudioNodeData,
  requestedVariantCount?: number,
): number {
  const candidate = requestedVariantCount ?? data.variantCount ?? 1;
  if (!Number.isInteger(candidate) || candidate <= 0 || candidate > MAX_VARIANTS) {
    throw new Error(`variantCount must be an integer between 1 and ${MAX_VARIANTS}`);
  }
  return candidate;
}

export function resolveBaseSeed(
  data: ImageNodeData | VideoNodeData | AudioNodeData,
  requestedSeed?: number,
): number | undefined {
  const seed = requestedSeed ?? data.seed;
  if (seed == null) return undefined;
  if (!Number.isInteger(seed)) {
    throw new Error('seed must be an integer');
  }
  return seed;
}

export function resolveMediaDimensions(
  node: CanvasNode,
  generationType: GenerationType,
  canvas?: Canvas,
): GenerationMediaConfig {
  if (generationType === 'image') {
    const data = node.data as ImageNodeData;
    const effective = resolveEffectiveResolutionIntent({
      mediaType: 'image',
      canvasSettings: canvas?.settings,
      nodeData: data,
    });
    return effective.intent.mode === 'exact'
      ? { width: effective.intent.width, height: effective.intent.height }
      : {};
  }
  if (generationType === 'video') {
    const data = node.data as VideoNodeData;
    const effective = resolveEffectiveResolutionIntent({
      mediaType: 'video',
      canvasSettings: canvas?.settings,
      nodeData: data,
    });
    return {
      ...(effective.intent.mode === 'exact'
        ? { width: effective.intent.width, height: effective.intent.height }
        : {}),
      duration: resolvePositiveInteger(data.duration, DEFAULT_VIDEO_DURATION),
      fps: resolvePositiveInteger(data.fps, 24),
    };
  }
  if (generationType === 'voice' || generationType === 'music' || generationType === 'sfx') {
    const data = node.data as AudioNodeData;
    return {
      duration: resolvePositiveInteger(data.duration, DEFAULT_AUDIO_DURATION),
    };
  }
  return {};
}

export function mergeGenerationParams(
  baseParams: GenerationRequest['params'],
  fps: number | undefined,
): GenerationRequest['params'] {
  if (typeof fps !== 'number') {
    return baseParams;
  }
  return {
    ...(baseParams ?? {}),
    fps,
  };
}
