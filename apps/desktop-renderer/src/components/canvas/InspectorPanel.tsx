import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { selectActiveCanvas, selectSingleSelectedNode, selectNodesById } from '../../store/slices/canvas-selectors.js';
import { useInspectorEntityRefs } from './useInspectorEntityRefs.js';
import {
  renameNode,
  updateNodeData,
  // M7: Annotation
  setNodeAnnotation,
  // M9: Tags & grouping
  addNodeTag,
  removeNodeTag,
  // L17: Advanced params
  setNodeAdvancedParams,
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
import { selectPresetList } from '../../store/slices/presets.js';
import { InspectorCreativeTab } from './InspectorCreativeTab.js';
import { InspectorContextTab } from './InspectorContextTab.js';
import { InspectorFrameThumb } from './InspectorFrameThumb.js';
import { InspectorPanelEmptyState } from './InspectorPanelEmptyState.js';
import { InspectorPanelHeader } from './InspectorPanelHeader.js';
import { InspectorPanelTabBar, type InspectorPanelTab } from './InspectorPanelTabBar.js';
import { InspectorPanelIdentitySection } from './InspectorPanelIdentitySection.js';
import { InspectorTrackGridCell } from './InspectorTrackGridCell.js';
import { LazyDetails } from './LazyDetails.js';
import { InspectorGenerationState, type GenerationRenderProps } from './InspectorGenerationState.js';
import { CommitSlider } from '../ui/CommitSlider.js';
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

export function InspectorPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const canvas = useSelector(selectActiveCanvas);
  const nodesById = useSelector(selectNodesById);
  const presets = useSelector(selectPresetList);
  const hiddenPresetIds = useSelector((s: RootState) => s.presets.hiddenIds);
  const builtInTemplates = useSelector((s: RootState) => s.shotTemplates.builtIn);
  const customTemplates = useSelector((s: RootState) => s.shotTemplates.custom);
  const hiddenTemplateIds = useSelector((s: RootState) => s.shotTemplates.hiddenIds);
  const characters = useSelector((s: RootState) => s.characters.items);
  const equipmentItems = useSelector((s: RootState) => s.equipment.items);
  const locationItems = useSelector((s: RootState) => s.locations.items);

  useEffect(() => {
    const api = getAPI();
    if (!api) return;
    if (characters.length === 0) {
      void api.character
        .list()
        .then((list) => {
          if (Array.isArray(list))
            dispatch(setCharacters(list as import('@lucid-fin/contracts').Character[]));
        })
        .catch(() => {
          /* entity list fetch is best-effort */
        });
    }
    if (equipmentItems.length === 0) {
      void api.equipment
        .list()
        .then((list) => {
          if (Array.isArray(list))
            dispatch(setEquipment(list as import('@lucid-fin/contracts').Equipment[]));
        })
        .catch(() => {
          /* entity list fetch is best-effort */
        });
    }
    if (locationItems.length === 0) {
      void api.location
        .list()
        .then((list) => {
          if (Array.isArray(list))
            dispatch(setLocations(list as import('@lucid-fin/contracts').Location[]));
        })
        .catch(() => {
          /* entity list fetch is best-effort */
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

  const [inspectorTab, setInspectorTab] = useState<InspectorPanelTab>('creative');
  const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false);

  const selectedNode = useSelector(selectSingleSelectedNode);

  const generationData: ImageNodeData | VideoNodeData | AudioNodeData | undefined =
    isGenerationNode(selectedNode) ? selectedNode.data : undefined;

  // Entity refs — delegated to extracted hook
  const entityRefs = useInspectorEntityRefs({
    selectedNode,
    characters,
    equipmentItems,
    locationItems,
  });
  const {
    nodeCharacterRefs,
    nodeEquipmentRefs,
    nodeLocationRefs,
    availableCharacters,
    availableEquipment,
    availableLocations,
    characterById,
    equipmentById,
    locationById,
    contextBadgeCount,
    charPickerOpen,
    setCharPickerOpen,
    equipPickerOpen,
    setEquipPickerOpen,
    locPickerOpen,
    setLocPickerOpen,
    handleAddCharacterRef,
    handleRemoveCharacterRef,
    handleCharacterAngleChange,
    handleAddEquipmentRef,
    handleRemoveEquipmentRef,
    handleEquipmentAngleChange,
    handleAddLocationRef,
    handleRemoveLocationRef,
  } = entityRefs;

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
              entries: [],
            }
          }
        />
      ))
    : null;
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
  }));
  const locationContextItems = nodeLocationRefs.map((ref) => {
    const location = locationById[ref.locationId];
    return {
      id: ref.locationId,
      label: location?.name ?? ref.locationId.slice(0, 8),
    };
  });
  const videoFramesSection =
    selectedNode.type === 'video'
      ? (() => {
          const videoData = selectedNode.data as VideoNodeData;
          const seenFirst = new Set<string>();
          const firstCandidates = (canvas?.edges ?? [])
            .filter((edge) => edge.target === selectedNode.id)
            .map((edge) => nodesById.get(edge.source))
            .filter((node): node is CanvasNode & { data: ImageNodeData } => {
              if (!node || node.type !== 'image' || seenFirst.has(node.id)) return false;
              seenFirst.add(node.id);
              return true;
            });
          const seenLast = new Set<string>();
          const lastCandidates = (canvas?.edges ?? [])
            .filter((edge) => edge.source === selectedNode.id)
            .map((edge) => nodesById.get(edge.target))
            .filter((node): node is CanvasNode & { data: ImageNodeData } => {
              if (!node || node.type !== 'image' || seenLast.has(node.id)) return false;
              seenLast.add(node.id);
              return true;
            });
          const selectedFirst = firstCandidates.find(
            (node) => node.id === videoData.firstFrameNodeId,
          );
          const selectedLast = lastCandidates.find((node) => node.id === videoData.lastFrameNodeId);
          const firstFrameHash = videoData.firstFrameAssetHash ?? selectedFirst?.data.assetHash;
          const lastFrameHash = videoData.lastFrameAssetHash ?? selectedLast?.data.assetHash;

          // Determine selected value for the unified dropdown
          const firstSelectedValue = videoData.firstFrameAssetHash
            ? `asset:${videoData.firstFrameAssetHash}`
            : (videoData.firstFrameNodeId ?? undefined);
          const lastSelectedValue = videoData.lastFrameAssetHash
            ? `asset:${videoData.lastFrameAssetHash}`
            : (videoData.lastFrameNodeId ?? undefined);

          return (gen: GenerationRenderProps) => ({
            first: {
              connectedOptions: firstCandidates.map((node) => ({
                value: node.id,
                label: node.title || node.id.slice(0, 8),
              })),
              assetOption: videoData.firstFrameAssetHash
                ? {
                    value: `asset:${videoData.firstFrameAssetHash}`,
                    label: t('inspector.uploadedImage'),
                  }
                : undefined,
              selectedValue: firstSelectedValue,
              preview: firstFrameHash ? (
                <InspectorFrameThumb
                  assetHash={firstFrameHash}
                  title={selectedFirst?.title ?? t('inspector.firstFrame')}
                />
              ) : undefined,
              hasValue: Boolean(firstFrameHash),
              onSelect: (value: string | undefined) => gen.handleFrameSelect('first', value),
              onUpload: () => gen.handleUploadVideoFrame('first'),
              onDropAsset: (hash: string) => gen.handleFrameDropAsset('first', hash),
              onDropFile: (file: File) => gen.handleDropFileVideoFrame('first', file),
              onClear: () => gen.handleClearVideoFrame('first'),
            },
            last: {
              connectedOptions: lastCandidates.map((node) => ({
                value: node.id,
                label: node.title || node.id.slice(0, 8),
              })),
              assetOption: videoData.lastFrameAssetHash
                ? {
                    value: `asset:${videoData.lastFrameAssetHash}`,
                    label: t('inspector.uploadedImage'),
                  }
                : undefined,
              selectedValue: lastSelectedValue,
              preview: lastFrameHash ? (
                <InspectorFrameThumb
                  assetHash={lastFrameHash}
                  title={selectedLast?.title ?? t('inspector.lastFrame')}
                />
              ) : undefined,
              hasValue: Boolean(lastFrameHash),
              onSelect: (value: string | undefined) => gen.handleFrameSelect('last', value),
              onUpload: () => gen.handleUploadVideoFrame('last'),
              onDropAsset: (hash: string) => gen.handleFrameDropAsset('last', hash),
              onDropFile: (file: File) => gen.handleDropFileVideoFrame('last', file),
              onClear: () => gen.handleClearVideoFrame('last'),
            },
          });
        })()
      : undefined;

  const renderContent = (gen?: GenerationRenderProps) => (
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
            suggestedTemplates={
              isGenerationNode(selectedNode) && !generationData?.prompt
                ? [...builtInTemplates, ...customTemplates]
                    .filter((tpl) => !hiddenTemplateIds.includes(tpl.id))
                    .slice(0, 6)
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
            videoFramesSection={gen && videoFramesSection ? videoFramesSection(gen) : undefined}
          />
        )}

        {/* ===== Annotation Section (M7) ===== */}
        {isGenerationNode(selectedNode) && (
          <div className="px-3 py-2 border-b border-border/60">
            <LazyDetails className="group"
              summary={
                <summary className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider select-none">
                  <span className="transition-transform group-open:rotate-90">&#9654;</span>
                  {t('inspector.annotation')}
                </summary>
              }
            >
              <div className="mt-1.5 space-y-1">
                <input
                  type="text"
                  className="w-full rounded-md border border-border/60 bg-muted px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring"
                  placeholder={t('inspector.annotationPlaceholder')}
                  value={
                    (generationData as { annotation?: { text?: string } })?.annotation?.text ?? ''
                  }
                  onChange={(e) => {
                    const text = e.target.value;
                    dispatch(
                      setNodeAnnotation({
                        id: selectedNode.id,
                        annotation: text ? { text, position: 'bottom' } : undefined,
                      }),
                    );
                  }}
                />
              </div>
            </LazyDetails>
          </div>
        )}

        {/* ===== Tags & Group Section (M9) ===== */}
        <div className="px-3 py-2 border-b border-border/60">
          <LazyDetails className="group"
            summary={
              <summary className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider select-none">
                <span className="transition-transform group-open:rotate-90">&#9654;</span>
                {t('inspector.tagsAndGroups')}
              </summary>
            }
          >
            <div className="mt-1.5 space-y-1.5">
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  className="flex-1 rounded-md border border-border/60 bg-muted px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring"
                  placeholder={t('inspector.addTagPlaceholder')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value.trim();
                      if (val) {
                        dispatch(addNodeTag({ id: selectedNode.id, tag: val }));
                        (e.target as HTMLInputElement).value = '';
                      }
                    }
                  }}
                />
              </div>
              {(selectedNode.tags ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {(selectedNode.tags ?? []).map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {tag}
                      <button
                        type="button"
                        className="ml-0.5 text-muted-foreground/50 hover:text-destructive"
                        onClick={() => dispatch(removeNodeTag({ id: selectedNode.id, tag }))}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </LazyDetails>
        </div>

        {/* ===== Advanced Generation Params (L17) ===== */}
        {isGenerationNode(selectedNode) && selectedNode.type !== 'audio' && (
          <div className="px-3 py-2 border-b border-border/60">
            <LazyDetails className="group"
              summary={
                <summary className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider select-none">
                  <span className="transition-transform group-open:rotate-90">&#9654;</span>
                  {t('inspector.advancedParams')}
                </summary>
              }
            >
              <div className="mt-1.5 space-y-1.5">
                <div>
                  <label className="text-[10px] text-muted-foreground">
                    {t('inspector.negativePrompt')}
                  </label>
                  <textarea
                    className="w-full rounded-md border border-border/60 bg-muted px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring min-h-[40px] resize-y"
                    placeholder={t('inspector.negativePromptPlaceholder')}
                    value={(generationData as { negativePrompt?: string })?.negativePrompt ?? ''}
                    onChange={(e) =>
                      dispatch(
                        setNodeAdvancedParams({
                          id: selectedNode.id,
                          negativePrompt: e.target.value,
                        }),
                      )
                    }
                  />
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div>
                    <label className="text-[10px] text-muted-foreground">
                      {t('inspector.steps')}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={150}
                      className="w-full rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] outline-none"
                      value={(generationData as { steps?: number })?.steps ?? ''}
                      onChange={(e) =>
                        dispatch(
                          setNodeAdvancedParams({
                            id: selectedNode.id,
                            steps: e.target.value ? Number(e.target.value) : undefined,
                          }),
                        )
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">
                      {t('inspector.cfgScale')}
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={30}
                      step={0.5}
                      className="w-full rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] outline-none"
                      value={(generationData as { cfgScale?: number })?.cfgScale ?? ''}
                      onChange={(e) =>
                        dispatch(
                          setNodeAdvancedParams({
                            id: selectedNode.id,
                            cfgScale: e.target.value ? Number(e.target.value) : undefined,
                          }),
                        )
                      }
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground">
                      {t('inspector.scheduler')}
                    </label>
                    <input
                      type="text"
                      className="w-full rounded-md border border-border/60 bg-muted px-1.5 py-0.5 text-[10px] outline-none"
                      placeholder="euler_a"
                      value={(generationData as { scheduler?: string })?.scheduler ?? ''}
                      onChange={(e) =>
                        dispatch(
                          setNodeAdvancedParams({
                            id: selectedNode.id,
                            scheduler: e.target.value || undefined,
                          }),
                        )
                      }
                    />
                  </div>
                </div>
                {/* Image-to-image strength */}
                {(generationData as { sourceImageHash?: string })?.sourceImageHash && (
                  <div>
                    <label className="text-[10px] text-muted-foreground">
                      {t('inspector.img2imgStrength')}
                    </label>
                    <div className="flex items-center gap-2">
                      <CommitSlider
                        min={0}
                        max={100}
                        value={Math.round(
                          ((generationData as { img2imgStrength?: number })?.img2imgStrength ??
                            0.75) * 100,
                        )}
                        onCommit={(v) =>
                          dispatch(
                            setNodeAdvancedParams({
                              id: selectedNode.id,
                              img2imgStrength: v / 100,
                            }),
                          )
                        }
                        className="flex-1 h-1.5 accent-primary"
                      />
                      <span className="text-[10px] text-muted-foreground w-8 text-right">
                        {Math.round(
                          ((generationData as { img2imgStrength?: number })?.img2imgStrength ??
                            0.75) * 100,
                        )}
                        %
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </LazyDetails>
          </div>
        )}

        {/* ===== Generation History (M10) ===== */}
        {isGenerationNode(selectedNode) &&
        (generationData as { generationHistory?: unknown[] })?.generationHistory?.length ? (
          <div className="px-3 py-2 border-b border-border/60">
            <LazyDetails className="group"
              summary={
                <summary className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider select-none">
                  <span className="transition-transform group-open:rotate-90">&#9654;</span>
                  {t('inspector.generationHistory')} (
                  {
                    ((generationData as { generationHistory?: unknown[] })?.generationHistory ?? [])
                      .length
                  }
                  )
                </summary>
              }
            >
              <div className="mt-1.5 max-h-[160px] overflow-auto space-y-1">
                {(
                  (
                    generationData as {
                      generationHistory?: Array<{
                        assetHash: string;
                        prompt: string;
                        providerId: string;
                        seed?: number;
                        cost?: number;
                        createdAt: number;
                      }>;
                    }
                  )?.generationHistory ?? []
                )
                  .slice()
                  .reverse()
                  .slice(0, 20)
                  .map((entry, i) => (
                    <div
                      key={`${entry.assetHash}-${i}`}
                      className="rounded-md border border-border/40 bg-muted/20 px-2 py-1 text-[10px]"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-foreground truncate">
                          {entry.providerId}
                        </span>
                        <span className="text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <div className="text-muted-foreground truncate">
                        {entry.prompt.slice(0, 80)}
                        {entry.prompt.length > 80 ? '...' : ''}
                      </div>
                      {entry.cost != null && (
                        <span className="text-muted-foreground">${entry.cost.toFixed(3)}</span>
                      )}
                    </div>
                  ))}
              </div>
            </LazyDetails>
          </div>
        ) : null}
      </div>

      {/* Generation bar — always visible at bottom for generation nodes */}
      {gen?.generationBar}
    </div>
  );

  if (isGenerationNode(selectedNode)) {
    return (
      <InspectorGenerationState
        selectedNode={selectedNode}
        t={t}
      >
        {(gen) => renderContent(gen)}
      </InspectorGenerationState>
    );
  }

  return renderContent();
}
