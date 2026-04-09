import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { enqueueToast } from '../../store/slices/toast.js';
import {
  renameNode,
  updateNodeData,
  selectVariant,
  setNodeEstimatedCost,
  setNodeGenerating,
  setNodeGenerationFailed,
  setNodeProvider,
  setNodeResolution,
  setNodeSeed,
  setAllTracksAiDecide,
  setVideoFrameNode,
  setNodeVariantCount,
  setNodeDuration,
  setNodeFps,
  setNodeUploadedAsset,
  clearNodeAsset,
  toggleSeedLock,
  addNodeCharacterRef,
  removeNodeCharacterRef,
  updateNodeCharacterRef,
  addNodeEquipmentRef,
  removeNodeEquipmentRef,
  updateNodeEquipmentRef,
  addNodeLocationRef,
  removeNodeLocationRef,
  applyNodeShotTemplate,
  setBackdropOpacity,
  setBackdropColor,
  setBackdropBorderStyle,
  setBackdropTitleSize,
  setBackdropLockChildren,
  moveNode,
} from '../../store/slices/canvas.js';
import { getAPI } from '../../utils/api.js';
import { setRightPanel } from '../../store/slices/ui.js';
import { setCharacters } from '../../store/slices/characters.js';
import { setEquipment } from '../../store/slices/equipment.js';
import { setLocations } from '../../store/slices/locations.js';
import { FileText, Image, LayoutTemplate, Video, Volume2, type LucideIcon } from 'lucide-react';
import { useI18n } from '../../hooks/use-i18n.js';
import {
  localizeSlot,
  localizeShotTemplateName,
  localizeShotTemplateDescription,
} from '../../i18n.js';
import { InspectorCreativeTab } from './InspectorCreativeTab.js';
import { InspectorContextTab } from './InspectorContextTab.js';
import { InspectorTechnicalTab } from './InspectorTechnicalTab.js';
import { InspectorFrameThumb } from './InspectorFrameThumb.js';
import { InspectorPanelEmptyState } from './InspectorPanelEmptyState.js';
import { InspectorPanelHeader } from './InspectorPanelHeader.js';
import { InspectorPanelTabBar, type InspectorPanelTab } from './InspectorPanelTabBar.js';
import { InspectorGenerationBar } from './InspectorGenerationBar.js';
import { InspectorPanelIdentitySection } from './InspectorPanelIdentitySection.js';
import { InspectorTrackGridCell } from './InspectorTrackGridCell.js';
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
  type ResolutionPreset,
  type ResolutionPresetValue,
} from './inspector-generation-utils.js';
import type {
  CanvasNode,
  CanvasNodeType,
  PresetCategory,
  PresetDefinition,
  PresetTrackSet,
  TextNodeData,
  ImageNodeData,
  VideoNodeData,
  AudioNodeData,
  BackdropNodeData,
  CharacterRef,
  EquipmentRef,
  LocationRef,
  ReferenceImage,
  ShotTemplate,
} from '@lucid-fin/contracts';

const TYPE_META: Record<CanvasNodeType, { label: string; icon: LucideIcon; color: string }> = {
  text: { label: 'node.text', icon: FileText, color: 'text-foreground' },
  image: { label: 'node.image', icon: Image, color: 'text-blue-400' },
  video: { label: 'node.video', icon: Video, color: 'text-purple-400' },
  audio: { label: 'node.audio', icon: Volume2, color: 'text-green-400' },
  backdrop: { label: 'node.backdrop', icon: LayoutTemplate, color: 'text-slate-300' },
};

const CATEGORY_FALLBACK: PresetCategory[] = [
  'camera',
  'lens',
  'look',
  'scene',
  'composition',
  'emotion',
  'flow',
  'technical',
];

const VARIANT_OPTIONS = [1, 2, 4, 9];
const RESOLUTION_PRESET_GROUPS = RESOLUTION_PRESETS.reduce<
  Array<{ label: ResolutionPreset['groupLabel']; options: ResolutionPreset[] }>
>((groups, preset) => {
  const existing = groups.find((group) => group.label === preset.groupLabel);
  if (existing) {
    existing.options.push(preset);
    return groups;
  }
  groups.push({ label: preset.groupLabel, options: [preset] });
  return groups;
}, []);

function hasTracks(node: CanvasNode | undefined): node is CanvasNode & {
  data: {
    presetTracks: PresetTrackSet;
  };
} {
  if (!node || (node.type !== 'image' && node.type !== 'video')) return false;
  const candidate = node.data as { presetTracks?: unknown };
  return Boolean(candidate.presetTracks && typeof candidate.presetTracks === 'object');
}

function isGenerationNode(node: CanvasNode | undefined): node is CanvasNode & {
  data: ImageNodeData | VideoNodeData | AudioNodeData;
} {
  return Boolean(node && (node.type === 'image' || node.type === 'video' || node.type === 'audio'));
}

function isVisualGenerationNode(node: CanvasNode | undefined): node is CanvasNode & {
  type: VisualGenerationNodeType;
  data: ImageNodeData | VideoNodeData;
} {
  return Boolean(node && (node.type === 'image' || node.type === 'video'));
}

