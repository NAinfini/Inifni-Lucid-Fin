import type { AdapterRegistry } from '@lucid-fin/adapters-ai';
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
import { BUILT_IN_PRESET_LIBRARY } from '@lucid-fin/contracts';
import type { CAS, Keychain } from '@lucid-fin/storage';
import log from '../../logger.js';
import {
  type BuiltGenerationContext,
  type CanvasGenerationDeps,
  type GenerationMediaConfig,
  type ProviderConfigOverride,
  DEFAULT_AUDIO_DURATION,
  DEFAULT_IMAGE_SIZE,
  DEFAULT_VIDEO_DURATION,
  DEFAULT_VIDEO_SIZE,
  MAX_VARIANTS,
  buildAdhocAdapter,
  normalizeErrorMessage,
  normalizeOptionalString,
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
  resolveReferenceImages,
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
  const mode = determinePromptMode(canvas, node);
  const generationType = determineGenerationType(node);
  const providerId = resolveNodeProviderId(node, input.requestedProviderId);
  const adapter = await resolveAdapter(deps.adapterRegistry, providerId, generationType, mode, input.requestedProviderConfig, deps.keychain, deps.cas);
  const nodeData = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  const variantCount = resolveVariantCount(nodeData, input.requestedVariantCount);
  const baseSeed = resolveBaseSeed(nodeData, input.requestedSeed);
  const projectStyleGuide = loadCurrentProjectStyleGuide();

  const presetTracks =
    generableNodeType === 'audio'
      ? undefined
      : applyStyleGuideDefaultsToEmptyTracks(
          hasPresetTracks(nodeData) ? nodeData.presetTracks : undefined,
          projectStyleGuide,
          BUILT_IN_PRESET_LIBRARY,
        );
  const characterRefs = hasCharacterRefs(nodeData) ? nodeData.characterRefs : undefined;
  const equipmentRefs = hasEquipmentRefs(nodeData) ? nodeData.equipmentRefs : undefined;
  const locationRefs = hasLocationRefs(nodeData) ? nodeData.locationRefs : undefined;

  const resolvedCharacters = resolveCharacterEntities(deps.db, characterRefs);
  const resolvedLocations = resolveLocationEntities(deps.db, locationRefs);
  const resolvedEquipment = resolveStandaloneEquipment(deps.db, equipmentRefs, resolvedCharacters);
  const referenceImages = resolveReferenceImages(deps.db, canvas, node);
  const videoFrameReferenceImages = generableNodeType === 'video'
    ? resolveVideoFrameReferenceImageSet(canvas, node)
    : undefined;
  const connectedSourceHash = generableNodeType === 'video'
    ? findConnectedImageHash(canvas, node.id)
    : undefined;
  const sourceNodeData =
    node.type === 'image' || node.type === 'video'
      ? (node.data as ImageNodeData | VideoNodeData)
      : undefined;
  const sourceImageHash = normalizeOptionalString(
    sourceNodeData?.sourceImageHash,
  ) ?? (generableNodeType === 'video' && !videoFrameReferenceImages?.first ? connectedSourceHash : undefined);

  // Select the best prompt for this generation type:
  // All nodes: prompt > title
  const effectivePrompt = normalizeOptionalString(nodeData.prompt) ?? node.title;

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
    styleGuide: {
      artStyle: projectStyleGuide.global.artStyle,
      lighting: projectStyleGuide.global.lighting,
      colorPalette: projectStyleGuide.global.colorPalette.primary,
    },
  });

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
      budget: compiled.budget,
      segmentCount: compiled.segments.length,
      diagnosticCount: compiled.diagnostics.length,
    });
  }
  const mediaConfig = resolveMediaDimensions(node, generationType);
  const { fps, ...mediaRequest } = mediaConfig;

  const videoData = node.type === 'video' ? (node.data as VideoNodeData) : undefined;

  const imageOrVideoData = (node.type === 'image' || node.type === 'video')
    ? (node.data as ImageNodeData | VideoNodeData)
    : undefined;

  const requestBase: GenerationRequest = {
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
    faceReferenceHashes:
      imageOrVideoData?.faceReferenceHashes && imageOrVideoData.faceReferenceHashes.length > 0
        ? imageOrVideoData.faceReferenceHashes
        : undefined,
    emotionVector:
      generableNodeType === 'audio'
        ? (nodeData as AudioNodeData).emotionVector
        : undefined,
  };

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
  };
}

