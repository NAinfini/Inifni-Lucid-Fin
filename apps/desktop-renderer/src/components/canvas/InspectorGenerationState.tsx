import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { selectActiveCanvas } from '../../store/slices/canvas-selectors.js';
import { enqueueToast } from '../../store/slices/toast.js';
import {
  setNodeSeed,
  setNodeGenerating,
  setNodeGenerationFailed,
  setNodeProvider,
  setNodeVariantCount,
  setNodeEstimatedCost,
  setNodeResolution,
  setNodeDuration,
  setNodeFps,
  setNodeAudio,
  setNodeLipSync,
  setNodeQuality,
  setNodeUploadedAsset,
  clearNodeAsset,
  selectVariant,
  deleteVariant,
  toggleSeedLock,
  setVideoFrameNode,
  setVideoFrameAsset,
} from '../../store/slices/canvas.js';
import { getAPI } from '../../utils/api.js';
import { getProviderMetadata, type ProviderConfig } from '../../store/slices/settings.js';
import { InspectorGenerationBar } from './InspectorGenerationBar.js';
import { InspectorVariantThumb } from './InspectorVariantThumb.js';
import {
  CUSTOM_RESOLUTION_VALUE,
  DURATION_PRESETS,
  FPS_PRESETS,
  RESOLUTION_PRESETS,
  createRandomSeed,
  getDefaultResolution,
  getResolutionPresetDimensions,
  getResolutionPresetValue,
  resolveSeedRequest,
  type VisualGenerationNodeType,
  type ResolutionPresetValue,
} from './inspector-generation-utils.js';
import type {
  CanvasNode,
  ImageNodeData,
  VideoNodeData,
  AudioNodeData,
} from '@lucid-fin/contracts';

const VARIANT_OPTIONS = [1, 2, 4, 9];
const RESOLUTION_PRESET_GROUPS = RESOLUTION_PRESETS.reduce<
  Array<{ label: (typeof RESOLUTION_PRESETS)[number]['groupLabel']; options: (typeof RESOLUTION_PRESETS)[number][] }>
>((groups, preset) => {
  const existing = groups.find((group) => group.label === preset.groupLabel);
  if (existing) {
    existing.options.push(preset);
    return groups;
  }
  groups.push({ label: preset.groupLabel, options: [preset] });
  return groups;
}, []);

function isVisualGenerationNode(node: CanvasNode): node is CanvasNode & {
  type: VisualGenerationNodeType;
  data: ImageNodeData | VideoNodeData;
} {
  return node.type === 'image' || node.type === 'video';
}

interface InspectorGenerationStateProps {
  selectedNode: CanvasNode & { data: ImageNodeData | VideoNodeData | AudioNodeData };
  t: (key: string) => string;
  children: (props: GenerationRenderProps) => React.ReactNode;
}

