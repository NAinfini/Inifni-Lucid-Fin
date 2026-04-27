import { memo, type DragEvent, type ReactNode, useCallback, useEffect, useState } from 'react';
import { MapPin, Package, Plus, Search, Trash2, Upload, User, type LucideIcon } from 'lucide-react';
import type { NodeKind } from '@lucid-fin/contracts';
import { useAssetUrl } from '../../hooks/useAssetUrl.js';

type Translate = (key: string) => string;

interface PickerOption {
  id: string;
  label: string;
  description?: string;
}

interface SlotOption {
  value: string;
  label: string;
}

interface ReferenceItem {
  id: string;
  label: string;
  description?: string;
  thumbnailAssetHash?: string;
  selectedSlot?: string;
  slotOptions?: SlotOption[];
}

interface SelectOption {
  value: string;
  label: string;
}

interface VideoFrameSlot {
  /** Connected image node options */
  connectedOptions: SelectOption[];
  /** The uploaded / asset-store image entry shown in the dropdown (at most one) */
  assetOption?: SelectOption;
  /** Currently active value: a node id OR special 'asset:<hash>' */
  selectedValue?: string;
  preview?: ReactNode;
  hasValue: boolean;
  /** Select from unified dropdown (node id or 'asset:<hash>') */
  onSelect: (value: string | undefined) => void;
  /** Click preview / upload icon → open file dialog */
  onUpload: () => void | Promise<void>;
  /** Drag-drop an image (from file explorer or asset store) */
  onDropAsset: (assetHash: string) => void;
  /** Drag-drop a File from OS explorer — import via buffer */
  onDropFile: (file: File) => void | Promise<void>;
  onClear: () => void;
}

interface VideoFramesSection {
  first: VideoFrameSlot;
  last: VideoFrameSlot;
}

interface InspectorContextTabProps {
  t: Translate;
  selectedNodeType: NodeKind;
  charPickerOpen: boolean;
  equipPickerOpen: boolean;
  locPickerOpen: boolean;
  allCharacters: PickerOption[];
  allEquipment: PickerOption[];
  allLocations: PickerOption[];
  addedCharacterIds: ReadonlySet<string>;
  addedEquipmentIds: ReadonlySet<string>;
  addedLocationIds: ReadonlySet<string>;
  characterItems: ReferenceItem[];
  equipmentItems: ReferenceItem[];
  locationItems: ReferenceItem[];
  onToggleCharPicker: () => void;
  onToggleEquipPicker: () => void;
  onToggleLocPicker: () => void;
  onAddCharacter: (characterId: string) => void;
  onAddEquipment: (equipmentId: string) => void;
  onAddLocation: (locationId: string) => void;
  onCharacterSlotChange: (characterId: string, angleSlot: string | undefined) => void;
  onEquipmentSlotChange: (equipmentId: string, angleSlot: string | undefined) => void;
  onRemoveCharacter: (characterId: string) => void;
  onRemoveEquipment: (equipmentId: string) => void;
  onRemoveLocation: (locationId: string) => void;
  videoFramesSection?: VideoFramesSection;
}

