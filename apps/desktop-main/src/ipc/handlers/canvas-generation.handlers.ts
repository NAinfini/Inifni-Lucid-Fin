import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { IpcMain } from 'electron';
import log from 'electron-log';
import type { AdapterRegistry } from '@lucid-fin/adapters-ai';
import { compilePrompt, type PromptMode, type ResolvedCharacter } from '@lucid-fin/application';
import type {
  AIProviderAdapter,
  AudioNodeData,
  Canvas,
  CanvasNode,
  Capability,
  Equipment,
  EquipmentRef,
  GenerationRequest,
  GenerationType,
  ImageNodeData,
  Location,
  LocationRef,
  PresetCategory,
  PresetDefinition,
  PresetTrack,
  PresetTrackSet,
  StyleGuide,
  VideoNodeData,
} from '@lucid-fin/contracts';
import { BUILT_IN_PRESET_LIBRARY, createEmptyPresetTrackSet, JobStatus } from '@lucid-fin/contracts';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import type { CanvasStore } from './canvas.handlers.js';
import { getCurrentProjectId, getCurrentProjectPath } from '../project-context.js';
import { assertWithinRoot } from '../validation.js';

type CanvasGenerationDeps = {
  adapterRegistry: AdapterRegistry;
  cas: CAS;
  db: SqliteIndex;
  canvasStore: CanvasStore;
};

type SendTarget = {
  send: (channel: string, payload: unknown) => void;
};

type RunningCanvasJob = {
  jobId: string;
  canvasId: string;
  nodeId: string;
  adapterId: string;
  providerJobIds: Set<string>;
  cancelled: boolean;
  cancelReason?: string;
};

type ProviderConfigOverride = { baseUrl: string; model: string; apiKey?: string };

type GenerateArgs = {
  canvasId: string;
  nodeId: string;
  providerId?: string;
  providerConfig?: ProviderConfigOverride;
  variantCount?: number;
  seed?: number;
};

type EstimateArgs = {
  canvasId: string;
  nodeId: string;
  providerId: string;
  providerConfig?: ProviderConfigOverride;
};

type CancelArgs = {
  canvasId: string;
  nodeId: string;
};

type BuiltGenerationContext = {
  canvas: Canvas;
  node: CanvasNode;
  requestBase: GenerationRequest;
  adapter: AIProviderAdapter;
  nodeType: 'image' | 'video' | 'audio';
  generationType: GenerationType;
  mode: PromptMode;
  variantCount: number;
  baseSeed?: number;
};

type MaterializedAsset = {
  filePath: string;
  cleanupPath?: string;
  sourceUrl?: string;
};

const DEFAULT_IMAGE_SIZE = { width: 1024, height: 1024 };
const DEFAULT_VIDEO_SIZE = { width: 1280, height: 720 };
const DEFAULT_VIDEO_DURATION = 5;
const DEFAULT_AUDIO_DURATION = 5;
const MAX_VARIANTS = 9;
const runningJobs = new Map<string, RunningCanvasJob>();
const DEFAULT_STYLE_GUIDE: StyleGuide = {
  global: {
    artStyle: '',
    colorPalette: { primary: '', secondary: '', forbidden: [] },
    lighting: 'natural',
    texture: '',
    referenceImages: [],
    freeformDescription: '',
  },
  sceneOverrides: {},
};
const STYLE_GUIDE_LIGHTING_PRESETS: Record<StyleGuide['global']['lighting'], string | undefined> = {
  natural: undefined,
  studio: 'scene:high-key',
  dramatic: 'scene:low-key',
  neon: 'scene:neon-noir',
  custom: undefined,
};
const LEGACY_CANVAS_PROVIDER_ALIASES: Record<string, string> = {
  runway: 'runway-gen4',
  veo: 'google-veo-2',
  pika: 'pika-v2',
  'openai-dalle': 'openai-image',
  imagen: 'google-imagen3',
  'fish-audio': 'fish-audio-v1',
  cartesia: 'cartesia-sonic',
  playht: 'playht-3',
  luma: 'luma-ray2',
  minimax: 'minimax-video01',
};