// ---------------------------------------------------------------------------
// Prompt mode / generation type
// ---------------------------------------------------------------------------

export function determinePromptMode(canvas: Canvas, node: CanvasNode): PromptMode {
  if (node.type === 'image') {
    const data = node.data as ImageNodeData;
    if (normalizeOptionalString(data.sourceImageHash)) {
      return 'image-to-image';
    }
    return 'text-to-image';
  }
  if (node.type === 'video') {
    const data = node.data as VideoNodeData;
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
  return 'text-to-video';
}

export function determineGenerationType(node: CanvasNode): GenerationType {
  if (node.type === 'image') return 'image';
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
  return (
    normalizeOptionalString(data.providerId) ??
    normalizeOptionalString((data as AudioNodeData).provider)
  );
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
    const adapter = registry.get(canonicalProviderId);
    if (adapter) {
      try {
        ensureAdapterSupports(adapter, generationType, mode);
      } catch (error) {
        if (providerConfig && keychain) {
          log.warn('[canvas:generation] registered adapter incompatible with requested media type, falling back to ad-hoc provider config', {
            category: 'canvas-generation',
            requestedProviderId,
            canonicalProviderId,
            adapterId: adapter.id,
            generationType,
            mode,
            error: normalizeErrorMessage(error),
          });
          return buildAdhocAdapter(canonicalProviderId, providerConfig, keychain, generationType, cas);
        }
        throw error;
      }
      const apiKey = await resolveProviderApiKey(keychain, canonicalProviderId, providerConfig);
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
    if (providerConfig && keychain) {
      return buildAdhocAdapter(canonicalProviderId, providerConfig, keychain, generationType, cas);
    }
  }

  const candidates = registry.list(mapGenerationTypeToAdapterType(generationType));
  const supported = candidates.find((adapter) => {
    try {
      ensureAdapterSupports(adapter, generationType, mode);
      return true;
    } catch { /* adapter doesn't support this generation type/mode — skip it */
      return false;
    }
  });
  if (!supported) {
    throw new Error(`No configured adapter available for ${generationType}`);
  }
  return supported;
}

async function resolveProviderApiKey(
  keychain: Keychain | undefined,
  providerId: string,
  providerConfig?: ProviderConfigOverride,
): Promise<string | undefined> {
  if (providerConfig?.apiKey) {
    return providerConfig.apiKey;
  }
  if (!keychain) {
    return undefined;
  }

  return (await keychain.getKey(providerId)) ?? undefined;
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
    log.warn(msg, { providerId: adapter.id, requiredCapability, capabilities: adapter.capabilities });
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

export function mapGenerationTypeToAdapterType(generationType: GenerationType): 'image' | 'video' | 'voice' | 'music' | 'sfx' {
  if (generationType === 'image') return 'image';
  if (generationType === 'video') return 'video';
  if (generationType === 'voice') return 'voice';
  if (generationType === 'music') return 'music';
  return 'sfx';
}

export function mapGenerationTypeToAssetType(generationType: GenerationType): 'image' | 'video' | 'audio' {
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
): GenerationMediaConfig {
  if (generationType === 'image') {
    const data = node.data as ImageNodeData;
    return {
      width: resolvePositiveInteger(data.width, DEFAULT_IMAGE_SIZE.width),
      height: resolvePositiveInteger(data.height, DEFAULT_IMAGE_SIZE.height),
    };
  }
  if (generationType === 'video') {
    const data = node.data as VideoNodeData;
    return {
      width: resolvePositiveInteger(data.width, DEFAULT_VIDEO_SIZE.width),
      height: resolvePositiveInteger(data.height, DEFAULT_VIDEO_SIZE.height),
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