export interface GenerationRenderProps {
  generationData: ImageNodeData | VideoNodeData | AudioNodeData;
  configuredProviders: ProviderConfig[];
  providerLoading: boolean;
  activeProviderId: string | undefined;
  activeVariantCount: number;
  activeSeed: number | undefined;
  activeSeedLocked: boolean;
  activeVariants: string[];
  selectedVariantIndex: number;
  handleProviderSelectChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  handleVariantCountChange: (count: number) => void;
  handleSeedInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleRandomizeSeed: () => void;
  handleToggleSeedLock: () => void;
  handleGenerate: () => Promise<void>;
  handleCancelGeneration: () => Promise<void>;
  handleSelectVariant: (index: number) => void;
  handleDeleteVariant: (index: number) => void;
  handleUploadAsset: () => Promise<void>;
  handleClearUploadedAsset: () => void;
  // Resolution
  resolutionControlValue: string;
  handleResolutionSelectChange: ((event: React.ChangeEvent<HTMLSelectElement>) => void) | undefined;
  handleResolutionWidthChange: ((event: React.ChangeEvent<HTMLInputElement>) => void) | undefined;
  handleResolutionHeightChange: ((event: React.ChangeEvent<HTMLInputElement>) => void) | undefined;
  activeWidth: number | undefined;
  activeHeight: number | undefined;
  // Duration / FPS (video only)
  durationControlValue: string;
  handleDurationSelectChange: ((event: React.ChangeEvent<HTMLSelectElement>) => void) | undefined;
  handleDurationInputChange: ((event: React.ChangeEvent<HTMLInputElement>) => void) | undefined;
  activeDuration: number | undefined;
  handleFpsSelectChange: ((event: React.ChangeEvent<HTMLSelectElement>) => void) | undefined;
  activeFps: number | undefined;
  // Audio
  handleAudioChange: (enabled: boolean) => void;
  handleQualityChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  activeVideoProviderMetadata: ReturnType<typeof getProviderMetadata> | undefined;
  // Video frames
  handleFrameSelect: (role: 'first' | 'last', value: string | undefined) => void;
  handleFrameDropAsset: (role: 'first' | 'last', assetHash: string) => void;
  handleUploadVideoFrame: (role: 'first' | 'last') => Promise<void>;
  handleDropFileVideoFrame: (role: 'first' | 'last', file: File) => Promise<void>;
  handleClearVideoFrame: (role: 'first' | 'last') => void;
  // Generation bar component
  generationBar: React.ReactNode;
  variantGrid: React.ReactNode;
  visibleVariantCount: number;
  selectedVariantMediaType: 'image' | 'video' | 'audio';
}

/**
 * Encapsulates all generation-node-specific Redux selectors, effects, and
 * handlers. Only mounted when a generation node (image/video/audio) is selected.
 * This prevents provider/cost/variant state from contributing to re-render
 * cost when viewing text or backdrop nodes.
 */