export function registerCanvasGenerationHandlers(ipcMain: IpcMain, deps: CanvasGenerationDeps): void {
  ipcMain.handle('canvas:generate', async (event, args: GenerateArgs) => {
    return startCanvasGeneration(event.sender, args, deps);
  });

  ipcMain.handle('canvas:cancelGeneration', async (event, args: CancelArgs) => {
    await cancelCanvasGeneration(event.sender, args, deps);
  });

  ipcMain.handle('canvas:estimateCost', async (_event, args: EstimateArgs) => {
    try {
      const parsed = requireEstimateArgs(args);
      const context = buildGenerationContext(deps, {
        canvasId: parsed.canvasId,
        nodeId: parsed.nodeId,
        requestedProviderId: parsed.providerId,
        requestedProviderConfig: parsed.providerConfig,
        requestedVariantCount: undefined,
        requestedSeed: undefined,
      });
      const estimate = context.adapter.estimateCost(context.requestBase);
      setNodeEstimatedCost(context.node, estimate.estimatedCost);
      touchCanvas(context.canvas, deps);
      return { estimatedCost: estimate.estimatedCost, currency: estimate.currency };
    } catch {
      return { estimatedCost: 0, currency: 'USD' };
    }
  });
}

export async function cancelCanvasGeneration(
  sender: SendTarget,
  args: CancelArgs,
  deps: CanvasGenerationDeps,
): Promise<void> {
  const parsed = requireCancelArgs(args);
  const key = runningKey(parsed.canvasId, parsed.nodeId);
  const running = runningJobs.get(key);
  if (!running) return;

  running.cancelled = true;
  running.cancelReason = 'Generation cancelled by user';
  sendProgress(sender, parsed.canvasId, parsed.nodeId, 0, 'cancelling');

  const adapter = deps.adapterRegistry.get(running.adapterId);
  if (!adapter) return;

  for (const providerJobId of running.providerJobIds) {
    try {
      await adapter.cancel(providerJobId);
    } catch (error) {
      log.warn('[canvas:generation] cancel provider job failed', {
        adapterId: adapter.id,
        providerJobId,
        error: String(error),
      });
    }
  }
}

export async function startCanvasGeneration(
  sender: SendTarget,
  args: GenerateArgs,
  deps: CanvasGenerationDeps,
): Promise<{ jobId: string }> {
  const { canvasId, nodeId } = requireGenerateArgs(args);
  const key = runningKey(canvasId, nodeId);
  if (runningJobs.has(key)) {
    throw new Error(`Generation already running for node ${nodeId}`);
  }

  const context = buildGenerationContext(deps, {
    canvasId,
    nodeId,
    requestedProviderId: normalizeOptionalString(args.providerId),
    requestedProviderConfig: args.providerConfig,
    requestedVariantCount: args.variantCount,
    requestedSeed: args.seed,
  });

  const estimated = context.adapter.estimateCost(context.requestBase);
  setNodeEstimatedCost(context.node, estimated.estimatedCost);

  const jobId = randomUUID();
  const runningJob: RunningCanvasJob = {
    jobId,
    canvasId,
    nodeId,
    adapterId: context.adapter.id,
    providerJobIds: new Set<string>(),
    cancelled: false,
  };
  runningJobs.set(key, runningJob);

  markNodeGenerating(context.node, {
    jobId,
    providerId: context.adapter.id,
    variantCount: context.variantCount,
    seed: context.baseSeed,
  });
  touchCanvas(context.canvas, deps);

  sendProgress(sender, canvasId, nodeId, 1, 'queued');

  void executeGeneration({
    sender,
    deps,
    context,
    runningJob,
    initialEstimatedCost: estimated.estimatedCost,
  });

  return { jobId };
}