export function InspectorPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const selectedNodeIds = useSelector((s: RootState) => s.canvas.selectedNodeIds);
  const activeCanvasId = useSelector((s: RootState) => s.canvas.activeCanvasId);
  const canvas = useSelector((s: RootState) =>
    s.canvas.canvases.find((c) => c.id === activeCanvasId),
  );
  const presets = useSelector((s: RootState) => s.presets.allIds.map((id) => s.presets.byId[id]));
  const hiddenPresetIds = useSelector((s: RootState) => s.presets.hiddenIds);
  const builtInTemplates = useSelector((s: RootState) => s.shotTemplates.builtIn);
  const customTemplates = useSelector((s: RootState) => s.shotTemplates.custom);
  const hiddenTemplateIds = useSelector((s: RootState) => s.shotTemplates.hiddenIds);
  const characters = useSelector((s: RootState) => s.characters.items);
  const equipmentItems = useSelector((s: RootState) => s.equipment.items);
  const locationItems = useSelector((s: RootState) => s.locations.items);
  const imageProviders = useSelector((s: RootState) => s.settings.image.providers);
  const videoProviders = useSelector((s: RootState) => s.settings.video.providers);
  const audioProviders = useSelector((s: RootState) => s.settings.audio.providers);

  useEffect(() => {
    const api = getAPI();
    if (!api) return;
    if (characters.length === 0) {
      void api.character.list().then((list) => {
        if (Array.isArray(list))
          dispatch(setCharacters(list as import('@lucid-fin/contracts').Character[]));
      });
    }
    if (equipmentItems.length === 0) {
      void api.equipment.list().then((list) => {
        if (Array.isArray(list))
          dispatch(setEquipment(list as import('@lucid-fin/contracts').Equipment[]));
      });
    }
    if (locationItems.length === 0) {
      void api.location.list().then((list) => {
        if (Array.isArray(list))
          dispatch(setLocations(list as import('@lucid-fin/contracts').Location[]));
      });
    }
  }, [dispatch, characters.length, equipmentItems.length, locationItems.length]);

  const presetById = useMemo(() => {
    const map: Record<string, PresetDefinition> = {};
    for (const preset of presets) {
      map[preset.id] = preset;
    }
    return map;
  }, [presets]);

  const categories = useMemo(() => {
    const fromLibrary = Array.from(new Set(presets.map((preset) => preset.category)));
    return (fromLibrary.length > 0 ? fromLibrary : CATEGORY_FALLBACK) as PresetCategory[];
  }, [presets]);

  const characterById = useMemo(() => {
    const map: Record<string, (typeof characters)[number]> = {};
    for (const ch of characters) {
      map[ch.id] = ch;
    }
    return map;
  }, [characters]);

  const equipmentById = useMemo(() => {
    const map: Record<string, (typeof equipmentItems)[number]> = {};
    for (const eq of equipmentItems) {
      map[eq.id] = eq;
    }
    return map;
  }, [equipmentItems]);

  const locationById = useMemo(() => {
    const map: Record<string, (typeof locationItems)[number]> = {};
    for (const loc of locationItems) {
      map[loc.id] = loc;
    }
    return map;
  }, [locationItems]);

  const [inspectorTab, setInspectorTab] = useState<InspectorPanelTab>('creative');
  const [charPickerOpen, setCharPickerOpen] = useState(false);
  const [equipPickerOpen, setEquipPickerOpen] = useState(false);
  const [locPickerOpen, setLocPickerOpen] = useState(false);
  const [configuredProviders, setConfiguredProviders] = useState<
    import('../../store/slices/settings.js').ProviderConfig[]
  >([]);
  const [providerLoading, setProviderLoading] = useState(false);
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const [resolutionSelectValue, setResolutionSelectValue] = useState<ResolutionPresetValue | null>(
    null,
  );
  const [durationSelectValue, setDurationSelectValue] = useState<string | null>(null);
  const pendingRandomSeedByNodeId = useRef<Record<string, number>>({});

  const selectedNode: CanvasNode | undefined =
    selectedNodeIds.length === 1
      ? canvas?.nodes.find((n) => n.id === selectedNodeIds[0])
      : undefined;

  const generationData: ImageNodeData | VideoNodeData | AudioNodeData | undefined =
    isGenerationNode(selectedNode) ? selectedNode.data : undefined;
  const activeProviderId = generationData?.providerId;
  const activeProviderConfig = useMemo(() => {
    if (!activeProviderId) return undefined;
    const all = [...imageProviders, ...videoProviders, ...audioProviders];
    const p = all.find((x) => x.id === activeProviderId);
    if (!p) return undefined;
    return { baseUrl: p.baseUrl, model: p.model };
  }, [activeProviderId, imageProviders, videoProviders, audioProviders]);
  const activeVariantCount = generationData?.variantCount ?? 1;
  const activeSeed = generationData?.seed;
  const activeSeedLocked = generationData?.seedLocked ?? false;
  const activeVariants = generationData?.variants ?? [];
  const selectedVariantIndex = generationData?.selectedVariantIndex ?? 0;
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
    selectedNode?.type === 'video'
      ? ((selectedNode.data as VideoNodeData).duration ?? 5)
      : undefined;
  const activeDurationPreset =
    selectedNode?.type === 'video' &&
    activeDuration != null &&
    DURATION_PRESETS.some((preset) => preset === activeDuration)
      ? String(activeDuration)
      : CUSTOM_RESOLUTION_VALUE;
  const activeFps =
    selectedNode?.type === 'video' ? ((selectedNode.data as VideoNodeData).fps ?? 24) : undefined;
  const visibleVariantCount = Math.max(activeVariantCount, activeVariants.length);
  const shouldShowVariantGrid = visibleVariantCount > 0 && generationData?.status !== 'empty';
  const selectedVariantMediaType: 'image' | 'video' | 'audio' =
    selectedNode?.type === 'video' ? 'video' : selectedNode?.type === 'audio' ? 'audio' : 'image';
  const resolutionControlValue = resolutionSelectValue ?? activeResolutionPreset;
  const durationControlValue = durationSelectValue ?? activeDurationPreset;
  const providerCandidates = useMemo(() => {
    if (!isGenerationNode(selectedNode)) return [];
    if (selectedNode.type === 'audio') return audioProviders;
    if (selectedNode.type === 'video') return videoProviders;
    return imageProviders;
  }, [audioProviders, imageProviders, selectedNode, videoProviders]);

  const nodeCharacterRefs: CharacterRef[] = useMemo(() => {
    if (!selectedNode || (selectedNode.type !== 'image' && selectedNode.type !== 'video'))
      return [];
    return (selectedNode.data as ImageNodeData | VideoNodeData).characterRefs ?? [];
  }, [selectedNode]);

  const nodeEquipmentRefs: EquipmentRef[] = useMemo(() => {
    if (!selectedNode || (selectedNode.type !== 'image' && selectedNode.type !== 'video'))
      return [];
    const raw = (selectedNode.data as ImageNodeData | VideoNodeData).equipmentRefs ?? [];
    return raw.map((r) => (typeof r === 'string' ? { equipmentId: r } : r));
  }, [selectedNode]);

  const availableCharacters = useMemo(() => {
    const usedIds = new Set(nodeCharacterRefs.map((r) => r.characterId));
    return characters.filter((ch) => !usedIds.has(ch.id));
  }, [characters, nodeCharacterRefs]);

  const availableEquipment = useMemo(() => {
    const usedIds = new Set(nodeEquipmentRefs.map((r) => r.equipmentId));
    return equipmentItems.filter((eq) => !usedIds.has(eq.id));
  }, [equipmentItems, nodeEquipmentRefs]);

  const nodeLocationRefs: LocationRef[] = useMemo(() => {
    if (!selectedNode || (selectedNode.type !== 'image' && selectedNode.type !== 'video'))
      return [];
    return (selectedNode.data as ImageNodeData | VideoNodeData).locationRefs ?? [];
  }, [selectedNode]);

  const availableLocations = useMemo(() => {
    const usedIds = new Set(nodeLocationRefs.map((r) => r.locationId));
    return locationItems.filter((loc) => !usedIds.has(loc.id));
  }, [locationItems, nodeLocationRefs]);

  const contextBadgeCount =
    nodeCharacterRefs.length + nodeEquipmentRefs.length + nodeLocationRefs.length;

  // Auto-select first/last frame for video nodes
  useEffect(() => {
    if (!selectedNode || selectedNode.type !== 'video' || !canvas) return;
    const videoData = selectedNode.data as VideoNodeData;
    const firstCandidates = canvas.edges
      .filter((e) => e.target === selectedNode.id)
      .map((e) => canvas.nodes.find((n) => n.id === e.source))
      .filter((n): n is CanvasNode & { data: ImageNodeData } => n?.type === 'image');
    const lastCandidates = canvas.edges
      .filter((e) => e.source === selectedNode.id)
      .map((e) => canvas.nodes.find((n) => n.id === e.target))
      .filter((n): n is CanvasNode & { data: ImageNodeData } => n?.type === 'image');

    if (firstCandidates.length === 1 && videoData.firstFrameNodeId !== firstCandidates[0].id) {
      dispatch(
        setVideoFrameNode({
          id: selectedNode.id,
          role: 'first',
          frameNodeId: firstCandidates[0].id,
        }),
      );
    }
    if (firstCandidates.length === 0 && videoData.firstFrameNodeId) {
      dispatch(setVideoFrameNode({ id: selectedNode.id, role: 'first', frameNodeId: undefined }));
    }
    if (lastCandidates.length === 1 && videoData.lastFrameNodeId !== lastCandidates[0].id) {
      dispatch(
        setVideoFrameNode({ id: selectedNode.id, role: 'last', frameNodeId: lastCandidates[0].id }),
      );
    }
    if (lastCandidates.length === 0 && videoData.lastFrameNodeId) {
      dispatch(setVideoFrameNode({ id: selectedNode.id, role: 'last', frameNodeId: undefined }));
    }
  }, [canvas, selectedNode, dispatch]);

  useEffect(() => {
    if (!visualGenerationNode) {
      setResolutionSelectValue(null);
      return;
    }
    setResolutionSelectValue(
      getResolutionPresetValue(visualGenerationNode.type, activeWidth, activeHeight),
    );
  }, [activeHeight, activeWidth, visualGenerationNode?.id, visualGenerationNode?.type]);

  useEffect(() => {
    if (selectedNode?.type !== 'video') {
      setDurationSelectValue(null);
      return;
    }
    setDurationSelectValue(
      DURATION_PRESETS.some((preset) => preset === activeDuration)
        ? String(activeDuration)
        : CUSTOM_RESOLUTION_VALUE,
    );
  }, [activeDuration, selectedNode?.id, selectedNode?.type]);

  useEffect(() => {
    if (!canvas) return;
    for (const node of canvas.nodes) {
      const pendingSeed = pendingRandomSeedByNodeId.current[node.id];
      if (typeof pendingSeed !== 'number' || !isGenerationNode(node)) {
        continue;
      }
      if (node.data.status === 'generating' || node.data.status === 'empty') {
        continue;
      }
      delete pendingRandomSeedByNodeId.current[node.id];
      dispatch(setNodeSeed({ id: node.id, seed: pendingSeed }));
    }
  }, [canvas, dispatch]);

  const handleAddCharacterRef = useCallback(
    (characterId: string) => {
      if (!selectedNode) return;
      const character = characterById[characterId];
      dispatch(
        addNodeCharacterRef({
          id: selectedNode.id,
          characterRef: {
            characterId,
            loadoutId: character?.defaultLoadoutId ?? '',
          },
        }),
      );
      setCharPickerOpen(false);
    },
    [dispatch, selectedNode, characterById],
  );

  const handleRemoveCharacterRef = useCallback(
    (characterId: string) => {
      if (!selectedNode) return;
      dispatch(removeNodeCharacterRef({ id: selectedNode.id, characterId }));
    },
    [dispatch, selectedNode],
  );

  const handleCharacterAngleChange = useCallback(
    (characterId: string, angleSlot: string | undefined) => {
      if (!selectedNode) return;
      const character = characters.find((c) => c.id === characterId);
      const referenceImageHash = angleSlot
        ? character?.referenceImages?.find((r: ReferenceImage) => r.slot === angleSlot)?.assetHash
        : undefined;
      dispatch(
        updateNodeCharacterRef({
          id: selectedNode.id,
          characterId,
          changes: { angleSlot, referenceImageHash },
        }),
      );
    },
    [dispatch, selectedNode, characters],
  );

  const handleAddEquipmentRef = useCallback(
    (equipmentId: string) => {
      if (!selectedNode) return;
      dispatch(addNodeEquipmentRef({ id: selectedNode.id, equipmentId }));
      setEquipPickerOpen(false);
    },
    [dispatch, selectedNode],
  );

  const handleRemoveEquipmentRef = useCallback(
    (equipmentId: string) => {
      if (!selectedNode) return;
      dispatch(removeNodeEquipmentRef({ id: selectedNode.id, equipmentId }));
    },
    [dispatch, selectedNode],
  );

  const handleEquipmentAngleChange = useCallback(
    (equipmentId: string, angleSlot: string | undefined) => {
      if (!selectedNode) return;
      const equipment = equipmentItems.find((e) => e.id === equipmentId);
      const referenceImageHash = angleSlot
        ? equipment?.referenceImages?.find((r: ReferenceImage) => r.slot === angleSlot)?.assetHash
        : undefined;
      dispatch(
        updateNodeEquipmentRef({
          id: selectedNode.id,
          equipmentId,
          changes: { angleSlot, referenceImageHash },
        }),
      );
    },
    [dispatch, selectedNode, equipmentItems],
  );

  const handleAddLocationRef = useCallback(
    (locationId: string) => {
      if (!selectedNode) return;
      dispatch(addNodeLocationRef({ id: selectedNode.id, locationId }));
      setLocPickerOpen(false);
    },
    [dispatch, selectedNode],
  );

  const handleRemoveLocationRef = useCallback(
    (locationId: string) => {
      if (!selectedNode) return;
      dispatch(removeNodeLocationRef({ id: selectedNode.id, locationId }));
    },
    [dispatch, selectedNode],
  );

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedNode) return;
      dispatch(renameNode({ id: selectedNode.id, title: e.target.value }));
    },
    [dispatch, selectedNode],
  );

  const handleApplyTemplate = useCallback(
    (template: ShotTemplate) => {
      if (!selectedNode) return;
      dispatch(applyNodeShotTemplate({ nodeId: selectedNode.id, template }));
      setTemplateDropdownOpen(false);
    },
    [dispatch, selectedNode],
  );

  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!selectedNode || selectedNode.type !== 'text') return;
      dispatch(
        updateNodeData({
          id: selectedNode.id,
          data: { content: e.target.value } as Partial<TextNodeData>,
        }),
      );
    },
    [dispatch, selectedNode],
  );

  const handlePromptChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!isGenerationNode(selectedNode)) return;
      dispatch(
        updateNodeData({
          id: selectedNode.id,
          data: { prompt: event.target.value } as Partial<
            ImageNodeData | VideoNodeData | AudioNodeData
          >,
        }),
      );
    },
    [dispatch, selectedNode],
  );

  const handleAllTracksAiDecideChange = useCallback(
    (aiDecide: boolean) => {
      if (!hasTracks(selectedNode)) return;
      dispatch(
        setAllTracksAiDecide({
          id: selectedNode.id,
          aiDecide,
        }),
      );
    },
    [dispatch, selectedNode],
  );

  const handleBackdropColorChange = useCallback(
    (color: string) => {
      if (selectedNode?.type !== 'backdrop') return;
      dispatch(setBackdropColor({ id: selectedNode.id, color }));
    },
    [dispatch, selectedNode],
  );

  const handleBackdropColorInputChange = useCallback(
    (color: string) => {
      if (selectedNode?.type !== 'backdrop') return;
      if (!/^#[\da-f]{3,6}$/i.test(color)) return;
      dispatch(setBackdropColor({ id: selectedNode.id, color }));
    },
    [dispatch, selectedNode],
  );

  const handleBackdropOpacityChange = useCallback(
    (opacity: number) => {
      if (selectedNode?.type !== 'backdrop') return;
      dispatch(setBackdropOpacity({ id: selectedNode.id, opacity }));
    },
    [dispatch, selectedNode],
  );

  const handleBackdropBorderStyleChange = useCallback(
    (borderStyle: 'dashed' | 'solid' | 'dotted') => {
      if (selectedNode?.type !== 'backdrop') return;
      dispatch(setBackdropBorderStyle({ id: selectedNode.id, borderStyle }));
    },
    [dispatch, selectedNode],
  );

  const handleBackdropTitleSizeChange = useCallback(
    (titleSize: 'sm' | 'md' | 'lg') => {
      if (selectedNode?.type !== 'backdrop') return;
      dispatch(setBackdropTitleSize({ id: selectedNode.id, titleSize }));
    },
    [dispatch, selectedNode],
  );

  const handleBackdropLockChildrenChange = useCallback(
    (lockChildren: boolean) => {
      if (selectedNode?.type !== 'backdrop') return;
      dispatch(setBackdropLockChildren({ id: selectedNode.id, lockChildren }));
    },
    [dispatch, selectedNode],
  );

  const handleBackdropAutoArrange = useCallback(() => {
    if (selectedNode?.type !== 'backdrop' || !canvas) return;
    const bx = selectedNode.position.x;
    const by = selectedNode.position.y;
    const bw = selectedNode.width ?? 420;
    const bh = selectedNode.height ?? 240;
    const padding = 20;
    const headerHeight = 50;
    const childNodes = canvas.nodes.filter((node) => {
      if (node.id === selectedNode.id || node.type === 'backdrop') return false;
      const width = node.width ?? 200;
      const height = node.height ?? 100;
      const centerX = node.position.x + width / 2;
      const centerY = node.position.y + height / 2;
      return centerX >= bx && centerX <= bx + bw && centerY >= by && centerY <= by + bh;
    });
    if (childNodes.length === 0) return;
    const cols = Math.ceil(Math.sqrt(childNodes.length));
    const cellW = (bw - padding * 2) / cols;
    const cellH = (bh - headerHeight - padding * 2) / Math.ceil(childNodes.length / cols);
    childNodes.forEach((child, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      dispatch(
        moveNode({
          id: child.id,
          position: {
            x: bx + padding + col * cellW + (cellW - (child.width ?? 200)) / 2,
            y: by + headerHeight + padding + row * cellH + (cellH - (child.height ?? 100)) / 2,
          },
        }),
      );
    });
  }, [canvas, dispatch, selectedNode]);

  useEffect(() => {
    if (!isGenerationNode(selectedNode)) {
      setConfiguredProviders([]);
      setProviderLoading(false);
      return;
    }
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

    return () => {
      cancelled = true;
    };
  }, [activeProviderId, dispatch, providerCandidates, selectedNode]);

  const selectedNodeId = isGenerationNode(selectedNode) ? selectedNode.id : undefined;

  useEffect(() => {
    if (!selectedNodeId || !activeProviderId || !activeCanvasId) return;
    const api = getAPI();
    if (!api?.canvasGeneration) return;
    let cancelled = false;
    void api.canvasGeneration
      .estimateCost(activeCanvasId, selectedNodeId, activeProviderId, activeProviderConfig)
      .then((result) => {
        if (!cancelled)
          dispatch(
            setNodeEstimatedCost({ id: selectedNodeId, estimatedCost: result.estimatedCost }),
          );
      })
      .catch(() => {
        if (!cancelled) dispatch(setNodeEstimatedCost({ id: selectedNodeId, estimatedCost: 0 }));
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeCanvasId,
    activeProviderId,
    activeProviderConfig,
    activeVariantCount,
    dispatch,
    selectedNodeId,
  ]);

  const handleProviderChange = useCallback(
    (providerId: string) => {
      if (!isGenerationNode(selectedNode)) return;
      dispatch(setNodeProvider({ id: selectedNode.id, providerId }));
    },
    [dispatch, selectedNode],
  );

  const handleProviderSelectChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      handleProviderChange(event.target.value);
    },
    [handleProviderChange],
  );

  const handleVariantCountChange = useCallback(
    (count: number) => {
      if (!isGenerationNode(selectedNode)) return;
      dispatch(setNodeVariantCount({ id: selectedNode.id, count }));
    },
    [dispatch, selectedNode],
  );

  const handleSeedChange = useCallback(
    (seed: number | undefined) => {
      if (!isGenerationNode(selectedNode)) return;
      dispatch(setNodeSeed({ id: selectedNode.id, seed }));
    },
    [dispatch, selectedNode],
  );

  const handleResolutionChange = useCallback(
    (value: ResolutionPresetValue) => {
      if (!visualGenerationNode) return;
      setResolutionSelectValue(value);
      if (value === CUSTOM_RESOLUTION_VALUE) {
        if (typeof activeWidth === 'number' && typeof activeHeight === 'number') {
          dispatch(
            setNodeResolution({
              id: visualGenerationNode.id,
              width: activeWidth,
              height: activeHeight,
            }),
          );
        }
        return;
      }
      const preset = getResolutionPresetDimensions(value);
      if (!preset) return;
      dispatch(
        setNodeResolution({
          id: visualGenerationNode.id,
          width: preset.width,
          height: preset.height,
        }),
      );
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
      dispatch(
        setNodeResolution({
          id: visualGenerationNode.id,
          width: Math.round(nextWidth),
          height: activeHeight ?? defaultResolution?.height ?? 1024,
        }),
      );
    },
    [activeHeight, defaultResolution?.height, dispatch, visualGenerationNode],
  );

  const handleResolutionHeightChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!visualGenerationNode) return;
      const nextHeight = event.target.valueAsNumber;
      if (!Number.isFinite(nextHeight) || nextHeight < 1) return;
      dispatch(
        setNodeResolution({
          id: visualGenerationNode.id,
          width: activeWidth ?? defaultResolution?.width ?? 1024,
          height: Math.round(nextHeight),
        }),
      );
    },
    [activeWidth, defaultResolution?.width, dispatch, visualGenerationNode],
  );

  const handleDurationChange = useCallback(
    (duration: number) => {
      if (selectedNode?.type !== 'video') return;
      dispatch(setNodeDuration({ id: selectedNode.id, duration }));
    },
    [dispatch, selectedNode],
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
      if (!Number.isFinite(nextDuration) || nextDuration < 1 || nextDuration > 60) {
        return;
      }
      handleDurationChange(Math.round(nextDuration));
    },
    [handleDurationChange],
  );

  const handleFpsChange = useCallback(
    (fps: number) => {
      if (selectedNode?.type !== 'video') return;
      dispatch(setNodeFps({ id: selectedNode.id, fps }));
    },
    [dispatch, selectedNode],
  );

  const handleFpsSelectChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      handleFpsChange(Number(event.target.value));
    },
    [handleFpsChange],
  );

  const handleSeedInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.value === '') {
        handleSeedChange(undefined);
        return;
      }
      const nextSeed = event.target.valueAsNumber;
      if (!Number.isFinite(nextSeed)) return;
      handleSeedChange(Math.round(nextSeed));
    },
    [handleSeedChange],
  );

  const handleRandomizeSeed = useCallback(() => {
    if (!isGenerationNode(selectedNode)) return;
    handleSeedChange(createRandomSeed());
  }, [handleSeedChange, selectedNode]);

  const handleToggleSeedLock = useCallback(() => {
    if (!isGenerationNode(selectedNode)) return;
    if (!activeSeedLocked && activeSeed == null) {
      handleSeedChange(createRandomSeed());
    }
    dispatch(toggleSeedLock({ id: selectedNode.id }));
  }, [activeSeed, activeSeedLocked, dispatch, handleSeedChange, selectedNode]);

  const handleGenerate = useCallback(async () => {
    if (!isGenerationNode(selectedNode)) return;
    if (!activeCanvasId) return;
    const api = getAPI();
    if (!api?.canvasGeneration) return;
    const randomSeed = createRandomSeed();
    const seedRequest = resolveSeedRequest({
      seed: activeSeed,
      seedLocked: activeSeedLocked,
      randomSeed,
    });

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
        activeCanvasId,
        selectedNode.id,
        activeProviderId,
        activeVariantCount,
        seedRequest.requestSeed,
        activeProviderConfig,
      );
      dispatch(setNodeGenerating({ id: selectedNode.id, jobId: result.jobId }));
    } catch (error) {
      delete pendingRandomSeedByNodeId.current[selectedNode.id];
      const msg = error instanceof Error ? error.message : String(error);
      dispatch(setNodeGenerationFailed({ id: selectedNode.id, error: msg }));
      dispatch(enqueueToast({ title: t('generation.failed'), message: msg, variant: 'error' }));
    }
  }, [
    activeCanvasId,
    activeProviderConfig,
    activeProviderId,
    activeSeed,
    activeSeedLocked,
    activeVariantCount,
    dispatch,
    selectedNode,
    t,
  ]);

  const handleCancelGeneration = useCallback(async () => {
    if (!isGenerationNode(selectedNode)) return;
    if (!activeCanvasId) return;
    const api = getAPI();
    if (!api?.canvasGeneration) return;
    await api.canvasGeneration.cancel(activeCanvasId, selectedNode.id);
  }, [activeCanvasId, selectedNode]);

  const handleFirstFrameChange = useCallback(
    (frameNodeId: string | undefined) => {
      if (selectedNode?.type !== 'video') return;
      dispatch(setVideoFrameNode({ id: selectedNode.id, role: 'first', frameNodeId }));
    },
    [dispatch, selectedNode],
  );

  const handleLastFrameChange = useCallback(
    (frameNodeId: string | undefined) => {
      if (selectedNode?.type !== 'video') return;
      dispatch(setVideoFrameNode({ id: selectedNode.id, role: 'last', frameNodeId }));
    },
    [dispatch, selectedNode],
  );

  const handleUploadAsset = useCallback(async () => {
    if (selectedNode?.type !== 'image' && selectedNode?.type !== 'video') return;
    const api = getAPI();
    if (!api) return;
    const ref = (await api.asset.pickFile(selectedNode.type)) as { hash: string } | null;
    if (!ref) return;
    dispatch(setNodeUploadedAsset({ id: selectedNode.id, assetHash: ref.hash }));
  }, [dispatch, selectedNode]);

  const handleClearUploadedAsset = useCallback(() => {
    if (selectedNode?.type !== 'image' && selectedNode?.type !== 'video') return;
    dispatch(clearNodeAsset({ id: selectedNode.id }));
  }, [dispatch, selectedNode]);

  const handleSelectVariant = useCallback(
    (index: number) => {
      if (!isGenerationNode(selectedNode)) return;
      dispatch(selectVariant({ id: selectedNode.id, index }));
    },
    [dispatch, selectedNode],
  );

  if (!selectedNode) {
    return <InspectorPanelEmptyState text={t('inspector.selectNode')} />;
  }

  const meta = TYPE_META[selectedNode.type];
  const Icon = meta.icon;
  const presetTrackGrid = hasTracks(selectedNode)
    ? categories.map((category) => (
        <InspectorTrackGridCell
          key={category}
          nodeId={selectedNode.id}
          category={category}
          presets={presets.filter(
            (preset) => preset.category === category && !hiddenPresetIds.includes(preset.id),
          )}
          presetById={presetById}
          track={
            selectedNode.data.presetTracks[category] ?? {
              category,
              aiDecide: false,
              entries: [],
            }
          }
        />
      ))
    : null;
  const allTracksAiDecide = hasTracks(selectedNode)
    ? Object.values(selectedNode.data.presetTracks).every((track) => track.aiDecide)
    : false;
  const backdropControls =
    selectedNode.type === 'backdrop'
      ? {
          data: selectedNode.data as BackdropNodeData,
          swatches: [
            '#334155',
            '#1e3a5f',
            '#3b1f5e',
            '#5c1a1a',
            '#1a4d2e',
            '#4a3728',
            '#4b5563',
            '#0f766e',
          ],
          onColorChange: handleBackdropColorChange,
          onColorInputChange: handleBackdropColorInputChange,
          onOpacityChange: handleBackdropOpacityChange,
          onBorderStyleChange: handleBackdropBorderStyleChange,
          onTitleSizeChange: handleBackdropTitleSizeChange,
          onLockChildrenChange: handleBackdropLockChildrenChange,
          onAutoArrange: handleBackdropAutoArrange,
        }
      : undefined;
  const characterPickerOptions = availableCharacters.map((character) => ({
    id: character.id,
    label: character.name || t('characterManager.untitled'),
  }));
  const characterContextItems = nodeCharacterRefs.map((ref) => {
    const character = characterById[ref.characterId];
    const slotOptions = (character?.referenceImages ?? [])
      .filter((image: ReferenceImage) => image.assetHash)
      .map((image: ReferenceImage) => ({
        value: image.slot,
        label: localizeSlot(image.slot),
      }));
    return {
      id: ref.characterId,
      label: character?.name ?? ref.characterId.slice(0, 8),
      selectedSlot: ref.angleSlot ?? '',
      slotOptions,
    };
  });
  const equipmentPickerOptions = availableEquipment.map((equipment) => ({
    id: equipment.id,
    label: equipment.name || t('equipmentManager.untitled'),
    description: equipment.type,
  }));
  const equipmentContextItems = nodeEquipmentRefs.map((ref) => {
    const equipment = equipmentById[ref.equipmentId];
    const slotOptions = (equipment?.referenceImages ?? [])
      .filter((image: ReferenceImage) => image.assetHash)
      .map((image: ReferenceImage) => ({
        value: image.slot,
        label: localizeSlot(image.slot),
      }));
    return {
      id: ref.equipmentId,
      label: equipment?.name ?? ref.equipmentId.slice(0, 8),
      selectedSlot: ref.angleSlot ?? '',
      slotOptions,
    };
  });
  const locationPickerOptions = availableLocations.map((location) => ({
    id: location.id,
    label: location.name || t('locationManager.title'),
    description: location.type.toUpperCase(),
  }));
  const locationContextItems = nodeLocationRefs.map((ref) => {
    const location = locationById[ref.locationId];
    const typeBadge = location?.type
      ? location.type === 'int-ext'
        ? 'INT-EXT'
        : location.type.toUpperCase()
      : undefined;
    return {
      id: ref.locationId,
      label: location?.name ?? ref.locationId.slice(0, 8),
      description: typeBadge,
    };
  });
  const videoFramesSection =
    selectedNode.type === 'video'
      ? (() => {
          const videoData = selectedNode.data as VideoNodeData;
          const firstCandidates = (canvas?.edges ?? [])
            .filter((edge) => edge.target === selectedNode.id)
            .map((edge) => canvas?.nodes.find((node) => node.id === edge.source))
            .filter((node): node is CanvasNode & { data: ImageNodeData } => node?.type === 'image');
          const lastCandidates = (canvas?.edges ?? [])
            .filter((edge) => edge.source === selectedNode.id)
            .map((edge) => canvas?.nodes.find((node) => node.id === edge.target))
            .filter((node): node is CanvasNode & { data: ImageNodeData } => node?.type === 'image');
          const selectedFirst = firstCandidates.find(
            (node) => node.id === videoData.firstFrameNodeId,
          );
          const selectedLast = lastCandidates.find((node) => node.id === videoData.lastFrameNodeId);
          return {
            firstOptions: firstCandidates.map((node) => ({
              value: node.id,
              label: node.title || node.id.slice(0, 8),
            })),
            lastOptions: lastCandidates.map((node) => ({
              value: node.id,
              label: node.title || node.id.slice(0, 8),
            })),
            selectedFirstId: videoData.firstFrameNodeId,
            selectedLastId: videoData.lastFrameNodeId,
            firstPreview: selectedFirst ? <InspectorFrameThumb node={selectedFirst} /> : undefined,
            lastPreview: selectedLast ? <InspectorFrameThumb node={selectedLast} /> : undefined,
            onFirstChange: handleFirstFrameChange,
            onLastChange: handleLastFrameChange,
          };
        })()
      : undefined;
  const variantGrid = shouldShowVariantGrid
    ? Array.from({ length: Math.min(visibleVariantCount, 9) }, (_, index) => {
        const hash = activeVariants[index];
        return (
          <InspectorVariantThumb
            key={hash ?? `variant-placeholder-${index}`}
            hash={hash}
            index={index}
            selected={selectedVariantIndex === index}
            mediaType={selectedVariantMediaType}
            onClick={() => handleSelectVariant(index)}
          />
        );
      })
    : null;
  const metadataCreatedAt = new Date(selectedNode.createdAt).toLocaleString();
  const metadataUpdatedAt = new Date(selectedNode.updatedAt).toLocaleString();

  return (
    <div className="h-full flex flex-col bg-card border-l border-border/60 overflow-auto">
      <InspectorPanelHeader
        icon={Icon}
        iconColorClass={meta.color}
        title={t('inspector.title')}
        closeLabel={t('inspector.closeInspector')}
        onClose={() => dispatch(setRightPanel(null))}
      />

      <div className="flex-1 overflow-auto">
        <InspectorPanelIdentitySection
          node={selectedNode}
          icon={Icon}
          iconColorClass={meta.color}
          titleLabel={t('inspector.titleLabel')}
          titlePlaceholder={t('inspector.nodeTitle')}
          typeLabel={t('inspector.type')}
          statusLabel={t('inspector.status')}
          positionLabel={t('inspector.position')}
          sizeLabel={t('inspector.size')}
          connectionsLabel={t('inspector.connections')}
          connectionCount={
            canvas
              ? canvas.edges.filter(
                  (e) => e.source === selectedNode.id || e.target === selectedNode.id,
                ).length
              : 0
          }
          generationTimeLabel={
            generationData?.generationTimeMs != null
              ? t('inspector.generatedIn').replace(
                  '{time}',
                  `${(generationData.generationTimeMs / 1000).toFixed(1)}s`,
                )
              : undefined
          }
          nodeTypeLabel={t(meta.label)}
          nodeStatusLabel={t('status.' + selectedNode.status)}
          onTitleChange={handleTitleChange}
        />

        <InspectorPanelTabBar
          activeTab={inspectorTab}
          contextBadgeCount={contextBadgeCount}
          labels={{
            creative: t('inspector.tabs.creative'),
            context: t('inspector.tabs.context'),
            technical: t('inspector.tabs.technical'),
          }}
          onChange={setInspectorTab}
        />

        {/* ===== Creative Tab ===== */}
        {inspectorTab === 'creative' && (
          <InspectorCreativeTab
            t={t}
            selectedNodeType={selectedNode.type}
            generationData={generationData}
            audioType={
              selectedNode.type === 'audio'
                ? (selectedNode.data as { audioType?: string }).audioType
                : undefined
            }
            textContent={
              selectedNode.type === 'text' ? (selectedNode.data as TextNodeData).content : undefined
            }
            onContentChange={handleContentChange}
            onPromptChange={handlePromptChange}
            templateDropdownOpen={templateDropdownOpen}
            onToggleTemplateDropdown={() => setTemplateDropdownOpen((value) => !value)}
            builtInTemplates={builtInTemplates}
            customTemplates={customTemplates}
            hiddenTemplateIds={hiddenTemplateIds}
            onApplyTemplate={handleApplyTemplate}
            localizeShotTemplateName={localizeShotTemplateName}
            localizeShotTemplateDescription={localizeShotTemplateDescription}
            allTracksAiDecide={allTracksAiDecide}
            onToggleAllTracksAiDecide={handleAllTracksAiDecideChange}
            trackGrid={presetTrackGrid}
            backdropControls={backdropControls}
            textCharCount={
              selectedNode.type === 'text'
                ? ((selectedNode.data as TextNodeData).content ?? '').length
                : undefined
            }
            textWordCount={
              selectedNode.type === 'text'
                ? ((selectedNode.data as TextNodeData).content ?? '')
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean).length
                : undefined
            }
            charsLabel={
              selectedNode.type === 'text'
                ? t('inspector.chars').replace(
                    '{count}',
                    String(((selectedNode.data as TextNodeData).content ?? '').length),
                  )
                : undefined
            }
            wordsLabel={
              selectedNode.type === 'text'
                ? t('inspector.words').replace(
                    '{count}',
                    String(
                      ((selectedNode.data as TextNodeData).content ?? '')
                        .trim()
                        .split(/\s+/)
                        .filter(Boolean).length,
                    ),
                  )
                : undefined
            }
          />
        )}

        {/* ===== Context Tab ===== */}
        {inspectorTab === 'context' && (
          <InspectorContextTab
            t={t}
            selectedNodeType={selectedNode.type}
            charPickerOpen={charPickerOpen}
            equipPickerOpen={equipPickerOpen}
            locPickerOpen={locPickerOpen}
            availableCharacters={characterPickerOptions}
            availableEquipment={equipmentPickerOptions}
            availableLocations={locationPickerOptions}
            characterItems={characterContextItems}
            equipmentItems={equipmentContextItems}
            locationItems={locationContextItems}
            onToggleCharPicker={() => setCharPickerOpen((value) => !value)}
            onToggleEquipPicker={() => setEquipPickerOpen((value) => !value)}
            onToggleLocPicker={() => setLocPickerOpen((value) => !value)}
            onAddCharacter={handleAddCharacterRef}
            onAddEquipment={handleAddEquipmentRef}
            onAddLocation={handleAddLocationRef}
            onCharacterSlotChange={handleCharacterAngleChange}
            onEquipmentSlotChange={handleEquipmentAngleChange}
            onRemoveCharacter={handleRemoveCharacterRef}
            onRemoveEquipment={handleRemoveEquipmentRef}
            onRemoveLocation={handleRemoveLocationRef}
          />
        )}

        {/* ===== Technical Tab ===== */}
        {inspectorTab === 'technical' && (
          <InspectorTechnicalTab
            t={t}
            selectedNode={selectedNode}
            videoFramesSection={videoFramesSection}
            uploadSection={
              selectedNode.type === 'image' || selectedNode.type === 'video'
                ? {
                    hasAsset: Boolean(generationData?.assetHash),
                    onUpload: handleUploadAsset,
                    onClear: handleClearUploadedAsset,
                  }
                : undefined
            }
            generationSection={
              isGenerationNode(selectedNode)
                ? {
                    providerOptions: configuredProviders.map((provider) => ({
                      id: provider.id,
                      name: provider.name,
                    })),
                    activeProviderId,
                    providerLoading,
                    onProviderChange: handleProviderSelectChange,
                    variantOptions: VARIANT_OPTIONS,
                    activeVariantCount,
                    onVariantCountChange: handleVariantCountChange,
                    resolutionGroups: visualGenerationNode
                      ? RESOLUTION_PRESET_GROUPS.map((group) => ({
                          label: group.label,
                          options: group.options.map((preset) => ({
                            value: preset.value,
                            label: preset.label,
                          })),
                        }))
                      : undefined,
                    resolutionValue: visualGenerationNode ? resolutionControlValue : undefined,
                    customResolutionValue: CUSTOM_RESOLUTION_VALUE,
                    widthValue: activeWidth,
                    heightValue: activeHeight,
                    onResolutionChange: visualGenerationNode
                      ? handleResolutionSelectChange
                      : undefined,
                    onWidthChange: visualGenerationNode ? handleResolutionWidthChange : undefined,
                    onHeightChange: visualGenerationNode ? handleResolutionHeightChange : undefined,
                    durationOptions: selectedNode.type === 'video' ? DURATION_PRESETS : undefined,
                    durationValue: selectedNode.type === 'video' ? durationControlValue : undefined,
                    onDurationChange:
                      selectedNode.type === 'video' ? handleDurationSelectChange : undefined,
                    durationInputValue: activeDuration,
                    onDurationInputChange:
                      selectedNode.type === 'video' ? handleDurationInputChange : undefined,
                    fpsOptions: selectedNode.type === 'video' ? FPS_PRESETS : undefined,
                    fpsValue: activeFps,
                    onFpsChange: selectedNode.type === 'video' ? handleFpsSelectChange : undefined,
                    seedValue: activeSeed,
                    seedLocked: activeSeedLocked,
                    onSeedChange: handleSeedInputChange,
                    onRandomizeSeed: handleRandomizeSeed,
                    onToggleSeedLock: handleToggleSeedLock,
                    estimatedCost:
                      typeof generationData?.estimatedCost === 'number'
                        ? `${t('inspector.estimated')}: $${generationData.estimatedCost.toFixed(2)}`
                        : undefined,
                    variantGrid,
                    isGenerating: generationData?.status === 'generating',
                    hasVariants: activeVariants.length > 0,
                    onGenerate: handleGenerate,
                    onCancel: handleCancelGeneration,
                  }
                : undefined
            }
            metadataCreatedAt={metadataCreatedAt}
            metadataUpdatedAt={metadataUpdatedAt}
            generationTimeMs={generationData?.generationTimeMs}
          />
        )}
      </div>

      {/* Generation bar — always visible at bottom for generation nodes */}
      {isGenerationNode(selectedNode) && (
        <InspectorGenerationBar
          t={t}
          providerOptions={configuredProviders.map((p) => ({ id: p.id, name: p.name }))}
          activeProviderId={activeProviderId}
          providerLoading={providerLoading}
          onProviderChange={handleProviderSelectChange}
          variantOptions={VARIANT_OPTIONS}
          activeVariantCount={activeVariantCount}
          onVariantCountChange={handleVariantCountChange}
          isGenerating={generationData?.status === 'generating'}
          hasVariants={activeVariants.length > 0}
          estimatedCost={
            typeof generationData?.estimatedCost === 'number'
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
        />
      )}
    </div>
  );
}