export function InspectorGenerationState({
  selectedNode,
  t,
  children,
}: InspectorGenerationStateProps) {
  const dispatch = useDispatch();
  const activeCanvasId = useSelector((s: RootState) => s.canvas.activeCanvasId);
  const canvas = useSelector(selectActiveCanvas);
  const imageProviders = useSelector((s: RootState) => s.settings.image.providers);
  const videoProviders = useSelector((s: RootState) => s.settings.video.providers);
  const audioProviders = useSelector((s: RootState) => s.settings.audio.providers);

  const generationData = selectedNode.data as ImageNodeData | VideoNodeData | AudioNodeData;
  const activeProviderId = generationData.providerId;
  const activeProviderConfig = useMemo(() => {
    if (!activeProviderId) return undefined;
    const all = [...imageProviders, ...videoProviders, ...audioProviders];
    const p = all.find((x) => x.id === activeProviderId);
    if (!p) return undefined;
    return { baseUrl: p.baseUrl, model: p.model };
  }, [activeProviderId, imageProviders, videoProviders, audioProviders]);
  const activeVideoProviderMetadata = useMemo(() => {
    if (selectedNode.type !== 'video' || !activeProviderId) return undefined;
    return getProviderMetadata('video', activeProviderId);
  }, [activeProviderId, selectedNode.type]);
  const activeVariantCount = generationData.variantCount ?? 1;
  const activeSeed = generationData.seed;
  const activeSeedLocked = generationData.seedLocked ?? false;
  const activeVariants = generationData.variants ?? [];
  const selectedVariantIndex = generationData.selectedVariantIndex ?? 0;
  const visualGenerationNode = isVisualGenerationNode(selectedNode) ? selectedNode : undefined;
  const defaultResolution = visualGenerationNode
    ? getDefaultResolution(visualGenerationNode.type)
    : undefined;
  const activeWidth = visualGenerationNode
    ? (visualGenerationNode.data.width ?? defaultResolution?.width)
    : undefined;
  const activeHeight = visualGenerationNode
    ? (visualGenerationNode.data.height ?? defaultResolution?.height)
    : undefined;
  const activeResolutionPreset = visualGenerationNode
    ? getResolutionPresetValue(visualGenerationNode.type, activeWidth, activeHeight)
    : CUSTOM_RESOLUTION_VALUE;
  const activeDuration =
    selectedNode.type === 'video'
      ? ((selectedNode.data as VideoNodeData).duration ?? 5)
      : undefined;
  const activeDurationPreset =
    selectedNode.type === 'video' &&
    activeDuration != null &&
    DURATION_PRESETS.some((preset) => preset === activeDuration)
      ? String(activeDuration)
      : CUSTOM_RESOLUTION_VALUE;
  const activeFps =
    selectedNode.type === 'video' ? ((selectedNode.data as VideoNodeData).fps ?? 24) : undefined;
  const visibleVariantCount = Math.max(activeVariantCount, activeVariants.length);
  const shouldShowVariantGrid = visibleVariantCount > 0 && generationData.status !== 'empty';
  const selectedVariantMediaType: 'image' | 'video' | 'audio' =
    selectedNode.type === 'video' ? 'video' : selectedNode.type === 'audio' ? 'audio' : 'image';
  const pendingRandomSeedByNodeId = useRef<Record<string, number>>({});

  const [resolutionSelectValue, setResolutionSelectValue] = useState<ResolutionPresetValue | null>(null);
  const [durationSelectValue, setDurationSelectValue] = useState<string | null>(null);
  const [configuredProviders, setConfiguredProviders] = useState<ProviderConfig[]>([]);
  const [providerLoading, setProviderLoading] = useState(false);

  const providerCandidates = useMemo(() => {
    if (selectedNode.type === 'audio') return audioProviders;
    if (selectedNode.type === 'video') return videoProviders;
    return imageProviders;
  }, [audioProviders, imageProviders, selectedNode.type, videoProviders]);

  useEffect(() => {
    if (!visualGenerationNode) {
      setResolutionSelectValue(null);
      return;
    }
    setResolutionSelectValue(
      getResolutionPresetValue(visualGenerationNode.type, activeWidth, activeHeight),
    );
  }, [activeHeight, activeWidth, visualGenerationNode]);

  useEffect(() => {
    if (selectedNode.type !== 'video') {
      setDurationSelectValue(null);
      return;
    }
    setDurationSelectValue(
      DURATION_PRESETS.some((preset) => preset === activeDuration)
        ? String(activeDuration)
        : CUSTOM_RESOLUTION_VALUE,
    );
  }, [activeDuration, selectedNode.id, selectedNode.type]);

  useEffect(() => {
    if (!canvas) return;
    for (const node of canvas.nodes) {
      const pendingSeed = pendingRandomSeedByNodeId.current[node.id];
      if (typeof pendingSeed !== 'number') continue;
      const nd = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
      if (!nd || nd.status === 'generating' || nd.status === 'empty') continue;
      delete pendingRandomSeedByNodeId.current[node.id];
      dispatch(setNodeSeed({ id: node.id, seed: pendingSeed }));
    }
  }, [canvas, dispatch]);

  useEffect(() => {
    let cancelled = false;
    setProviderLoading(true);
    const loadProviders = async () => {
      const api = getAPI();
      if (!api) {
        setConfiguredProviders([]);
        setProviderLoading(false);
        return;
      }
      if (cancelled) return;
      setConfiguredProviders(providerCandidates);
      setProviderLoading(false);
      if (!activeProviderId && providerCandidates.length > 0) {
        dispatch(setNodeProvider({ id: selectedNode.id, providerId: providerCandidates[0].id }));
      }
    };
    void loadProviders();
    return () => { cancelled = true; };
  }, [activeProviderId, dispatch, providerCandidates, selectedNode.id]);

  const selectedNodeId = selectedNode.id;

  useEffect(() => {
    if (!activeProviderId || !activeCanvasId) return;
    const api = getAPI();
    if (!api?.canvasGeneration) return;
    let cancelled = false;
    void api.canvasGeneration
      .estimateCost(activeCanvasId, selectedNodeId, activeProviderId, activeProviderConfig)
      .then((result) => {
        if (!cancelled)
          dispatch(setNodeEstimatedCost({ id: selectedNodeId, estimatedCost: result.estimatedCost }));
      })
      .catch(() => {
        if (!cancelled) dispatch(setNodeEstimatedCost({ id: selectedNodeId, estimatedCost: 0 }));
      });
    return () => { cancelled = true; };
  }, [activeCanvasId, activeProviderId, activeProviderConfig, activeVariantCount, dispatch, selectedNodeId]);

  // --- Handlers ---

  const handleProviderChange = useCallback(
    (providerId: string) => {
      dispatch(setNodeProvider({ id: selectedNode.id, providerId }));
    },
    [dispatch, selectedNode.id],
  );

  const handleProviderSelectChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      handleProviderChange(event.target.value);
    },
    [handleProviderChange],
  );

  const handleVariantCountChange = useCallback(
    (count: number) => {
      dispatch(setNodeVariantCount({ id: selectedNode.id, count }));
    },
    [dispatch, selectedNode.id],
  );

  const handleSeedChange = useCallback(
    (seed: number | undefined) => {
      dispatch(setNodeSeed({ id: selectedNode.id, seed }));
    },
    [dispatch, selectedNode.id],
  );

  const handleSeedInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.value === '') { handleSeedChange(undefined); return; }
      const nextSeed = event.target.valueAsNumber;
      if (!Number.isFinite(nextSeed)) return;
      handleSeedChange(Math.round(nextSeed));
    },
    [handleSeedChange],
  );

  const handleRandomizeSeed = useCallback(() => {
    handleSeedChange(createRandomSeed());
  }, [handleSeedChange]);

  const handleToggleSeedLock = useCallback(() => {
    if (!activeSeedLocked && activeSeed == null) {
      handleSeedChange(createRandomSeed());
    }
    dispatch(toggleSeedLock({ id: selectedNode.id }));
  }, [activeSeed, activeSeedLocked, dispatch, handleSeedChange, selectedNode.id]);

  const handleResolutionChange = useCallback(
    (value: ResolutionPresetValue) => {
      if (!visualGenerationNode) return;
      setResolutionSelectValue(value);
      if (value === CUSTOM_RESOLUTION_VALUE) {
        if (typeof activeWidth === 'number' && typeof activeHeight === 'number') {
          dispatch(setNodeResolution({ id: visualGenerationNode.id, width: activeWidth, height: activeHeight }));
        }
        return;
      }
      const preset = getResolutionPresetDimensions(value);
      if (!preset) return;
      dispatch(setNodeResolution({ id: visualGenerationNode.id, width: preset.width, height: preset.height }));
    },
    [activeHeight, activeWidth, dispatch, visualGenerationNode],
  );

  const handleResolutionSelectChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      handleResolutionChange(event.target.value as ResolutionPresetValue);
    },
    [handleResolutionChange],
  );

  const handleResolutionWidthChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!visualGenerationNode) return;
      const nextWidth = event.target.valueAsNumber;
      if (!Number.isFinite(nextWidth) || nextWidth < 1) return;
      dispatch(setNodeResolution({ id: visualGenerationNode.id, width: Math.round(nextWidth), height: activeHeight ?? defaultResolution?.height ?? 1024 }));
    },
    [activeHeight, defaultResolution?.height, dispatch, visualGenerationNode],
  );

  const handleResolutionHeightChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!visualGenerationNode) return;
      const nextHeight = event.target.valueAsNumber;
      if (!Number.isFinite(nextHeight) || nextHeight < 1) return;
      dispatch(setNodeResolution({ id: visualGenerationNode.id, width: activeWidth ?? defaultResolution?.width ?? 1024, height: Math.round(nextHeight) }));
    },
    [activeWidth, defaultResolution?.width, dispatch, visualGenerationNode],
  );

  const handleDurationChange = useCallback(
    (duration: number) => {
      if (selectedNode.type !== 'video') return;
      dispatch(setNodeDuration({ id: selectedNode.id, duration }));
    },
    [dispatch, selectedNode.id, selectedNode.type],
  );

  const handleDurationSelectChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      if (event.target.value === CUSTOM_RESOLUTION_VALUE) {
        setDurationSelectValue(CUSTOM_RESOLUTION_VALUE);
        return;
      }
      setDurationSelectValue(event.target.value);
      handleDurationChange(Number(event.target.value));
    },
    [handleDurationChange],
  );

  const handleDurationInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextDuration = event.target.valueAsNumber;
      if (!Number.isFinite(nextDuration) || nextDuration < 1 || nextDuration > 60) return;
      handleDurationChange(Math.round(nextDuration));
    },
    [handleDurationChange],
  );

  const handleFpsChange = useCallback(
    (fps: number) => {
      if (selectedNode.type !== 'video') return;
      dispatch(setNodeFps({ id: selectedNode.id, fps }));
    },
    [dispatch, selectedNode.id, selectedNode.type],
  );

  const handleFpsSelectChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      handleFpsChange(Number(event.target.value));
    },
    [handleFpsChange],
  );

  const handleGenerate = useCallback(async () => {
    if (!activeCanvasId) return;
    const api = getAPI();
    if (!api?.canvasGeneration) return;
    const randomSeed = createRandomSeed();
    const seedRequest = resolveSeedRequest({ seed: activeSeed, seedLocked: activeSeedLocked, randomSeed });
    if (typeof seedRequest.persistImmediately === 'number') {
      dispatch(setNodeSeed({ id: selectedNode.id, seed: seedRequest.persistImmediately }));
    }
    if (typeof seedRequest.persistAfterCompletion === 'number') {
      pendingRandomSeedByNodeId.current[selectedNode.id] = seedRequest.persistAfterCompletion;
    } else {
      delete pendingRandomSeedByNodeId.current[selectedNode.id];
    }
    dispatch(setNodeGenerating({ id: selectedNode.id, jobId: `pending-${Date.now()}` }));
    try {
      const result = await api.canvasGeneration.generate(
        activeCanvasId, selectedNode.id, activeProviderId, activeVariantCount, seedRequest.requestSeed, activeProviderConfig,
      );
      dispatch(setNodeGenerating({ id: selectedNode.id, jobId: result.jobId }));
    } catch (error) {
      delete pendingRandomSeedByNodeId.current[selectedNode.id];
      const msg = error instanceof Error ? error.message : String(error);
      dispatch(setNodeGenerationFailed({ id: selectedNode.id, error: msg }));
      const isProviderError = /no configured adapter|api.?key|provider.*not.*found/i.test(msg);
      const isProviderSettingsError =
        isProviderError || /replicate.*(422|rejected the request)|invalid[_ ]request/i.test(msg);
      dispatch(enqueueToast({
        title: t('generation.failed'),
        message: isProviderError ? t('generation.noProviderHint') : msg,
        variant: 'error',
        ...(isProviderSettingsError && {
          actionLabel: t('generation.openProviders'),
          onAction: () => { window.location.hash = '#/settings'; },
        }),
      }));
    }
  }, [activeCanvasId, activeProviderConfig, activeProviderId, activeSeed, activeSeedLocked, activeVariantCount, dispatch, selectedNode.id, t]);

  const handleCancelGeneration = useCallback(async () => {
    if (!activeCanvasId) return;
    const api = getAPI();
    if (!api?.canvasGeneration) return;
    await api.canvasGeneration.cancel(activeCanvasId, selectedNode.id);
  }, [activeCanvasId, selectedNode.id]);

  const handleSelectVariant = useCallback(
    (index: number) => { dispatch(selectVariant({ id: selectedNode.id, index })); },
    [dispatch, selectedNode.id],
  );

  const handleDeleteVariant = useCallback(
    (index: number) => { dispatch(deleteVariant({ id: selectedNode.id, index })); },
    [dispatch, selectedNode.id],
  );

  const handleAudioChange = useCallback(
    (enabled: boolean) => {
      if (selectedNode.type !== 'video') return;
      dispatch(setNodeAudio({ id: selectedNode.id, audio: enabled }));
    },
    [dispatch, selectedNode.id, selectedNode.type],
  );

  const handleLipSyncChange = useCallback(
    (enabled: boolean) => {
      if (selectedNode.type !== 'video') return;
      dispatch(setNodeLipSync({ nodeId: selectedNode.id, enabled }));
    },
    [dispatch, selectedNode.id, selectedNode.type],
  );

  const handleQualityChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (selectedNode.type !== 'video') return;
      const val = e.target.value as 'standard' | 'pro' | '';
      dispatch(setNodeQuality({ id: selectedNode.id, quality: val || undefined }));
    },
    [dispatch, selectedNode.id, selectedNode.type],
  );

  const handleFrameSelect = useCallback(
    (role: 'first' | 'last', value: string | undefined) => {
      if (selectedNode.type !== 'video') return;
      if (!value) {
        dispatch(setVideoFrameNode({ id: selectedNode.id, role, frameNodeId: undefined }));
        return;
      }
      if (value.startsWith('asset:')) {
        dispatch(setVideoFrameAsset({ id: selectedNode.id, role, assetHash: value.slice(6) }));
      } else {
        dispatch(setVideoFrameNode({ id: selectedNode.id, role, frameNodeId: value }));
      }
    },
    [dispatch, selectedNode.id, selectedNode.type],
  );

  const handleFrameDropAsset = useCallback(
    (role: 'first' | 'last', assetHash: string) => {
      if (selectedNode.type !== 'video') return;
      dispatch(setVideoFrameAsset({ id: selectedNode.id, role, assetHash }));
    },
    [dispatch, selectedNode.id, selectedNode.type],
  );

  const handleUploadVideoFrame = useCallback(
    async (role: 'first' | 'last') => {
      if (selectedNode.type !== 'video') return;
      const api = getAPI();
      if (!api) return;
      const ref = (await api.asset.pickFile('image')) as { hash: string } | null;
      if (!ref) return;
      dispatch(setVideoFrameAsset({ id: selectedNode.id, role, assetHash: ref.hash }));
    },
    [dispatch, selectedNode.id, selectedNode.type],
  );

  const handleDropFileVideoFrame = useCallback(
    async (role: 'first' | 'last', file: File) => {
      if (selectedNode.type !== 'video') return;
      const api = getAPI();
      if (!api) return;
      const filePath = (file as { path?: string }).path ?? '';
      const ref = filePath
        ? ((await api.asset.import(filePath, 'image')) as { hash: string } | null)
        : ((await api.asset.importBuffer(await file.arrayBuffer(), file.name, 'image')) as { hash: string } | null);
      if (!ref?.hash) return;
      dispatch(setVideoFrameAsset({ id: selectedNode.id, role, assetHash: ref.hash }));
    },
    [dispatch, selectedNode.id, selectedNode.type],
  );

  const handleClearVideoFrame = useCallback(
    (role: 'first' | 'last') => {
      if (selectedNode.type !== 'video') return;
      dispatch(setVideoFrameNode({ id: selectedNode.id, role, frameNodeId: undefined }));
    },
    [dispatch, selectedNode.id, selectedNode.type],
  );

  const handleUploadAsset = useCallback(async () => {
    if (selectedNode.type !== 'image' && selectedNode.type !== 'video') return;
    const api = getAPI();
    if (!api) return;
    const ref = (await api.asset.pickFile(selectedNode.type)) as { hash: string } | null;
    if (!ref) return;
    dispatch(setNodeUploadedAsset({ id: selectedNode.id, assetHash: ref.hash }));
  }, [dispatch, selectedNode.id, selectedNode.type]);

  const handleClearUploadedAsset = useCallback(() => {
    if (selectedNode.type !== 'image' && selectedNode.type !== 'video') return;
    dispatch(clearNodeAsset({ id: selectedNode.id }));
  }, [dispatch, selectedNode.id, selectedNode.type]);

  const resolutionControlValue = resolutionSelectValue ?? activeResolutionPreset;
  const durationControlValue = durationSelectValue ?? activeDurationPreset;

  const variantGrid = shouldShowVariantGrid
    ? Array.from({ length: visibleVariantCount }, (_, index) => {
        const hash = activeVariants[index];
        return (
          <InspectorVariantThumb
            key={hash ?? `variant-placeholder-${index}`}
            hash={hash}
            index={index}
            selected={selectedVariantIndex === index}
            mediaType={selectedVariantMediaType}
            onClick={() => handleSelectVariant(index)}
            onDelete={() => handleDeleteVariant(index)}
            canDelete={visibleVariantCount > 1}
          />
        );
      })
    : null;

  const generationBar = (
    <InspectorGenerationBar
      t={t}
      providerOptions={configuredProviders.map((p) => {
        const localized = t(`providerNames.${p.id}`);
        return { id: p.id, name: localized !== `providerNames.${p.id}` ? localized : p.name };
      })}
      activeProviderId={activeProviderId}
      providerLoading={providerLoading}
      onProviderChange={handleProviderSelectChange}
      variantOptions={VARIANT_OPTIONS}
      activeVariantCount={activeVariantCount}
      onVariantCountChange={handleVariantCountChange}
      isGenerating={generationData.status === 'generating'}
      hasVariants={activeVariants.length > 0}
      estimatedCost={
        typeof generationData.estimatedCost === 'number'
          ? `${t('inspector.estimated')}: $${generationData.estimatedCost.toFixed(2)}`
          : undefined
      }
      onGenerate={handleGenerate}
      onCancel={handleCancelGeneration}
      seedValue={activeSeed}
      seedLocked={activeSeedLocked}
      onSeedChange={handleSeedInputChange}
      onRandomizeSeed={handleRandomizeSeed}
      onToggleSeedLock={handleToggleSeedLock}
      nodeType={selectedNode.type}
      resolutionGroups={
        visualGenerationNode
          ? RESOLUTION_PRESET_GROUPS.map((group) => ({
              label: t(`resolutionPresetGroups.${group.label.toLowerCase()}`),
              options: group.options.map((preset) => ({ value: preset.value, label: preset.label })),
            }))
          : undefined
      }
      resolutionValue={visualGenerationNode ? resolutionControlValue : undefined}
      customResolutionValue={CUSTOM_RESOLUTION_VALUE}
      widthValue={activeWidth}
      heightValue={activeHeight}
      onResolutionChange={visualGenerationNode ? handleResolutionSelectChange : undefined}
      onWidthChange={visualGenerationNode ? handleResolutionWidthChange : undefined}
      onHeightChange={visualGenerationNode ? handleResolutionHeightChange : undefined}
      durationOptions={selectedNode.type === 'video' ? DURATION_PRESETS : undefined}
      durationValue={selectedNode.type === 'video' ? durationControlValue : undefined}
      onDurationChange={selectedNode.type === 'video' ? handleDurationSelectChange : undefined}
      durationInputValue={activeDuration}
      onDurationInputChange={selectedNode.type === 'video' ? handleDurationInputChange : undefined}
      fpsOptions={selectedNode.type === 'video' ? FPS_PRESETS : undefined}
      fpsValue={activeFps}
      onFpsChange={selectedNode.type === 'video' ? handleFpsSelectChange : undefined}
      showAudioToggle={selectedNode.type === 'video'}
      audioEnabled={
        selectedNode.type === 'video' ? ((selectedNode.data as VideoNodeData).audio ?? false) : false
      }
      onAudioChange={handleAudioChange}
      audioLabel={t('node.generateAudio')}
      audioWarning={
        selectedNode.type === 'video' &&
        (selectedNode.data as VideoNodeData).audio &&
        !activeVideoProviderMetadata?.supportsAudio
          ? t('node.audioUnsupported')
          : undefined
      }
      showLipSyncToggle={selectedNode.type === 'video'}
      lipSyncEnabled={
        selectedNode.type === 'video' ? ((selectedNode.data as VideoNodeData).lipSyncEnabled ?? false) : false
      }
      onLipSyncChange={handleLipSyncChange}
      lipSyncLabel={t('inspector.lipSync.enable')}
      qualityOptions={((activeVideoProviderMetadata?.qualityTiers?.length ?? 0) > 0
        ? activeVideoProviderMetadata?.qualityTiers
        : ['standard']
      )?.map((v) => ({ value: v, label: t(`node.quality_${v}` as 'node.quality') || v }))}
      qualityValue={
        selectedNode.type === 'video'
          ? ((selectedNode.data as VideoNodeData).quality ??
            activeVideoProviderMetadata?.qualityTiers?.[0] ?? 'standard')
          : undefined
      }
      onQualityChange={handleQualityChange}
      qualityLabel={t('node.quality')}
      showQualitySelector={selectedNode.type === 'video'}
      variantGrid={variantGrid}
      variantLabel={
        visibleVariantCount > 0
          ? `${selectedVariantIndex + 1} / ${visibleVariantCount}`
          : undefined
      }
      uploadHasAsset={
        selectedNode.type === 'image' || selectedNode.type === 'video'
          ? Boolean(generationData.assetHash)
          : undefined
      }
      onUpload={
        selectedNode.type === 'image' || selectedNode.type === 'video' ? handleUploadAsset : undefined
      }
      onClear={
        selectedNode.type === 'image' || selectedNode.type === 'video' ? handleClearUploadedAsset : undefined
      }
      noKeyWarning={
        !providerLoading && configuredProviders.length > 0 && !configuredProviders.some((p) => p.hasKey)
          ? t('generation.noKeyWarning')
          : undefined
      }
      noKeyActionLabel={t('generation.openProviders')}
      onNoKeyAction={() => { window.location.hash = '#/settings'; }}
    />
  );

  return children({
    generationData,
    configuredProviders,
    providerLoading,
    activeProviderId,
    activeVariantCount,
    activeSeed,
    activeSeedLocked,
    activeVariants,
    selectedVariantIndex,
    handleProviderSelectChange,
    handleVariantCountChange,
    handleSeedInputChange,
    handleRandomizeSeed,
    handleToggleSeedLock,
    handleGenerate,
    handleCancelGeneration,
    handleSelectVariant,
    handleDeleteVariant,
    handleUploadAsset,
    handleClearUploadedAsset,
    resolutionControlValue,
    handleResolutionSelectChange: visualGenerationNode ? handleResolutionSelectChange : undefined,
    handleResolutionWidthChange: visualGenerationNode ? handleResolutionWidthChange : undefined,
    handleResolutionHeightChange: visualGenerationNode ? handleResolutionHeightChange : undefined,
    activeWidth,
    activeHeight,
    durationControlValue,
    handleDurationSelectChange: selectedNode.type === 'video' ? handleDurationSelectChange : undefined,
    handleDurationInputChange: selectedNode.type === 'video' ? handleDurationInputChange : undefined,
    activeDuration,
    handleFpsSelectChange: selectedNode.type === 'video' ? handleFpsSelectChange : undefined,
    activeFps,
    handleAudioChange,
    handleQualityChange,
    activeVideoProviderMetadata,
    handleFrameSelect,
    handleFrameDropAsset,
    handleUploadVideoFrame,
    handleDropFileVideoFrame,
    handleClearVideoFrame,
    generationBar,
    variantGrid,
    visibleVariantCount,
    selectedVariantMediaType,
  });
}