async function executeGeneration(args: {
  sender: SendTarget;
  deps: CanvasGenerationDeps;
  context: BuiltGenerationContext;
  runningJob: RunningCanvasJob;
  initialEstimatedCost: number;
}): Promise<void> {
  const { sender, deps, context, runningJob, initialEstimatedCost } = args;
  const { canvas, node, adapter, requestBase, generationType, variantCount, baseSeed } = context;
  const key = runningKey(runningJob.canvasId, runningJob.nodeId);
  const startedAt = Date.now();
  const variantHashes: string[] = [];
  let totalCost = 0;

  try {
    for (let index = 0; index < variantCount; index += 1) {
      throwIfCancelled(runningJob);
      const progress = Math.round((index / variantCount) * 100);
      sendProgress(sender, runningJob.canvasId, runningJob.nodeId, progress, `variant ${index + 1}/${variantCount}`);

      const variantSeed = typeof baseSeed === 'number' ? baseSeed + index : undefined;
      const generated = await adapter.generate({
        ...requestBase,
        seed: variantSeed,
      });

      collectProviderJobId(runningJob, generated.metadata);
      throwIfCancelled(runningJob);

      const materialized = await materializeAsset(generated);
      try {
        const assetType = mapGenerationTypeToAssetType(generationType);
        const { ref, meta } = await deps.cas.importAsset(materialized.filePath, assetType);
        const projectId = getCurrentProjectId();

        deps.db.insertAsset({
          ...meta,
          projectId: projectId ?? undefined,
          prompt: requestBase.prompt,
          provider: adapter.id,
          tags: [
            'canvas',
            `canvas:${runningJob.canvasId}`,
            `node:${runningJob.nodeId}`,
            `variant:${index + 1}`,
          ],
        });

        variantHashes.push(ref.hash);
        if (typeof generated.cost === 'number') {
          totalCost += generated.cost;
        }
      } finally {
        if (materialized.cleanupPath) {
          fs.rmSync(materialized.cleanupPath, { recursive: true, force: true });
        }
      }
    }

    if (variantHashes.length === 0) {
      throw new Error('Generation produced no assets');
    }

    const generationTimeMs = Date.now() - startedAt;
    const finalCost = totalCost > 0 ? totalCost : initialEstimatedCost;
    markNodeCompleted(node, {
      variants: variantHashes,
      generationTimeMs,
      cost: finalCost,
    });
    touchCanvas(canvas, deps);

    sendProgress(sender, runningJob.canvasId, runningJob.nodeId, 100, 'completed');
    sender.send('canvas:generation:complete', {
      canvasId: runningJob.canvasId,
      nodeId: runningJob.nodeId,
      variants: variantHashes,
      primaryAssetHash: variantHashes[0],
      cost: finalCost,
      generationTimeMs,
    });
  } catch (error) {
    const message = normalizeErrorMessage(error);
    markNodeFailed(node, message);
    touchCanvas(canvas, deps);
    sender.send('canvas:generation:failed', {
      canvasId: runningJob.canvasId,
      nodeId: runningJob.nodeId,
      error: message,
    });
  } finally {
    runningJobs.delete(key);
  }
}

function buildGenerationContext(
  deps: CanvasGenerationDeps,
  input: {
    canvasId: string;
    nodeId: string;
    requestedProviderId?: string;
    requestedProviderConfig?: ProviderConfigOverride;
    requestedVariantCount?: number;
    requestedSeed?: number;
  },
): BuiltGenerationContext {
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
  const adapter = resolveAdapter(deps.adapterRegistry, providerId, generationType, mode, input.requestedProviderConfig);
  const nodeData = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  const variantCount = resolveVariantCount(nodeData, input.requestedVariantCount);
  const baseSeed = resolveBaseSeed(nodeData, input.requestedSeed);
  const referenceImages = resolveReferenceImages(deps.db, canvas, node);

  const presetTracks =
    generableNodeType === 'audio'
      ? undefined
      : applyStyleGuideDefaultsToEmptyTracks(
          hasPresetTracks(nodeData) ? nodeData.presetTracks : undefined,
          loadCurrentProjectStyleGuide(),
          BUILT_IN_PRESET_LIBRARY,
        );
  const characterRefs = hasCharacterRefs(nodeData) ? nodeData.characterRefs : undefined;
  const equipmentRefs = hasEquipmentRefs(nodeData) ? nodeData.equipmentRefs : undefined;
  const locationRefs = hasLocationRefs(nodeData) ? nodeData.locationRefs : undefined;

  const resolvedCharacters = resolveCharacterEntities(deps.db, characterRefs);
  const resolvedLocations = resolveLocationEntities(deps.db, locationRefs);
  const resolvedEquipment = resolveStandaloneEquipment(deps.db, equipmentRefs, resolvedCharacters);

  const compiled = compilePrompt({
    nodeType: generableNodeType,
    prompt: normalizeOptionalString(nodeData.prompt) ?? node.title,
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
  });

  const requestBase: GenerationRequest = {
    type: generationType,
    providerId: adapter.id,
    prompt: compiled.prompt,
    negativePrompt: compiled.negativePrompt,
    referenceImages: compiled.referenceImages,
    seed: baseSeed,
    params: compiled.params,
    ...resolveMediaDimensions(node, generationType),
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
  };
}