export const InspectorContextTab = memo(function InspectorContextTab({
  t,
  selectedNodeType,
  charPickerOpen,
  equipPickerOpen,
  locPickerOpen,
  allCharacters,
  allEquipment,
  allLocations,
  addedCharacterIds,
  addedEquipmentIds,
  addedLocationIds,
  characterItems,
  equipmentItems,
  locationItems,
  onToggleCharPicker,
  onToggleEquipPicker,
  onToggleLocPicker,
  onAddCharacter,
  onAddEquipment,
  onAddLocation,
  onCharacterSlotChange: _onCharacterSlotChange,
  onEquipmentSlotChange: _onEquipmentSlotChange,
  onRemoveCharacter,
  onRemoveEquipment,
  onRemoveLocation,
  videoFramesSection,
}: InspectorContextTabProps) {
  const showsVisualContext = selectedNodeType === 'image' || selectedNodeType === 'video';
  const [charSearch, setCharSearch] = useState('');
  const [equipSearch, setEquipSearch] = useState('');
  const [locSearch, setLocSearch] = useState('');

  const filteredCharacters = charSearch
    ? allCharacters.filter((c) => c.label.toLowerCase().includes(charSearch.toLowerCase()))
    : allCharacters;
  const filteredEquipment = equipSearch
    ? allEquipment.filter((e) => e.label.toLowerCase().includes(equipSearch.toLowerCase()))
    : allEquipment;
  const filteredLocations = locSearch
    ? allLocations.filter((l) => l.label.toLowerCase().includes(locSearch.toLowerCase()))
    : allLocations;

  if (!showsVisualContext) {
    return null;
  }

  return (
    <>
      {/* Video first/last frame references */}
      {selectedNodeType === 'video' && videoFramesSection ? (
        <div className="px-3 py-3 border-b border-border/60 space-y-2.5">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {t('inspector.frames')}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <VideoFrameSlotSection
              label={t('inspector.firstFrame')}
              slot={videoFramesSection.first}
              t={t}
            />
            <VideoFrameSlotSection
              label={t('inspector.lastFrame')}
              slot={videoFramesSection.last}
              t={t}
            />
          </div>
        </div>
      ) : null}
      <div className="px-3 py-3 border-b border-border/60 space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <User className="w-3 h-3" />
            {t('inspector.characters')}
          </label>
          <button
            onClick={onToggleCharPicker}
            className="inline-flex items-center gap-1 text-[11px] rounded-md border border-border/60 px-1.5 py-0.5 hover:bg-muted"
            disabled={allCharacters.length === 0}
          >
            <Plus className="w-3 h-3" />
            {t('inspector.addCharacter')}
          </button>
        </div>
        {charPickerOpen && allCharacters.length > 0 ? (
          <div className="rounded-md border border-border/60 bg-card p-1.5 max-h-36 overflow-auto space-y-0.5">
            <div className="flex items-center gap-1 rounded-md border border-border/40 bg-muted/30 px-1.5 py-0.5 mb-1">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={charSearch}
                onChange={(e) => setCharSearch(e.target.value)}
                placeholder={t('inspector.searchEntity')}
                className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/50"
                autoFocus
              />
            </div>
            {filteredCharacters.map((character) => {
              const added = addedCharacterIds.has(character.id);
              return (
                <button
                  key={character.id}
                  onClick={() => !added && onAddCharacter(character.id)}
                  disabled={added}
                  className={`w-full text-left text-[11px] px-2 py-1 rounded-md ${added ? 'text-muted-foreground/50 cursor-default' : 'hover:bg-muted'}`}
                >
                  {character.label}
                  {added && <span className="ml-1 text-[10px]">✓</span>}
                </button>
              );
            })}
          </div>
        ) : null}
        {characterItems.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">{t('inspector.noCharacters')}</div>
        ) : (
          <ReferenceItemList
            items={characterItems}
            icon={User}
            onRemove={onRemoveCharacter}
          />
        )}
      </div>

      <div className="px-3 py-3 border-b border-border/60 space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <Package className="w-3 h-3" />
            {t('inspector.equipment')}
          </label>
          <button
            onClick={onToggleEquipPicker}
            className="inline-flex items-center gap-1 text-[11px] rounded-md border border-border/60 px-1.5 py-0.5 hover:bg-muted"
            disabled={allEquipment.length === 0}
          >
            <Plus className="w-3 h-3" />
            {t('inspector.addEquipment')}
          </button>
        </div>
        {equipPickerOpen && allEquipment.length > 0 ? (
          <div className="rounded-md border border-border/60 bg-card p-1.5 max-h-36 overflow-auto space-y-0.5">
            <div className="flex items-center gap-1 rounded-md border border-border/40 bg-muted/30 px-1.5 py-0.5 mb-1">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={equipSearch}
                onChange={(e) => setEquipSearch(e.target.value)}
                placeholder={t('inspector.searchEntity')}
                className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/50"
                autoFocus
              />
            </div>
            {filteredEquipment.map((equipment) => {
              const added = addedEquipmentIds.has(equipment.id);
              return (
                <button
                  key={equipment.id}
                  onClick={() => !added && onAddEquipment(equipment.id)}
                  disabled={added}
                  className={`w-full text-left text-[11px] px-2 py-1 rounded-md ${added ? 'text-muted-foreground/50 cursor-default' : 'hover:bg-muted'}`}
                >
                  <div className="font-medium">
                    {equipment.label}
                    {added && <span className="ml-1 text-[10px]">✓</span>}
                  </div>
                  {equipment.description ? <div className="text-muted-foreground capitalize">{equipment.description}</div> : null}
                </button>
              );
            })}
          </div>
        ) : null}
        {equipmentItems.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">{t('inspector.noEquipment')}</div>
        ) : (
          <ReferenceItemList
            items={equipmentItems}
            icon={Package}
            onRemove={onRemoveEquipment}
          />
        )}
      </div>

      <div className="px-3 py-3 border-b border-border/60 space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
            <MapPin className="w-3 h-3" />
            {t('inspector.locations')}
          </label>
          <button
            onClick={onToggleLocPicker}
            className="inline-flex items-center gap-1 text-[11px] rounded-md border border-border/60 px-1.5 py-0.5 hover:bg-muted"
            disabled={allLocations.length === 0}
          >
            <Plus className="w-3 h-3" />
            {t('inspector.addLocation')}
          </button>
        </div>
        {locPickerOpen && allLocations.length > 0 ? (
          <div className="rounded-md border border-border/60 bg-card p-1.5 max-h-36 overflow-auto space-y-0.5">
            <div className="flex items-center gap-1 rounded-md border border-border/40 bg-muted/30 px-1.5 py-0.5 mb-1">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={locSearch}
                onChange={(e) => setLocSearch(e.target.value)}
                placeholder={t('inspector.searchEntity')}
                className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/50"
                autoFocus
              />
            </div>
            {filteredLocations.map((location) => {
              const added = addedLocationIds.has(location.id);
              return (
                <button
                  key={location.id}
                  onClick={() => !added && onAddLocation(location.id)}
                  disabled={added}
                  className={`w-full text-left text-[11px] px-2 py-1 rounded-md ${added ? 'text-muted-foreground/50 cursor-default' : 'hover:bg-muted'}`}
                >
                  <div className="font-medium">
                    {location.label}
                    {added && <span className="ml-1 text-[10px]">✓</span>}
                  </div>
                  {location.description ? <div className="text-muted-foreground">{location.description}</div> : null}
                </button>
              );
            })}
          </div>
        ) : null}
        {locationItems.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">{t('inspector.noLocations')}</div>
        ) : (
          <ReferenceItemList
            items={locationItems}
            icon={MapPin}
            onRemove={onRemoveLocation}
          />
        )}
      </div>
    </>
  );
});

