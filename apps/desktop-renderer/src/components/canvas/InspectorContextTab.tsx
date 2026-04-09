import type { ReactNode } from 'react';
import { MapPin, Package, Plus, Trash2, Upload, User } from 'lucide-react';
import type { CanvasNodeType } from '@lucid-fin/contracts';

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
  selectedSlot?: string;
  slotOptions?: SlotOption[];
}

interface SelectOption {
  value: string;
  label: string;
}

interface VideoFrameSlot {
  options: SelectOption[];
  selectedNodeId?: string;
  preview?: ReactNode;
  hasValue: boolean;
  onConnectedChange: (value: string | undefined) => void;
  onUpload: () => void | Promise<void>;
  onClear: () => void;
}

interface VideoFramesSection {
  first: VideoFrameSlot;
  last: VideoFrameSlot;
}

interface InspectorContextTabProps {
  t: Translate;
  selectedNodeType: CanvasNodeType;
  charPickerOpen: boolean;
  equipPickerOpen: boolean;
  locPickerOpen: boolean;
  availableCharacters: PickerOption[];
  availableEquipment: PickerOption[];
  availableLocations: PickerOption[];
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

export function InspectorContextTab({
  t,
  selectedNodeType,
  charPickerOpen,
  equipPickerOpen,
  locPickerOpen,
  availableCharacters,
  availableEquipment,
  availableLocations,
  characterItems,
  equipmentItems,
  locationItems,
  onToggleCharPicker,
  onToggleEquipPicker,
  onToggleLocPicker,
  onAddCharacter,
  onAddEquipment,
  onAddLocation,
  onCharacterSlotChange,
  onEquipmentSlotChange,
  onRemoveCharacter,
  onRemoveEquipment,
  onRemoveLocation,
  videoFramesSection,
}: InspectorContextTabProps) {
  const showsVisualContext = selectedNodeType === 'image' || selectedNodeType === 'video';

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
            disabled={availableCharacters.length === 0}
          >
            <Plus className="w-3 h-3" />
            {t('inspector.addCharacter')}
          </button>
        </div>
        {charPickerOpen && availableCharacters.length > 0 ? (
          <div className="rounded-md border border-border/60 bg-card p-1.5 max-h-28 overflow-auto space-y-0.5">
            {availableCharacters.map((character) => (
              <button
                key={character.id}
                onClick={() => onAddCharacter(character.id)}
                className="w-full text-left text-[11px] px-2 py-1 rounded-md hover:bg-muted"
              >
                {character.label}
              </button>
            ))}
          </div>
        ) : null}
        {characterItems.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">{t('inspector.noCharacters')}</div>
        ) : (
          <div className="space-y-1">
            {characterItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-md border border-border/60 bg-card px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <span className="text-xs truncate block">{item.label}</span>
                  {item.slotOptions && item.slotOptions.length > 0 ? (
                    <select
                      value={item.selectedSlot ?? ''}
                      onChange={(event) => onCharacterSlotChange(item.id, event.target.value || undefined)}
                      className="w-full text-[10px] rounded-md border border-border/60 bg-background px-1.5 py-0.5 outline-none"
                    >
                      <option value="">{t('inspector.autoAngle')}</option>
                      {item.slotOptions.map((slot) => (
                        <option key={slot.value} value={slot.value}>
                          {slot.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
                <button
                  onClick={() => onRemoveCharacter(item.id)}
                  className="p-0.5 rounded-md border border-border/60 hover:bg-destructive/20 shrink-0 ml-1.5"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
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
            disabled={availableEquipment.length === 0}
          >
            <Plus className="w-3 h-3" />
            {t('inspector.addEquipment')}
          </button>
        </div>
        {equipPickerOpen && availableEquipment.length > 0 ? (
          <div className="rounded-md border border-border/60 bg-card p-1.5 max-h-28 overflow-auto space-y-0.5">
            {availableEquipment.map((equipment) => (
              <button
                key={equipment.id}
                onClick={() => onAddEquipment(equipment.id)}
                className="w-full text-left text-[11px] px-2 py-1 rounded-md hover:bg-muted"
              >
                <div className="font-medium">{equipment.label}</div>
                {equipment.description ? <div className="text-muted-foreground capitalize">{equipment.description}</div> : null}
              </button>
            ))}
          </div>
        ) : null}
        {equipmentItems.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">{t('inspector.noEquipment')}</div>
        ) : (
          <div className="space-y-1">
            {equipmentItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-md border border-border/60 bg-card px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <span className="text-xs truncate block">{item.label}</span>
                  {item.slotOptions && item.slotOptions.length > 0 ? (
                    <select
                      value={item.selectedSlot ?? ''}
                      onChange={(event) => onEquipmentSlotChange(item.id, event.target.value || undefined)}
                      className="w-full text-[10px] rounded-md border border-border/60 bg-background px-1.5 py-0.5 outline-none"
                    >
                      <option value="">{t('inspector.autoAngle')}</option>
                      {item.slotOptions.map((slot) => (
                        <option key={slot.value} value={slot.value}>
                          {slot.label}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
                <button
                  onClick={() => onRemoveEquipment(item.id)}
                  className="p-0.5 rounded-md border border-border/60 hover:bg-destructive/20 shrink-0 ml-1.5"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
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
            disabled={availableLocations.length === 0}
          >
            <Plus className="w-3 h-3" />
            {t('inspector.addLocation')}
          </button>
        </div>
        {locPickerOpen && availableLocations.length > 0 ? (
          <div className="rounded-md border border-border/60 bg-card p-1.5 max-h-28 overflow-auto space-y-0.5">
            {availableLocations.map((location) => (
              <button
                key={location.id}
                onClick={() => onAddLocation(location.id)}
                className="w-full text-left text-[11px] px-2 py-1 rounded-md hover:bg-muted"
              >
                <div className="font-medium">{location.label}</div>
                {location.description ? <div className="text-muted-foreground">{location.description}</div> : null}
              </button>
            ))}
          </div>
        ) : null}
        {locationItems.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">{t('inspector.noLocations')}</div>
        ) : (
          <div className="space-y-1">
            {locationItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-md border border-border/60 bg-card px-2.5 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <span className="text-xs truncate block">{item.label}</span>
                  {item.description ? (
                    <span className="text-[10px] text-muted-foreground">{item.description}</span>
                  ) : null}
                </div>
                <button
                  onClick={() => onRemoveLocation(item.id)}
                  className="p-0.5 rounded-md border border-border/60 hover:bg-destructive/20 shrink-0 ml-1.5"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

interface VideoFrameSlotSectionProps {
  label: string;
  slot: VideoFrameSlot;
  t: Translate;
}

function VideoFrameSlotSection({ label, slot, t }: VideoFrameSlotSectionProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          {slot.hasValue && (
            <button
              type="button"
              onClick={slot.onClear}
              className="text-[10px] text-destructive hover:underline"
            >
              {t('inspector.clear')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void slot.onUpload()}
            className="text-[10px] text-primary hover:underline"
          >
            {slot.hasValue ? t('inspector.replace') : t('inspector.upload')}
          </button>
        </div>
      </div>
      {/* Full-width preview */}
      {slot.preview ? (
        <div className="w-full">{slot.preview}</div>
      ) : (
        <div
          className="relative w-full aspect-video rounded-md overflow-hidden border border-dashed border-border/60 bg-muted/20 cursor-pointer flex items-center justify-center"
          onClick={() => void slot.onUpload()}
        >
          <Upload className="h-5 w-5 text-muted-foreground/30" />
        </div>
      )}
      {/* Connected node selector */}
      {slot.options.length > 0 ? (
        <select
          value={slot.selectedNodeId ?? ''}
          onChange={(event) => slot.onConnectedChange(event.target.value || undefined)}
          className="w-full text-[11px] rounded-md border border-border/60 bg-background px-1.5 py-1 outline-none"
        >
          <option value="">{t('inspector.select')}</option>
          {slot.options.map((option) => (
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