function resolveMediaDimensions(
  node: CanvasNode,
  generationType: GenerationType,
): Pick<GenerationRequest, 'width' | 'height' | 'duration'> {
  if (generationType === 'image') {
    return {
      width: DEFAULT_IMAGE_SIZE.width,
      height: DEFAULT_IMAGE_SIZE.height,
    };
  }
  if (generationType === 'video') {
    const data = node.data as VideoNodeData;
    return {
      width: DEFAULT_VIDEO_SIZE.width,
      height: DEFAULT_VIDEO_SIZE.height,
      duration: data.duration ?? DEFAULT_VIDEO_DURATION,
    };
  }
  if (generationType === 'voice' || generationType === 'music' || generationType === 'sfx') {
    const data = node.data as AudioNodeData;
    return {
      duration: data.duration ?? DEFAULT_AUDIO_DURATION,
    };
  }
  return {};
}

function determinePromptMode(canvas: Canvas, node: CanvasNode): PromptMode {
  if (node.type === 'image') {
    const data = node.data as ImageNodeData;
    if (normalizeOptionalString(data.sourceImageHash)) {
      throw new Error('Image node image-to-image generation is not supported yet');
    }
    return 'text-to-image';
  }
  if (node.type === 'video') {
    const data = node.data as VideoNodeData;
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

function determineGenerationType(node: CanvasNode): GenerationType {
  if (node.type === 'image') return 'image';
  if (node.type === 'video') return 'video';
  const audio = node.data as AudioNodeData;
  return audio.audioType;
}

export function canonicalizeCanvasProviderId(providerId: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(providerId);
  if (!normalized) return undefined;
  return LEGACY_CANVAS_PROVIDER_ALIASES[normalized] ?? normalized;
}

function resolveNodeProviderId(node: CanvasNode, requestedProviderId?: string): string | undefined {
  if (requestedProviderId) return canonicalizeCanvasProviderId(requestedProviderId);
  const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  return canonicalizeCanvasProviderId(
    normalizeOptionalString(data.providerId) ??
      normalizeOptionalString((data as AudioNodeData).provider),
  );
}

function buildAdhocAdapter(id: string, config: ProviderConfigOverride): AIProviderAdapter {
  const { baseUrl, model, apiKey = '' } = config;
  return {
    id,
    name: id,
    type: 'image' as const,
    capabilities: ['text-to-image'] as Capability[],
    maxConcurrent: 1,
    configure(key: string) { void key; },
    async validate() { return true; },
    async generate(req: GenerationRequest): Promise<import('@lucid-fin/contracts').GenerationResult> {
      const res = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, prompt: req.prompt, n: 1, size: '1024x1024', response_format: 'url' }),
      });
      if (!res.ok) throw new Error(`Custom provider error: ${res.status}`);
      const json = await res.json() as { data: Array<{ url: string }> };
      const url = json.data[0]?.url;
      if (!url) throw new Error('No image URL in response');
      return { assetHash: '', assetPath: url, provider: id };
    },
    estimateCost(_req: GenerationRequest): import('@lucid-fin/contracts').CostEstimate { return { estimatedCost: 0, currency: 'USD', provider: id, unit: 'image' }; },
    checkStatus(_jobId: string): Promise<JobStatus> { return Promise.resolve(JobStatus.Completed); },
    cancel(_jobId: string): Promise<void> { return Promise.resolve(); },
  };
}

function resolveAdapter(
  registry: AdapterRegistry,
  requestedProviderId: string | undefined,
  generationType: GenerationType,
  mode: PromptMode,
  providerConfig?: ProviderConfigOverride,
): AIProviderAdapter {
  const canonicalProviderId = canonicalizeCanvasProviderId(requestedProviderId);
  if (canonicalProviderId) {
    const adapter = registry.get(canonicalProviderId);
    if (adapter) {
      ensureAdapterSupports(adapter, generationType, mode);
      return adapter;
    }
    // Custom provider not in registry — build ad-hoc OpenAI-compatible adapter
    if (providerConfig) {
      return buildAdhocAdapter(canonicalProviderId, providerConfig);
    }
    // Fall through to any available adapter for this generation type
  }

  const candidates = registry.list(mapGenerationTypeToAdapterType(generationType));
  const supported = candidates.find((adapter) => {
    try {
      ensureAdapterSupports(adapter, generationType, mode);
      return true;
    } catch {
      return false;
    }
  });
  if (!supported) {
    throw new Error(`No configured adapter available for ${generationType}`);
  }
  return supported;
}