interface ReferenceItemListProps {
  items: ReferenceItem[];
  icon: LucideIcon;
  onRemove: (id: string) => void;
}

function ReferenceItemList({ items, icon, onRemove }: ReferenceItemListProps) {
  return (
    <div className="space-y-1">
      {items.map((item) => (
        <ReferenceItemRow
          key={item.id}
          item={item}
          icon={icon}
          onRemove={() => onRemove(item.id)}
        />
      ))}
    </div>
  );
}

interface ReferenceItemRowProps {
  item: ReferenceItem;
  icon: LucideIcon;
  onRemove: () => void;
}

function ReferenceItemRow({ item, icon: Icon, onRemove }: ReferenceItemRowProps) {
  const { url, markFailed } = useAssetUrl(item.thumbnailAssetHash, 'image', 'png');

  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-2 py-1.5">
      <div
        data-testid={`reference-thumb-${item.id}`}
        className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-muted/30"
      >
        {url ? (
          <img
            src={url}
            alt={item.label}
            className="h-full w-full object-cover"
            onError={markFailed}
          />
        ) : (
          <Icon className="h-4 w-4 text-muted-foreground/50" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <span className="block truncate text-xs">{item.label}</span>
        {item.description ? (
          <span className="block truncate text-[10px] text-muted-foreground">{item.description}</span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="ml-1 shrink-0 rounded-md border border-border/60 p-0.5 transition-colors hover:border-destructive/60 hover:bg-destructive/40 hover:text-destructive"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

interface VideoFrameSlotSectionProps {
  label: string;
  slot: VideoFrameSlot;
  t: Translate;
}

function VideoFrameSlotSection({ label, slot, t }: VideoFrameSlotSectionProps) {
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: DragEvent) => {
    const types = e.dataTransfer.types;
    if (types.includes('application/x-lucid-asset') || types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback(() => setDragOver(false), []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      // Asset from asset store
      const assetJson = e.dataTransfer.getData('application/x-lucid-asset');
      if (assetJson) {
        try {
          const parsed = JSON.parse(assetJson) as { hash: string; type?: string };
          if (parsed.type === 'image') {
            slot.onDropAsset(parsed.hash);
          }
        } catch { /* ignore bad json */ }
        return;
      }
      // File from OS file explorer — import via buffer
      if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
          void slot.onDropFile(file);
        }
      }
    },
    [slot],
  );

  // Build unified options list
  const allOptions: SelectOption[] = [];
  if (slot.assetOption) {
    allOptions.push(slot.assetOption);
  }
  for (const opt of slot.connectedOptions) {
    allOptions.push(opt);
  }

  // Auto-select when there's exactly one option and nothing selected yet
  useEffect(() => {
    if (allOptions.length === 1 && !slot.selectedValue) {
      slot.onSelect(allOptions[0].value);
    }
  }, [allOptions.length, slot.selectedValue]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        {slot.hasValue && (
          <button
            type="button"
            onClick={slot.onClear}
            className="text-[10px] text-destructive hover:underline"
          >
            {t('inspector.clear')}
          </button>
        )}
      </div>
      {/* Preview area: clickable + drag-drop target */}
      <div
        className={`relative w-full aspect-video rounded-md overflow-hidden border bg-muted/20 cursor-pointer flex items-center justify-center transition-colors ${
          dragOver ? 'border-primary bg-primary/10' : slot.preview ? 'border-border/60' : 'border-dashed border-border/60'
        }`}
        onClick={() => void slot.onUpload()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {slot.preview ? (
          <div className="w-full h-full">{slot.preview}</div>
        ) : (
          <Upload className="h-5 w-5 text-muted-foreground/30" />
        )}
      </div>
      {/* Unified dropdown: uploaded/asset-store image + connected nodes */}
      {allOptions.length > 0 ? (
        <select
          value={slot.selectedValue ?? ''}
          onChange={(event) => slot.onSelect(event.target.value || undefined)}
          className="w-full text-[11px] rounded-md border border-border/60 bg-background px-1.5 py-1 outline-none"
        >
          <option value="">{t('inspector.select')}</option>
          {allOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <div className="text-[10px] text-muted-foreground/60 italic">
          {t('inspector.noConnectedImages')}
        </div>
      )}
    </div>
  );
}
