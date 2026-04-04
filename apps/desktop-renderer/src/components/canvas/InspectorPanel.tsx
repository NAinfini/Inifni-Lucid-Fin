import { useCallback, useEffect, useMemo, useState } from 'react';
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
  setNodeSeed,
  setNodeTrackAiDecide,
  setAllTracksAiDecide,
  setVideoFrameNode,
  setNodeVariantCount,
  setNodeUploadedAsset,
  clearNodeAsset,
  toggleSeedLock,
  addNodePresetTrackEntry,
  removeNodePresetTrackEntry,
  updateNodePresetTrackEntry,
  moveNodePresetTrackEntry,
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
import { addCustomTemplate } from '../../store/slices/shotTemplates.js';
import { setCharacters } from '../../store/slices/characters.js';
import { setEquipment } from '../../store/slices/equipment.js';
import { setLocations } from '../../store/slices/locations.js';
import {
  X,
  FileText,
  Image,
  LayoutTemplate,
  LayoutGrid,
  MapPin,
  Video,
  Volume2,
  ChevronDown,
  Search,
  Plus,
  User,
  Package,
  Trash2,
  Upload,
  Clapperboard,
  Save,
} from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { localizePresetName, localizeSlot } from '../../i18n.js';
import { useAssetUrl } from '../../hooks/useAssetUrl.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog.js';
import type {
  CanvasNode,
  CanvasNodeType,
  PresetCategory,
  PresetDefinition,
  PresetTrack,
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

const TYPE_META: Record<CanvasNodeType, { label: string; icon: typeof FileText; color: string }> = {
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

const CATEGORY_ACCENT: Record<string, string> = {
  camera: 'bg-blue-500',
  lens: 'bg-sky-500',
  look: 'bg-purple-500',
  scene: 'bg-amber-500',
  composition: 'bg-violet-500',
  emotion: 'bg-rose-500',
  flow: 'bg-teal-500',
  technical: 'bg-indigo-500',
};

const VARIANT_OPTIONS = [1, 2, 4, 9];

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function hasTracks(
  node: CanvasNode | undefined,
): node is CanvasNode & {
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

interface TrackEditorProps {
  nodeId: string;
  category: PresetCategory;
  presets: PresetDefinition[];
  presetById: Record<string, PresetDefinition>;
  track: PresetTrack;
}

function TrackEditor({ nodeId, category, presets, presetById, track }: TrackEditorProps) {
  const dispatch = useDispatch();
  const { t } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filteredPresets = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return presets;
    return presets.filter((preset) => {
      const localized = localizePresetName(preset.name);
      const text = `${preset.name} ${localized} ${preset.description}`.toLowerCase();
      return text.includes(keyword);
    });
  }, [presets, search]);

  const addPreset = useCallback(
    (presetId: string) => {
      dispatch(
        addNodePresetTrackEntry({
          id: nodeId,
          category,
          entry: {
            id: createId('entry'),
            category,
            presetId,
            params: {},
            order: track.entries.length,
          },
        }),
      );
      setPickerOpen(false);
      setSearch('');
    },
    [category, dispatch, nodeId],
  );

  return (
    <div className="rounded border border-border/70 bg-muted/20">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-border/60">
        <span className="text-[11px] font-medium">{t('presetCategory.' + category)}</span>
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            checked={track.aiDecide}
            onChange={(event) =>
              dispatch(
                setNodeTrackAiDecide({
                  id: nodeId,
                  category,
                  aiDecide: event.target.checked,
                }),
              )
            }
          />
          {t('commander.aiDecide')}
        </label>
      </div>

      <div className={cn('space-y-1 p-2', track.aiDecide && 'opacity-50')}>
        {track.aiDecide ? (
          <div className="rounded border border-dashed border-border/60 bg-muted/30 px-2 py-1 text-[10px] text-muted-foreground">
            {t('commander.aiWillChoose')}
          </div>
        ) : null}
        {track.entries.map((entry, index) => {
          const preset = presetById[entry.presetId];
          return (
            <div key={entry.id} className="rounded border border-border/60 bg-card px-2 py-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] truncate">{preset ? localizePresetName(preset.name) : entry.presetId}</span>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={entry.durationMs != null ? entry.durationMs / 1000 : ''}
                    onChange={(event) =>
                      dispatch(
                        updateNodePresetTrackEntry({
                          id: nodeId,
                          category,
                          entryId: entry.id,
                          changes: {
                            durationMs:
                              event.target.value === ''
                                ? undefined
                                : Math.round(Number(event.target.value) * 1000),
                          },
                        }),
                      )
                    }
                    className="w-14 bg-muted rounded px-1 text-[10px]"
                    placeholder={t('inspector.seconds')}
                    disabled={track.aiDecide}
                  />
                  <button
                    className="text-[10px] px-1 rounded border border-border hover:bg-muted"
                    onClick={() =>
                      dispatch(
                        moveNodePresetTrackEntry({
                          id: nodeId,
                          category,
                          entryId: entry.id,
                          direction: 'up',
                          }),
                        )
                      }
                    disabled={track.aiDecide || index === 0}
                  >
                    ↑
                  </button>
                  <button
                    className="text-[10px] px-1 rounded border border-border hover:bg-muted"
                    onClick={() =>
                      dispatch(
                        moveNodePresetTrackEntry({
                          id: nodeId,
                          category,
                          entryId: entry.id,
                          direction: 'down',
                          }),
                        )
                      }
                    disabled={track.aiDecide || index === track.entries.length - 1}
                  >
                    ↓
                  </button>
                  <button
                    className="text-[10px] px-1 rounded border border-border hover:bg-destructive/20"
                    onClick={() =>
                      dispatch(removeNodePresetTrackEntry({ id: nodeId, category, entryId: entry.id }))
                    }
                    disabled={track.aiDecide}
                  >
                    x
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        <div className="pt-1 space-y-1">
          <div className="flex items-center gap-1">
            <button
              className="inline-flex items-center gap-1 text-[10px] rounded border border-border px-1.5 py-0.5 hover:bg-muted"
              onClick={() => setPickerOpen((v) => !v)}
              disabled={track.aiDecide}
            >
              <Plus className="w-3 h-3" />
              {t('inspector.addPreset')}
              <ChevronDown className="w-3 h-3" />
            </button>
          </div>

          {pickerOpen && (
            <div className="rounded border border-border/70 bg-card p-1.5 space-y-1">
              <div className="relative">
                <Search className="w-3 h-3 absolute left-1.5 top-1.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="w-full bg-muted pl-6 pr-1.5 py-1 rounded text-[10px]"
                  placeholder={t('inspector.searchPresets')}
                  disabled={track.aiDecide}
                />
              </div>
              <div className="max-h-28 overflow-auto space-y-0.5">
                {filteredPresets.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => addPreset(preset.id)}
                    className="w-full text-left text-[10px] px-1.5 py-1 rounded hover:bg-muted"
                    disabled={track.aiDecide}
                  >
                    <div className="font-medium">{localizePresetName(preset.name)}</div>
                    <div className="text-muted-foreground truncate">{preset.description}</div>
                  </button>
                ))}
                {filteredPresets.length === 0 && (
                  <div className="text-[10px] text-muted-foreground px-1.5 py-1">{t('inspector.noPresets')}</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface TrackGridCellProps {
  nodeId: string;
  category: PresetCategory;
  presets: PresetDefinition[];
  presetById: Record<string, PresetDefinition>;
  track: PresetTrack;
}

function TrackGridCell({ nodeId, category, presets, presetById, track }: TrackGridCellProps) {
  const dispatch = useDispatch();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const hasEntries = track.entries.length > 0;
  const accent = CATEGORY_ACCENT[category] ?? 'bg-muted-foreground';
  const displayTrack = track;
  const previewNames = displayTrack.entries
    .slice(0, 2)
    .map((e) => {
      const p = presetById[e.presetId];
      return p ? localizePresetName(p.name) : e.presetId.slice(0, 6);
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'relative flex flex-col gap-1 rounded-lg border text-left transition-colors hover:bg-muted/40 overflow-hidden',
          hasEntries
            ? 'border-primary/30 bg-primary/5'
            : 'border-border/50 bg-muted/10',
        )}
      >
        {/* accent left bar */}
        <div className={cn('absolute left-0 top-0 bottom-0 w-0.5 rounded-l-lg', accent)} />

        <div className="pl-3 pr-2 pt-2 pb-1.5 w-full">
          {/* header row */}
          <div className="flex items-center justify-between gap-1 mb-1">
            <span className="text-[10px] font-semibold truncate leading-none">
              {t('presetCategory.' + category)}
            </span>
            {/* AI pill toggle */}
            <span
              role="checkbox"
              aria-checked={track.aiDecide}
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                dispatch(setNodeTrackAiDecide({ id: nodeId, category, aiDecide: !track.aiDecide }));
              }}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.stopPropagation();
                  dispatch(setNodeTrackAiDecide({ id: nodeId, category, aiDecide: !track.aiDecide }));
                }
              }}
              className={cn(
                'shrink-0 cursor-pointer rounded-full px-1.5 py-0.5 text-[8px] font-bold leading-none transition-colors select-none',
                track.aiDecide
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
              )}
            >
              AI
            </span>
          </div>

          {/* preset chips / empty hint */}
          {hasEntries ? (
            <div className="flex flex-wrap gap-0.5">
              {previewNames.map((name, i) => (
                <span
                  key={i}
                  className="rounded bg-primary/10 text-primary px-1 py-0.5 text-[9px] leading-none truncate max-w-full"
                >
                  {name}
                </span>
              ))}
              {track.entries.length > 2 && (
                <span className="rounded bg-muted text-muted-foreground px-1 py-0.5 text-[9px] leading-none">
                  +{track.entries.length - 2}
                </span>
              )}
            </div>
          ) : (
            <span className="text-[9px] text-muted-foreground/60 leading-none">{t('inspector.empty')}</span>
          )}
        </div>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{t('inspector.categoryPresetsTitle').replace('{category}', t('presetCategory.' + category))}</DialogTitle>
          </DialogHeader>
          <TrackEditor
            nodeId={nodeId}
            category={category}
            presets={presets}
            presetById={presetById}
            track={track}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function FrameThumb({ node }: { node: CanvasNode & { data: ImageNodeData } }) {
  const { t } = useI18n();
  const { url } = useAssetUrl(node.data.assetHash, 'image', 'jpg');
  return (
    <div className="flex flex-col gap-1">
      <div className="w-20 h-12 rounded border border-border overflow-hidden bg-muted flex items-center justify-center shrink-0">
        {url ? (
          <img src={url} alt={node.title} className="w-full h-full object-cover" />
        ) : (
          <Image className="w-4 h-4 text-muted-foreground" />
        )}
      </div>
      <span className="text-[10px] text-muted-foreground truncate max-w-[80px]">{node.title || t('node.image')}</span>
    </div>
  );
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
  const builtInTemplates = useSelector((s: RootState) => s.shotTemplates.builtIn);
  const customTemplates = useSelector((s: RootState) => s.shotTemplates.custom);
  const characters = useSelector((s: RootState) => s.characters.items);
  const equipmentItems = useSelector((s: RootState) => s.equipment.items);
  const locationItems = useSelector((s: RootState) => s.locations.items);
  const imageProviders = useSelector((s: RootState) => s.settings.image.providers);
  const videoProviders = useSelector((s: RootState) => s.settings.video.providers);
  const audioProviders = useSelector((s: RootState) => s.settings.audio.providers);
  const imageProviderIds = imageProviders.map((p) => p.id);
  const videoProviderIds = videoProviders.map((p) => p.id);
  const audioProviderIds = audioProviders.map((p) => p.id);

  useEffect(() => {
    const api = getAPI();
    if (!api) return;
    if (characters.length === 0) {
      void api.character.list().then((list) => {
        if (Array.isArray(list)) dispatch(setCharacters(list as import('@lucid-fin/contracts').Character[]));
      });
    }
    if (equipmentItems.length === 0) {
      void api.equipment.list().then((list) => {
        if (Array.isArray(list)) dispatch(setEquipment(list as import('@lucid-fin/contracts').Equipment[]));
      });
    }
    if (locationItems.length === 0) {
      void api.location.list().then((list) => {
        if (Array.isArray(list)) dispatch(setLocations(list as import('@lucid-fin/contracts').Location[]));
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

  const [inspectorTab, setInspectorTab] = useState<'creative' | 'context' | 'technical'>('creative');
  const [charPickerOpen, setCharPickerOpen] = useState(false);
  const [equipPickerOpen, setEquipPickerOpen] = useState(false);
  const [locPickerOpen, setLocPickerOpen] = useState(false);
  const [configuredProviders, setConfiguredProviders] = useState<import('../../store/slices/settings.js').ProviderConfig[]>([]);
  const [providerLoading, setProviderLoading] = useState(false);
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);
  const [saveTemplateDialogOpen, setSaveTemplateDialogOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  const selectedNode: CanvasNode | undefined =
    selectedNodeIds.length === 1
      ? canvas?.nodes.find((n) => n.id === selectedNodeIds[0])
      : undefined;

  const generationData: ImageNodeData | VideoNodeData | AudioNodeData | undefined = isGenerationNode(
    selectedNode,
  )
    ? selectedNode.data
    : undefined;
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

  const contextBadgeCount = nodeCharacterRefs.length + nodeEquipmentRefs.length + nodeLocationRefs.length;

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
      dispatch(setVideoFrameNode({ id: selectedNode.id, role: 'first', frameNodeId: firstCandidates[0].id }));
    }
    if (firstCandidates.length === 0 && videoData.firstFrameNodeId) {
      dispatch(setVideoFrameNode({ id: selectedNode.id, role: 'first', frameNodeId: undefined }));
    }
    if (lastCandidates.length === 1 && videoData.lastFrameNodeId !== lastCandidates[0].id) {
      dispatch(setVideoFrameNode({ id: selectedNode.id, role: 'last', frameNodeId: lastCandidates[0].id }));
    }
    if (lastCandidates.length === 0 && videoData.lastFrameNodeId) {
      dispatch(setVideoFrameNode({ id: selectedNode.id, role: 'last', frameNodeId: undefined }));
    }
  }, [canvas, selectedNode, dispatch]);

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
      dispatch(updateNodeCharacterRef({ id: selectedNode.id, characterId, changes: { angleSlot, referenceImageHash } }));
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
      dispatch(updateNodeEquipmentRef({ id: selectedNode.id, equipmentId, changes: { angleSlot, referenceImageHash } }));
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

  const handleSaveAsTemplate = useCallback(() => {
    if (!selectedNode || !hasTracks(selectedNode) || !newTemplateName.trim()) return;
    const tracks: Partial<Record<PresetCategory, PresetTrack>> = {};
    for (const [cat, track] of Object.entries(selectedNode.data.presetTracks)) {
      if (track.entries.length > 0) {
        tracks[cat as PresetCategory] = { ...track };
      }
    }
    dispatch(
      addCustomTemplate({
        id: `custom-tmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: newTemplateName.trim(),
        description: '',
        builtIn: false,
        tracks,
        createdAt: Date.now(),
      }),
    );
    setNewTemplateName('');
    setSaveTemplateDialogOpen(false);
  }, [dispatch, selectedNode, newTemplateName]);

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

  useEffect(() => {
    if (!isGenerationNode(selectedNode)) return;
    if (!activeProviderId) return;
    const api = getAPI();
    if (!api?.canvasGeneration || !activeCanvasId) return;
    void api.canvasGeneration
      .estimateCost(activeCanvasId, selectedNode.id, activeProviderId, activeProviderConfig)
      .then((result) => {
        dispatch(setNodeEstimatedCost({ id: selectedNode.id, estimatedCost: result.estimatedCost }));
      })
      .catch(() => {
        dispatch(setNodeEstimatedCost({ id: selectedNode.id, estimatedCost: 0 }));
      });
  }, [activeCanvasId, activeProviderId, activeVariantCount, dispatch, selectedNode]);

  const handleProviderChange = useCallback(
    (providerId: string) => {
      if (!isGenerationNode(selectedNode)) return;
      dispatch(setNodeProvider({ id: selectedNode.id, providerId }));
    },
    [dispatch, selectedNode],
  );

  const handleVariantCountChange = useCallback(
    (count: number) => {
      if (!isGenerationNode(selectedNode)) return;
      dispatch(setNodeVariantCount({ id: selectedNode.id, count }));
    },
    [dispatch, selectedNode],
  );

  const handleSeedChange = useCallback(
    (seed: number) => {
      if (!isGenerationNode(selectedNode)) return;
      dispatch(setNodeSeed({ id: selectedNode.id, seed }));
    },
    [dispatch, selectedNode],
  );

  const handleToggleSeedLock = useCallback(() => {
    if (!isGenerationNode(selectedNode)) return;
    dispatch(toggleSeedLock({ id: selectedNode.id }));
  }, [dispatch, selectedNode]);

  const handleGenerate = useCallback(async () => {
    if (!isGenerationNode(selectedNode)) return;
    if (!activeCanvasId) return;
    const api = getAPI();
    if (!api?.canvasGeneration) return;

    dispatch(setNodeGenerating({ id: selectedNode.id, jobId: `pending-${Date.now()}` }));
    try {
      const result = await api.canvasGeneration.generate(
        activeCanvasId,
        selectedNode.id,
        activeProviderId,
        activeVariantCount,
        activeSeed,
        activeProviderConfig,
      );
      dispatch(setNodeGenerating({ id: selectedNode.id, jobId: result.jobId }));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      dispatch(setNodeGenerationFailed({ id: selectedNode.id, error: msg }));
      dispatch(enqueueToast({ title: t('generation.failed'), message: msg, variant: 'error' }));
    }
  }, [activeCanvasId, activeProviderId, activeSeed, activeVariantCount, dispatch, selectedNode]);

  const handleCancelGeneration = useCallback(async () => {
    if (!isGenerationNode(selectedNode)) return;
    if (!activeCanvasId) return;
    const api = getAPI();
    if (!api?.canvasGeneration) return;
    await api.canvasGeneration.cancel(activeCanvasId, selectedNode.id);
  }, [activeCanvasId, selectedNode]);

  const handleSelectVariant = useCallback(
    (index: number) => {
      if (!isGenerationNode(selectedNode)) return;
      dispatch(selectVariant({ id: selectedNode.id, index }));
    },
    [dispatch, selectedNode],
  );

  if (!selectedNode) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-4">
        {t('inspector.selectNode')}
      </div>
    );
  }

  const meta = TYPE_META[selectedNode.type];
  const Icon = meta.icon;

  return (
    <div className="h-full flex flex-col bg-card border-l overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <Icon className={cn('w-4 h-4', meta.color)} />
          <span className="text-sm font-semibold">{t('inspector.title')}</span>
        </div>
        <button
          onClick={() => dispatch(setRightPanel(null))}
          className="p-1 rounded hover:bg-muted transition-colors"
          aria-label={t('inspector.closeInspector')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Identity section */}
        <div className="px-4 py-4 space-y-4 border-b">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {t('inspector.titleLabel')}
            </label>
            <input
              className="w-full bg-muted px-3 py-2 rounded-lg text-sm outline-none focus:ring-1 focus:ring-ring"
              value={selectedNode.title}
              onChange={handleTitleChange}
              placeholder={t('inspector.nodeTitle')}
            />
          </div>

          <div className="flex items-center gap-4">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('inspector.type')}</div>
              <div className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-muted', meta.color)}>
                <Icon className="w-3.5 h-3.5" />
                {t(meta.label)}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('inspector.status')}</div>
              <div className="text-sm capitalize">{t('status.' + selectedNode.status)}</div>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('inspector.position')}</div>
            <div className="flex gap-4 text-sm text-muted-foreground">
              <span>X: {Math.round(selectedNode.position.x)}</span>
              <span>Y: {Math.round(selectedNode.position.y)}</span>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b px-4 shrink-0">
          {(['creative', 'context', 'technical'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setInspectorTab(tab)}
              className={cn(
                'relative px-3 py-2 text-xs font-medium transition-colors',
                inspectorTab === tab
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground/70',
              )}
            >
              {t(`inspector.tabs.${tab}`)}
              {tab === 'context' && contextBadgeCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary/15 text-primary px-1 min-w-[14px] h-[14px] text-[9px] font-bold leading-none">
                  {contextBadgeCount}
                </span>
              )}
              {inspectorTab === tab && (
                <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-primary rounded-t" />
              )}
            </button>
          ))}
        </div>

        {/* ===== Creative Tab ===== */}
        {inspectorTab === 'creative' && (
          <>
            {/* Content section -- text nodes */}
            {selectedNode.type === 'text' && (
              <div className="px-4 py-4 border-b">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t('inspector.content')}
                </label>
                <textarea
                  className="mt-2 w-full bg-muted px-3 py-2 rounded-lg text-sm outline-none focus:ring-1 focus:ring-ring min-h-[140px] resize-y"
                  value={(selectedNode.data as TextNodeData).content}
                  onChange={handleContentChange}
                  placeholder={t('inspector.contentPlaceholder')}
                />
              </div>
            )}

            {/* Prompt */}
            {isGenerationNode(selectedNode) && (
              <div className="px-4 py-4 border-b">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  {t('inspector.prompt')}
                </div>
                <textarea
                  className="w-full bg-muted px-3 py-2 rounded-lg text-sm outline-none focus:ring-1 focus:ring-ring min-h-[110px] resize-y"
                  value={generationData?.prompt ?? ''}
                  onChange={(e) => {
                    dispatch(
                      updateNodeData({
                        id: selectedNode.id,
                        data: { prompt: e.target.value } as Partial<ImageNodeData | VideoNodeData | AudioNodeData>,
                      }),
                    );
                  }}
                  placeholder={t('inspector.promptPlaceholder')}
                />
              </div>
            )}

            {/* Shot Template Selector */}
            {hasTracks(selectedNode) && (
              <div className="px-4 py-4 border-b space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    <Clapperboard className="w-3.5 h-3.5" />
                    {t('shotTemplate.title')}
                  </div>
                  <button
                    className="text-[10px] text-primary hover:underline"
                    onClick={() => setSaveTemplateDialogOpen(true)}
                  >
                    <Save className="w-3 h-3 inline mr-0.5" />
                    {t('shotTemplate.saveCurrent')}
                  </button>
                </div>

                <div className="relative">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors"
                    onClick={() => setTemplateDropdownOpen((v) => !v)}
                  >
                    <span className="text-muted-foreground text-xs">
                      {t('shotTemplate.selectTemplate')}
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>

                  {templateDropdownOpen && (
                    <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
                      {builtInTemplates.length > 0 && (
                        <div>
                          <div className="px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40">
                            {t('shotTemplate.builtIn')}
                          </div>
                          {builtInTemplates.map((tmpl) => (
                            <button
                              key={tmpl.id}
                              className="w-full text-left px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
                              onClick={() => handleApplyTemplate(tmpl)}
                            >
                              <div className="text-xs font-medium">{tmpl.name}</div>
                              <div className="text-[10px] text-muted-foreground truncate">
                                {tmpl.description}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {customTemplates.length > 0 && (
                        <div>
                          <div className="px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider bg-muted/40 border-t border-border/50">
                            {t('shotTemplate.custom')}
                          </div>
                          {customTemplates.map((tmpl) => (
                            <button
                              key={tmpl.id}
                              className="w-full text-left px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
                              onClick={() => handleApplyTemplate(tmpl)}
                            >
                              <div className="text-xs font-medium">{tmpl.name}</div>
                              {tmpl.description && (
                                <div className="text-[10px] text-muted-foreground truncate">
                                  {tmpl.description}
                                </div>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Save template dialog */}
                <Dialog open={saveTemplateDialogOpen} onOpenChange={setSaveTemplateDialogOpen}>
                  <DialogContent className="sm:max-w-[340px]">
                    <DialogHeader>
                      <DialogTitle>{t('shotTemplate.saveCurrent')}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                      <input
                        className="w-full bg-muted px-3 py-2 rounded-lg text-sm outline-none focus:ring-1 focus:ring-ring"
                        value={newTemplateName}
                        onChange={(e) => setNewTemplateName(e.target.value)}
                        placeholder={t('shotTemplate.templateName')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveAsTemplate();
                        }}
                      />
                      <button
                        className="w-full rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        onClick={handleSaveAsTemplate}
                        disabled={!newTemplateName.trim()}
                      >
                        {t('shotTemplate.saveCurrent')}
                      </button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            )}

            {/* Preset Tracks */}
            {hasTracks(selectedNode) && (
              <div className="px-4 py-4 border-b space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {t('inspector.presetTracks')}
                  </div>
                  <label className="flex items-center gap-1.5 text-[10px] text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Object.values(selectedNode.data.presetTracks).every((tr) => tr.aiDecide)}
                      onChange={(e) =>
                        dispatch(
                          setAllTracksAiDecide({
                            id: selectedNode.id,
                            aiDecide: e.target.checked,
                          }),
                        )
                      }
                    />
                    {Object.values(selectedNode.data.presetTracks).every((tr) => tr.aiDecide)
                      ? t('inspector.deselectAll')
                      : t('inspector.selectAll')}
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {categories.map((category) => (
                    <TrackGridCell
                      key={category}
                      nodeId={selectedNode.id}
                      category={category}
                      presets={presets.filter((preset) => preset.category === category)}
                      presetById={presetById}
                      track={
                        selectedNode.data.presetTracks[category] ?? {
                          category,
                          aiDecide: false,
                          entries: [],
                        }
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Audio type */}
            {selectedNode.type === 'audio' && (
              <div className="px-4 py-4 border-b">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1.5">{t('inspector.audioType')}</div>
                <span className="text-sm capitalize">
                  {(selectedNode.data as { audioType?: string }).audioType ?? 'voice'}
                </span>
              </div>
            )}

            {/* Backdrop settings */}
            {selectedNode.type === 'backdrop' && (() => {
              const backdropData = selectedNode.data as BackdropNodeData;
              const COLOR_SWATCHES = [
                '#334155', '#1e3a5f', '#3b1f5e', '#5c1a1a',
                '#1a4d2e', '#4a3728', '#4b5563', '#0f766e',
              ];
              return (
                <>
                  {/* Appearance */}
                  <div className="px-4 py-4 border-b space-y-4">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {t('inspector.backdrop.appearance')}
                    </div>

                    {/* Color */}
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">{t('inspector.backdrop.color')}</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={backdropData.color ?? '#334155'}
                          onChange={(e) => dispatch(setBackdropColor({ id: selectedNode.id, color: e.target.value }))}
                          className="h-7 w-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
                        />
                        <input
                          type="text"
                          value={backdropData.color ?? '#334155'}
                          onChange={(e) => {
                            if (/^#[\da-f]{3,6}$/i.test(e.target.value)) {
                              dispatch(setBackdropColor({ id: selectedNode.id, color: e.target.value }));
                            }
                          }}
                          className="w-20 bg-muted px-2 py-1 rounded text-xs font-mono"
                          placeholder="#334155"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        {COLOR_SWATCHES.map((swatch) => (
                          <button
                            key={swatch}
                            type="button"
                            className={cn(
                              'h-5 w-5 rounded-full border transition-transform hover:scale-110',
                              backdropData.color === swatch ? 'border-primary ring-1 ring-primary' : 'border-border/50',
                            )}
                            style={{ backgroundColor: swatch }}
                            onClick={() => dispatch(setBackdropColor({ id: selectedNode.id, color: swatch }))}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Opacity */}
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">{t('inspector.backdrop.opacity')}</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={5}
                          max={100}
                          step={5}
                          value={Math.round((backdropData.opacity ?? 0.14) * 100)}
                          onChange={(e) =>
                            dispatch(setBackdropOpacity({ id: selectedNode.id, opacity: Number(e.target.value) / 100 }))
                          }
                          className="flex-1 h-1.5 accent-primary"
                        />
                        <span className="text-xs text-muted-foreground w-8 text-right">
                          {Math.round((backdropData.opacity ?? 0.14) * 100)}%
                        </span>
                      </div>
                    </div>

                    {/* Border style */}
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">{t('inspector.backdrop.borderStyle')}</label>
                      <div className="flex items-center gap-1">
                        {(['dashed', 'solid', 'dotted'] as const).map((style) => (
                          <button
                            key={style}
                            className={cn(
                              'flex-1 py-1.5 rounded-md text-xs border font-medium',
                              (backdropData.borderStyle ?? 'dashed') === style
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border hover:bg-muted',
                            )}
                            onClick={() => dispatch(setBackdropBorderStyle({ id: selectedNode.id, borderStyle: style }))}
                          >
                            {t(`inspector.backdrop.${style}`)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Title size */}
                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">{t('inspector.backdrop.titleSize')}</label>
                      <div className="flex items-center gap-1">
                        {(['sm', 'md', 'lg'] as const).map((size) => (
                          <button
                            key={size}
                            className={cn(
                              'flex-1 py-1.5 rounded-md text-xs border font-medium',
                              (backdropData.titleSize ?? 'md') === size
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border hover:bg-muted',
                            )}
                            onClick={() => dispatch(setBackdropTitleSize({ id: selectedNode.id, titleSize: size }))}
                          >
                            {size === 'sm' ? 'S' : size === 'md' ? 'M' : 'L'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Behavior */}
                  <div className="px-4 py-4 border-b space-y-4">
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {t('inspector.backdrop.behavior')}
                    </div>

                    {/* Lock children */}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={backdropData.lockChildren ?? false}
                        onChange={(e) =>
                          dispatch(setBackdropLockChildren({ id: selectedNode.id, lockChildren: e.target.checked }))
                        }
                      />
                      <span className="text-xs">{t('inspector.backdrop.lockChildren')}</span>
                    </label>

                    {/* Auto arrange */}
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted"
                      onClick={() => {
                        if (!canvas) return;
                        const bx = selectedNode.position.x;
                        const by = selectedNode.position.y;
                        const bw = selectedNode.width ?? 420;
                        const bh = selectedNode.height ?? 240;
                        const padding = 20;
                        const headerHeight = 50;
                        const childNodes = canvas.nodes.filter((n) => {
                          if (n.id === selectedNode.id || n.type === 'backdrop') return false;
                          const ow = n.width ?? 200;
                          const oh = n.height ?? 100;
                          const cx = n.position.x + ow / 2;
                          const cy = n.position.y + oh / 2;
                          return cx >= bx && cx <= bx + bw && cy >= by && cy <= by + bh;
                        });
                        if (childNodes.length === 0) return;
                        const cols = Math.ceil(Math.sqrt(childNodes.length));
                        const cellW = (bw - padding * 2) / cols;
                        const cellH = (bh - headerHeight - padding * 2) / Math.ceil(childNodes.length / cols);
                        childNodes.forEach((child, i) => {
                          const col = i % cols;
                          const row = Math.floor(i / cols);
                          dispatch(moveNode({
                            id: child.id,
                            position: {
                              x: bx + padding + col * cellW + (cellW - (child.width ?? 200)) / 2,
                              y: by + headerHeight + padding + row * cellH + (cellH - (child.height ?? 100)) / 2,
                            },
                          }));
                        });
                      }}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      {t('inspector.backdrop.autoArrange')}
                    </button>

                    {/* Collapse info */}
                    <div className="text-[10px] text-muted-foreground/70 italic">
                      Collapse hides child nodes
                    </div>
                  </div>
                </>
              );
            })()}
          </>
        )}

        {/* ===== Context Tab ===== */}
        {inspectorTab === 'context' && (
          <>
            {/* Characters */}
            {(selectedNode.type === 'image' || selectedNode.type === 'video') && (
              <div className="px-4 py-4 border-b space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    {t('inspector.characters')}
                  </label>
                  <button
                    onClick={() => setCharPickerOpen((v) => !v)}
                    className="inline-flex items-center gap-1 text-xs rounded-md border border-border px-2 py-1 hover:bg-muted"
                    disabled={availableCharacters.length === 0}
                  >
                    <Plus className="w-3 h-3" />
                    {t('inspector.addCharacter')}
                  </button>
                </div>
                {charPickerOpen && availableCharacters.length > 0 && (
                  <div className="rounded-lg border border-border/70 bg-card p-2 max-h-32 overflow-auto space-y-1">
                    {availableCharacters.map((ch) => (
                      <button
                        key={ch.id}
                        onClick={() => handleAddCharacterRef(ch.id)}
                        className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted"
                      >
                        {ch.name || t('characterManager.untitled')}
                      </button>
                    ))}
                  </div>
                )}
                {nodeCharacterRefs.length === 0 ? (
                  <div className="text-xs text-muted-foreground">{t('inspector.noCharacters')}</div>
                ) : (
                  <div className="space-y-1.5">
                    {nodeCharacterRefs.map((ref) => {
                      const ch = characterById[ref.characterId];
                      const slotOptions = (ch?.referenceImages ?? [])
                        .filter((r: ReferenceImage) => r.assetHash)
                        .map((r: ReferenceImage) => r.slot);
                      return (
                        <div
                          key={ref.characterId}
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-3 py-2"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <span className="text-sm truncate block">{ch?.name ?? ref.characterId.slice(0, 8)}</span>
                            {slotOptions.length > 0 && (
                              <select
                                value={ref.angleSlot ?? ''}
                                onChange={(e) => handleCharacterAngleChange(ref.characterId, e.target.value || undefined)}
                                className="w-full text-[11px] rounded border border-border bg-background px-1.5 py-0.5 outline-none"
                              >
                                <option value="">{t('inspector.autoAngle')}</option>
                                {slotOptions.map((slot: string) => (
                                  <option key={slot} value={slot}>{localizeSlot(slot)}</option>
                                ))}
                              </select>
                            )}
                          </div>
                          <button
                            onClick={() => handleRemoveCharacterRef(ref.characterId)}
                            className="p-1 rounded border border-border hover:bg-destructive/20 shrink-0 ml-2"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Equipment */}
            {(selectedNode.type === 'image' || selectedNode.type === 'video') && (
              <div className="px-4 py-4 border-b space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5" />
                    {t('inspector.equipment')}
                  </label>
                  <button
                    onClick={() => setEquipPickerOpen((v) => !v)}
                    className="inline-flex items-center gap-1 text-xs rounded-md border border-border px-2 py-1 hover:bg-muted"
                    disabled={availableEquipment.length === 0}
                  >
                    <Plus className="w-3 h-3" />
                    {t('inspector.addEquipment')}
                  </button>
                </div>
                {equipPickerOpen && availableEquipment.length > 0 && (
                  <div className="rounded-lg border border-border/70 bg-card p-2 max-h-32 overflow-auto space-y-1">
                    {availableEquipment.map((eq) => (
                      <button
                        key={eq.id}
                        onClick={() => handleAddEquipmentRef(eq.id)}
                        className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted"
                      >
                        <div className="font-medium">{eq.name || t('equipmentManager.untitled')}</div>
                        <div className="text-muted-foreground capitalize">{eq.type}</div>
                      </button>
                    ))}
                  </div>
                )}
                {nodeEquipmentRefs.length === 0 ? (
                  <div className="text-xs text-muted-foreground">{t('inspector.noEquipment')}</div>
                ) : (
                  <div className="space-y-1.5">
                    {nodeEquipmentRefs.map((ref) => {
                      const eq = equipmentById[ref.equipmentId];
                      const slotOptions = (eq?.referenceImages ?? [])
                        .filter((r: ReferenceImage) => r.assetHash)
                        .map((r: ReferenceImage) => r.slot);
                      return (
                        <div
                          key={ref.equipmentId}
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-3 py-2"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <span className="text-sm truncate block">{eq?.name ?? ref.equipmentId.slice(0, 8)}</span>
                            {slotOptions.length > 0 && (
                              <select
                                value={ref.angleSlot ?? ''}
                                onChange={(e) => handleEquipmentAngleChange(ref.equipmentId, e.target.value || undefined)}
                                className="w-full text-[11px] rounded border border-border bg-background px-1.5 py-0.5 outline-none"
                              >
                                <option value="">{t('inspector.autoAngle')}</option>
                                {slotOptions.map((slot: string) => (
                                  <option key={slot} value={slot}>{localizeSlot(slot)}</option>
                                ))}
                              </select>
                            )}
                          </div>
                          <button
                            onClick={() => handleRemoveEquipmentRef(ref.equipmentId)}
                            className="p-1 rounded border border-border hover:bg-destructive/20 shrink-0 ml-2"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Locations */}
            {(selectedNode.type === 'image' || selectedNode.type === 'video') && (
              <div className="px-4 py-4 border-b space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    {t('inspector.locations')}
                  </label>
                  <button
                    onClick={() => setLocPickerOpen((v) => !v)}
                    className="inline-flex items-center gap-1 text-xs rounded-md border border-border px-2 py-1 hover:bg-muted"
                    disabled={availableLocations.length === 0}
                  >
                    <Plus className="w-3 h-3" />
                    {t('inspector.addLocation')}
                  </button>
                </div>
                {locPickerOpen && availableLocations.length > 0 && (
                  <div className="rounded-lg border border-border/70 bg-card p-2 max-h-32 overflow-auto space-y-1">
                    {availableLocations.map((loc) => (
                      <button
                        key={loc.id}
                        onClick={() => handleAddLocationRef(loc.id)}
                        className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted"
                      >
                        <div className="font-medium">{loc.name || t('locationManager.title')}</div>
                        <div className="text-muted-foreground">{loc.type.toUpperCase()}</div>
                      </button>
                    ))}
                  </div>
                )}
                {nodeLocationRefs.length === 0 ? (
                  <div className="text-xs text-muted-foreground">{t('inspector.noLocations')}</div>
                ) : (
                  <div className="space-y-1.5">
                    {nodeLocationRefs.map((ref) => {
                      const loc = locationById[ref.locationId];
                      const typeBadge = loc?.type
                        ? loc.type === 'int-ext'
                          ? 'INT-EXT'
                          : loc.type.toUpperCase()
                        : '';
                      return (
                        <div
                          key={ref.locationId}
                          className="flex items-center justify-between rounded-lg border border-border/60 bg-card px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="text-sm truncate block">
                              {loc?.name ?? ref.locationId.slice(0, 8)}
                            </span>
                            {typeBadge && (
                              <span className="text-[10px] text-muted-foreground">{typeBadge}</span>
                            )}
                          </div>
                          <button
                            onClick={() => handleRemoveLocationRef(ref.locationId)}
                            className="p-1 rounded border border-border hover:bg-destructive/20 shrink-0 ml-2"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ===== Technical Tab ===== */}
        {inspectorTab === 'technical' && (
          <>
            {/* First / Last Frame -- video nodes only */}
            {selectedNode.type === 'video' && (() => {
              const videoData = selectedNode.data as VideoNodeData;
              const firstCandidates = (canvas?.edges ?? [])
                .filter((e) => e.target === selectedNode.id)
                .map((e) => canvas?.nodes.find((n) => n.id === e.source))
                .filter((n): n is CanvasNode & { data: ImageNodeData } => n?.type === 'image');
              const lastCandidates = (canvas?.edges ?? [])
                .filter((e) => e.source === selectedNode.id)
                .map((e) => canvas?.nodes.find((n) => n.id === e.target))
                .filter((n): n is CanvasNode & { data: ImageNodeData } => n?.type === 'image');

              const selectedFirst = firstCandidates.find((n) => n.id === videoData.firstFrameNodeId);
              const selectedLast = lastCandidates.find((n) => n.id === videoData.lastFrameNodeId);

              return (
                <div className="px-4 py-4 border-b space-y-4">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('inspector.frames')}</div>
                  {/* First Frame */}
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">{t('inspector.firstFrame')}</div>
                    {firstCandidates.length === 0 ? (
                      <div className="text-xs text-muted-foreground italic">{t('inspector.noConnectedImages')}</div>
                    ) : (
                      <div className="flex items-center gap-3">
                        {selectedFirst && <FrameThumb node={selectedFirst} />}
                        {firstCandidates.length > 1 && (
                          <select
                            value={videoData.firstFrameNodeId ?? ''}
                            onChange={(e) => dispatch(setVideoFrameNode({ id: selectedNode.id, role: 'first', frameNodeId: e.target.value || undefined }))}
                            className="flex-1 text-xs rounded border border-border bg-background px-2 py-1 outline-none"
                          >
                            <option value="">{t('inspector.select')}</option>
                            {firstCandidates.map((n) => (
                              <option key={n.id} value={n.id}>{n.title || n.id.slice(0, 8)}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                  {/* Last Frame */}
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">{t('inspector.lastFrame')}</div>
                    {lastCandidates.length === 0 ? (
                      <div className="text-xs text-muted-foreground italic">{t('inspector.noConnectedImages')}</div>
                    ) : (
                      <div className="flex items-center gap-3">
                        {selectedLast && <FrameThumb node={selectedLast} />}
                        {lastCandidates.length > 1 && (
                          <select
                            value={videoData.lastFrameNodeId ?? ''}
                            onChange={(e) => dispatch(setVideoFrameNode({ id: selectedNode.id, role: 'last', frameNodeId: e.target.value || undefined }))}
                            className="flex-1 text-xs rounded border border-border bg-background px-2 py-1 outline-none"
                          >
                            <option value="">{t('inspector.select')}</option>
                            {lastCandidates.map((n) => (
                              <option key={n.id} value={n.id}>{n.title || n.id.slice(0, 8)}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Upload */}
            {(selectedNode.type === 'image' || selectedNode.type === 'video') && (
              <div className="px-4 py-4 border-b space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {t('inspector.media')}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted"
                    onClick={async () => {
                      const api = getAPI();
                      if (!api) return;
                      const ref = await api.asset.pickFile(selectedNode.type) as { hash: string } | null;
                      if (!ref) return;
                      dispatch(setNodeUploadedAsset({ id: selectedNode.id, assetHash: ref.hash }));
                    }}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {generationData?.assetHash ? t('inspector.replace') : t('inspector.upload')}
                  </button>
                  {generationData?.assetHash && (
                    <button
                      type="button"
                      className="flex items-center gap-1.5 rounded-lg border border-destructive/50 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                      onClick={() => dispatch(clearNodeAsset({ id: selectedNode.id }))}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t('inspector.clear')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Generation */}
            {isGenerationNode(selectedNode) && (
              <div className="px-4 py-4 border-b space-y-4">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{t('inspector.generationLabel')}</div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">{t('generation.provider')}</label>
                  <select
                    value={activeProviderId ?? ''}
                    onChange={(event) => handleProviderChange(event.target.value)}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    className="w-full bg-muted px-3 py-2 rounded-lg text-sm"
                    disabled={providerLoading}
                  >
                    {activeProviderId ? null : <option value="">{t('inspector.selectProvider')}</option>}
                    {configuredProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">{t('generation.variantCount')}</label>
                  <div className="flex items-center gap-1.5">
                    {VARIANT_OPTIONS.map((count) => (
                      <button
                        key={count}
                        className={cn(
                          'flex-1 py-1.5 rounded-md text-xs border font-medium',
                          activeVariantCount === count
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border hover:bg-muted',
                        )}
                        onClick={() => handleVariantCountChange(count)}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">{t('generation.seed')}</label>
                  <div className="flex items-center gap-1.5">
                    <button
                      className="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted"
                      onClick={() => handleSeedChange((activeSeed ?? 0) - 1)}
                    >
                      -1
                    </button>
                    <input
                      type="number"
                      className="flex-1 bg-muted px-3 py-1.5 rounded-md text-sm"
                      value={activeSeed ?? 0}
                      onChange={(event) => handleSeedChange(Number(event.target.value))}
                    />
                    <button
                      className="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-muted"
                      onClick={() => handleSeedChange((activeSeed ?? 0) + 1)}
                    >
                      +1
                    </button>
                    <button
                      className={cn(
                        'px-3 py-1.5 rounded-md border text-xs font-medium',
                        activeSeedLocked
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border hover:bg-muted',
                      )}
                      onClick={handleToggleSeedLock}
                    >
                      {activeSeedLocked ? t('inspector.locked') : t('inspector.lock')}
                    </button>
                  </div>
                </div>

                {typeof generationData?.estimatedCost === 'number' && (
                  <div className="text-sm text-muted-foreground">
                    {t('inspector.estimated')}: ${generationData.estimatedCost.toFixed(2)}
                  </div>
                )}

                {activeVariants.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs text-muted-foreground">{t('generation.variants')}</label>
                    <div className="grid grid-cols-4 gap-1.5">
                      {activeVariants.slice(0, 9).map((hash: string, index: number) => (
                        <button
                          key={hash}
                          className={cn(
                            'h-10 rounded-md border text-xs font-medium truncate px-1',
                            selectedVariantIndex === index
                              ? 'border-primary text-primary bg-primary/10'
                              : 'border-border text-muted-foreground hover:bg-muted',
                          )}
                          onClick={() => handleSelectVariant(index)}
                        >
                          V{index + 1}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
                    onClick={() => void handleGenerate()}
                    disabled={generationData?.status === 'generating'}
                  >
                    {activeVariants.length > 0 ? t('generation.regenerate') : t('generation.generate')}
                  </button>
                  <button
                    className="px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted disabled:opacity-50"
                    onClick={() => void handleCancelGeneration()}
                    disabled={generationData?.status !== 'generating'}
                  >
                    {t('generation.cancel')}
                  </button>
                </div>
              </div>
            )}

            {/* Metadata */}
            <div className="px-4 py-4">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{t('inspector.metadata')}</div>
              <div className="text-xs text-muted-foreground space-y-1">
                <div>{t('inspector.id')}: {selectedNode.id.slice(0, 8)}...</div>
                <div>{t('inspector.created')}: {new Date(selectedNode.createdAt).toLocaleString()}</div>
                <div>{t('inspector.updated')}: {new Date(selectedNode.updatedAt).toLocaleString()}</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