function ensureAdapterSupports(
  adapter: AIProviderAdapter,
  generationType: GenerationType,
  mode: PromptMode,
): void {
  const adapterTypes = Array.isArray(adapter.type) ? adapter.type : [adapter.type];
  const expectedType = mapGenerationTypeToAdapterType(generationType);
  if (!adapterTypes.includes(expectedType)) {
    throw new Error(`Provider "${adapter.id}" does not support ${generationType}`);
  }

  const requiredCapability = resolveRequiredCapability(generationType, mode);
  if (requiredCapability && !adapter.capabilities.includes(requiredCapability)) {
    throw new Error(
      `Provider "${adapter.id}" does not support capability ${requiredCapability}`,
    );
  }
}

function resolveRequiredCapability(
  generationType: GenerationType,
  mode: PromptMode,
): Capability | undefined {
  if (generationType === 'image') return 'text-to-image';
  if (generationType === 'video') {
    return mode === 'image-to-video' ? 'image-to-video' : 'text-to-video';
  }
  if (generationType === 'voice') return 'text-to-voice';
  if (generationType === 'music') return 'text-to-music';
  if (generationType === 'sfx') return 'text-to-sfx';
  return undefined;
}

function mapGenerationTypeToAdapterType(generationType: GenerationType): 'image' | 'video' | 'voice' | 'music' | 'sfx' {
  if (generationType === 'image') return 'image';
  if (generationType === 'video') return 'video';
  if (generationType === 'voice') return 'voice';
  if (generationType === 'music') return 'music';
  return 'sfx';
}

function mapGenerationTypeToAssetType(generationType: GenerationType): 'image' | 'video' | 'audio' {
  if (generationType === 'image') return 'image';
  if (generationType === 'video') return 'video';
  return 'audio';
}

function resolveVariantCount(
  data: ImageNodeData | VideoNodeData | AudioNodeData,
  requestedVariantCount?: number,
): number {
  const candidate = requestedVariantCount ?? data.variantCount ?? 1;
  if (!Number.isInteger(candidate) || candidate <= 0 || candidate > MAX_VARIANTS) {
    throw new Error(`variantCount must be an integer between 1 and ${MAX_VARIANTS}`);
  }
  return candidate;
}

function resolveBaseSeed(
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

function resolveReferenceImages(db: SqliteIndex, canvas: Canvas, node: CanvasNode): string[] {
  const hashes = new Set<string>();

  if (node.type === 'video') {
    const sourceHash = findConnectedImageHash(canvas, node.id);
    if (sourceHash) hashes.add(sourceHash);
    const nodeHash = normalizeOptionalString((node.data as VideoNodeData).sourceImageHash);
    if (nodeHash) hashes.add(nodeHash);
  }

  const withCharacterRefs = node.data as ImageNodeData | VideoNodeData;
  for (const ref of withCharacterRefs.characterRefs ?? []) {
    const character = db.getCharacter(ref.characterId);
    if (!character) continue;

    // Prefer explicit hash on ref, then angle slot lookup, then legacy single image, then all images
    const explicitHash = normalizeOptionalString(ref.referenceImageHash);
    if (explicitHash) {
      hashes.add(explicitHash);
      continue;
    }
    const slotHash = ref.angleSlot
      ? normalizeOptionalString(character.referenceImages?.find((r) => r.slot === ref.angleSlot)?.assetHash)
      : undefined;
    if (slotHash) {
      hashes.add(slotHash);
      continue;
    }
    if (normalizeOptionalString(character.referenceImage)) {
      hashes.add(character.referenceImage as string);
    }
    for (const image of character.referenceImages ?? []) {
      if (normalizeOptionalString(image.assetHash)) {
        hashes.add(image.assetHash as string);
      }
    }
  }

  for (const rawRef of (withCharacterRefs as { equipmentRefs?: Array<EquipmentRef | string> }).equipmentRefs ?? []) {
    const ref: EquipmentRef = typeof rawRef === 'string' ? { equipmentId: rawRef } : rawRef;
    const equipment = db.getEquipment(ref.equipmentId);
    if (!equipment) continue;

    const explicitHash = normalizeOptionalString(ref.referenceImageHash);
    if (explicitHash) {
      hashes.add(explicitHash);
      continue;
    }
    const slotHash = ref.angleSlot
      ? normalizeOptionalString(equipment.referenceImages?.find((r) => r.slot === ref.angleSlot)?.assetHash)
      : undefined;
    if (slotHash) {
      hashes.add(slotHash);
      continue;
    }
    for (const image of equipment.referenceImages ?? []) {
      if (normalizeOptionalString(image.assetHash)) {
        hashes.add(image.assetHash as string);
      }
    }
  }

  return Array.from(hashes);
}

function collectConnectedTextContent(canvas: Canvas, nodeId: string): string[] {
  const connectedNodeIds = new Set<string>();
  for (const edge of canvas.edges) {
    if (edge.source === nodeId) connectedNodeIds.add(edge.target);
    if (edge.target === nodeId) connectedNodeIds.add(edge.source);
  }

  const textContent: string[] = [];
  for (const candidateId of connectedNodeIds) {
    const node = canvas.nodes.find((entry) => entry.id === candidateId);
    if (!node || node.type !== 'text') continue;
    const data = node.data as { content?: unknown };
    const content = normalizeOptionalString(data.content);
    if (content) textContent.push(content);
  }
  return textContent;
}

function findConnectedImageHash(canvas: Canvas, nodeId: string): string | undefined {
  // Prefer incoming image edges (image -> video)
  for (const edge of canvas.edges) {
    if (edge.target !== nodeId) continue;
    const sourceNode = canvas.nodes.find((node) => node.id === edge.source && node.type === 'image');
    if (!sourceNode) continue;
    const hash = normalizeOptionalString((sourceNode.data as ImageNodeData).assetHash);
    if (hash) return hash;
  }
  // Fallback: any connected image node
  for (const edge of canvas.edges) {
    const otherNodeId = edge.source === nodeId ? edge.target : edge.target === nodeId ? edge.source : undefined;
    if (!otherNodeId) continue;
    const imageNode = canvas.nodes.find((node) => node.id === otherNodeId && node.type === 'image');
    if (!imageNode) continue;
    const hash = normalizeOptionalString((imageNode.data as ImageNodeData).assetHash);
    if (hash) return hash;
  }
  return undefined;
}

type TrackMap = Record<PresetCategory, PresetTrack>;

export function applyStyleGuideDefaultsToEmptyTracks(
  tracks: PresetTrackSet | undefined,
  styleGuide: StyleGuide,
  presetLibrary: PresetDefinition[],
): PresetTrackSet {
  const next = structuredClone(tracks ?? createEmptyPresetTrackSet()) as TrackMap;
  const lookPresetId = findStyleGuidePresetId('look', styleGuide.global.artStyle, presetLibrary);
  const scenePresetId = STYLE_GUIDE_LIGHTING_PRESETS[styleGuide.global.lighting];

  maybeFillTrack(next, 'look', lookPresetId);
  maybeFillTrack(next, 'scene', scenePresetId);

  return next as PresetTrackSet;
}

function maybeFillTrack(tracks: TrackMap, category: PresetCategory, presetId: string | undefined): void {
  if (!presetId) return;
  const current = tracks[category];
  if (current?.entries.length) return;
  tracks[category] = {
    category,
    aiDecide: false,
    entries: [
      {
        id: randomUUID(),
        category,
        presetId,
        params: {},
        order: 0,
      },
    ],
  };
}

function findStyleGuidePresetId(
  category: PresetCategory,
  rawValue: string | undefined,
  presetLibrary: PresetDefinition[],
): string | undefined {
  const normalizedValue = normalizePresetLookupValue(rawValue);
  if (!normalizedValue) return undefined;

  const candidates = presetLibrary.filter((preset) => preset.category === category);
  const exactMatch = candidates.find((preset) => {
    return [
      normalizePresetLookupValue(preset.name),
      normalizePresetLookupValue(preset.id.split(':')[1]),
    ].includes(normalizedValue);
  });
  if (exactMatch) return exactMatch.id;

  const fuzzyMatches = candidates.filter((preset) => {
    const presetKeys = [
      normalizePresetLookupValue(preset.name),
      normalizePresetLookupValue(preset.id.split(':')[1]),
    ].filter(Boolean);
    return presetKeys.some((key) => key.includes(normalizedValue) || normalizedValue.includes(key));
  });
  return fuzzyMatches.length === 1 ? fuzzyMatches[0]?.id : undefined;
}

function normalizePresetLookupValue(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function loadCurrentProjectStyleGuide(): StyleGuide {
  const projectPath = getCurrentProjectPath();
  if (!projectPath) {
    return DEFAULT_STYLE_GUIDE;
  }

  const stylePath = assertWithinRoot(projectPath, 'style-guide.json');
  if (fs.existsSync(stylePath)) {
    const raw = JSON.parse(fs.readFileSync(stylePath, 'utf-8')) as unknown;
    if (isStyleGuide(raw)) {
      return raw;
    }
  }

  const manifestPath = assertWithinRoot(projectPath, 'project.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { styleGuide?: unknown };
    if (isStyleGuide(manifest.styleGuide)) {
      return manifest.styleGuide;
    }
  }

  return DEFAULT_STYLE_GUIDE;
}

function isStyleGuide(value: unknown): value is StyleGuide {
  if (!value || typeof value !== 'object') return false;
  const guide = value as Record<string, unknown>;
  return (
    typeof guide.global === 'object' &&
    guide.global !== null &&
    typeof guide.sceneOverrides === 'object' &&
    guide.sceneOverrides !== null
  );
}

function hasPresetTracks(data: unknown): data is { presetTracks?: PresetTrackSet } {
  return typeof data === 'object' && data !== null && 'presetTracks' in data;
}

function hasCharacterRefs(data: unknown): data is { characterRefs?: ImageNodeData['characterRefs'] } {
  return typeof data === 'object' && data !== null && 'characterRefs' in data;
}

function hasEquipmentRefs(data: unknown): data is { equipmentRefs?: ImageNodeData['equipmentRefs'] } {
  return typeof data === 'object' && data !== null && 'equipmentRefs' in data;
}

function hasLocationRefs(data: unknown): data is { locationRefs?: LocationRef[] } {
  return typeof data === 'object' && data !== null && 'locationRefs' in data;
}

function setNodeEstimatedCost(node: CanvasNode, estimatedCost: number): void {
  const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  data.estimatedCost = estimatedCost;
}

function markNodeGenerating(
  node: CanvasNode,
  input: {
    jobId: string;
    providerId: string;
    variantCount: number;
    seed?: number;
  },
): void {
  const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  data.status = 'generating';
  data.progress = 0;
  data.error = undefined;
  data.jobId = input.jobId;
  data.providerId = input.providerId;
  data.variantCount = input.variantCount;
  if (typeof input.seed === 'number') {
    data.seed = input.seed;
  }
  node.status = 'generating';
}

function markNodeCompleted(
  node: CanvasNode,
  input: {
    variants: string[];
    generationTimeMs: number;
    cost?: number;
  },
): void {
  const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  data.status = 'done';
  data.variants = input.variants;
  data.selectedVariantIndex = 0;
  data.assetHash = input.variants[0];
  data.progress = 100;
  data.error = undefined;
  data.generationTimeMs = input.generationTimeMs;
  if (typeof input.cost === 'number') {
    data.cost = input.cost;
    data.estimatedCost = input.cost;
  }
  node.status = 'done';
}

function markNodeFailed(node: CanvasNode, error: string): void {
  const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  data.status = 'failed';
  data.error = error;
  data.progress = undefined;
  node.status = 'failed';
}

function touchCanvas(canvas: Canvas, deps: CanvasGenerationDeps): void {
  const now = Date.now();
  canvas.updatedAt = now;
  deps.canvasStore.save(canvas);
}

function runningKey(canvasId: string, nodeId: string): string {
  return `${canvasId}:${nodeId}`;
}

function throwIfCancelled(job: RunningCanvasJob): void {
  if (job.cancelled) {
    throw new Error(job.cancelReason ?? 'Generation cancelled');
  }
}

function collectProviderJobId(job: RunningCanvasJob, metadata: Record<string, unknown> | undefined): void {
  if (!metadata) return;
  const providerTaskId = normalizeOptionalString(
    (metadata.jobId as string | undefined) ??
      (metadata.taskId as string | undefined) ??
      (metadata.id as string | undefined),
  );
  if (providerTaskId) {
    job.providerJobIds.add(providerTaskId);
  }
}

function sendProgress(
  sender: SendTarget,
  canvasId: string,
  nodeId: string,
  progress: number,
  currentStep?: string,
): void {
  sender.send('canvas:generation:progress', {
    canvasId,
    nodeId,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    currentStep,
  });
}

async function materializeAsset(generated: {
  assetPath?: string;
  metadata?: Record<string, unknown>;
}): Promise<MaterializedAsset> {
  const assetPath = normalizeOptionalString(generated.assetPath);
  if (assetPath) {
    if (isRemoteUrl(assetPath)) {
      return downloadRemoteAsset(assetPath);
    }
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Generated asset path not found: ${assetPath}`);
    }
    return { filePath: assetPath };
  }

  const metadataUrl = normalizeOptionalString(generated.metadata?.url as string | undefined);
  if (metadataUrl) {
    return downloadRemoteAsset(metadataUrl);
  }

  throw new Error('Generated asset did not include a usable file path or URL');
}

async function downloadRemoteAsset(url: string): Promise<MaterializedAsset> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download generated asset: ${response.status}`);
  }

  const ext = inferRemoteExtension(url, response.headers.get('content-type'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-canvas-'));
  const filePath = path.join(dir, `generated-${Date.now()}.${ext}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filePath, buffer);

  return {
    filePath,
    cleanupPath: dir,
    sourceUrl: url,
  };
}

function inferRemoteExtension(url: string, contentType: string | null): string {
  const byUrl = extensionFromUrl(url);
  if (byUrl) return byUrl;
  const normalized = contentType?.split(';')[0].trim().toLowerCase();
  switch (normalized) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/png':
      return 'png';
    case 'video/mp4':
      return 'mp4';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    default:
      return 'bin';
  }
}

function extensionFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).slice(1).toLowerCase();
    return ext.length > 0 ? ext : undefined;
  } catch {
    return undefined;
  }
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function requireGenerateArgs(value: GenerateArgs | undefined): {
  canvasId: string;
  nodeId: string;
} {
  if (!value) throw new Error('canvas:generate request is required');
  const canvasId = normalizeOptionalString(value.canvasId);
  const nodeId = normalizeOptionalString(value.nodeId);
  if (!canvasId || !nodeId) throw new Error('canvasId and nodeId are required');
  return { canvasId, nodeId };
}

function requireEstimateArgs(value: EstimateArgs | undefined): {
  canvasId: string;
  nodeId: string;
  providerId: string;
  providerConfig?: ProviderConfigOverride;
} {
  if (!value) throw new Error('canvas:estimateCost request is required');
  const canvasId = normalizeOptionalString(value.canvasId);
  const nodeId = normalizeOptionalString(value.nodeId);
  const providerId = normalizeOptionalString(value.providerId);
  if (!canvasId || !nodeId || !providerId) {
    throw new Error('canvasId, nodeId and providerId are required');
  }
  return { canvasId, nodeId, providerId, providerConfig: value.providerConfig };
}

function requireCancelArgs(value: CancelArgs | undefined): {
  canvasId: string;
  nodeId: string;
} {
  if (!value) throw new Error('canvas:cancelGeneration request is required');
  const canvasId = normalizeOptionalString(value.canvasId);
  const nodeId = normalizeOptionalString(value.nodeId);
  if (!canvasId || !nodeId) throw new Error('canvasId and nodeId are required');
  return { canvasId, nodeId };
}

function resolveCharacterEntities(
  db: SqliteIndex,
  refs: ImageNodeData['characterRefs'] | undefined,
): ResolvedCharacter[] {
  if (!refs?.length) return [];
  const result: ResolvedCharacter[] = [];
  for (const ref of refs) {
    const character = db.getCharacter(ref.characterId);
    if (!character) continue;
    const loadout = character.loadouts.find((l) => l.id === ref.loadoutId)
      ?? character.loadouts.find((l) => l.id === character.defaultLoadoutId);
    const equipment: Equipment[] = [];
    if (loadout) {
      for (const eqId of loadout.equipmentIds) {
        const eq = db.getEquipment(eqId);
        if (eq) equipment.push(eq);
      }
    }
    result.push({
      character,
      loadout,
      equipment: equipment.length > 0 ? equipment : undefined,
      emotion: ref.emotion,
      costume: ref.costume,
    });
  }
  return result;
}

function resolveLocationEntities(
  db: SqliteIndex,
  refs: LocationRef[] | undefined,
): Location[] {
  if (!refs?.length) return [];
  const result: Location[] = [];
  for (const ref of refs) {
    const location = db.getLocation(ref.locationId);
    if (location) result.push(location);
  }
  return result;
}

function resolveStandaloneEquipment(
  db: SqliteIndex,
  refs: Array<EquipmentRef | string> | undefined,
  resolvedCharacters: ResolvedCharacter[],
): Equipment[] {
  if (!refs?.length) return [];
  const loadoutEquipmentIds = new Set<string>();
  for (const rc of resolvedCharacters) {
    if (rc.equipment) {
      for (const eq of rc.equipment) loadoutEquipmentIds.add(eq.id);
    }
  }
  const result: Equipment[] = [];
  for (const rawRef of refs) {
    const eqId = typeof rawRef === 'string' ? rawRef : rawRef.equipmentId;
    if (loadoutEquipmentIds.has(eqId)) continue;
    const equipment = db.getEquipment(eqId);
    if (equipment) result.push(equipment);
  }
  return result;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
