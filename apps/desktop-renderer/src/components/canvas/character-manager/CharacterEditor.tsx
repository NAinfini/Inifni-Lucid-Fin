import React from 'react';
import { useDispatch } from 'react-redux';
import type { Character, CharacterGender, ReferenceImage } from '@lucid-fin/contracts';
import { normalizeCharacterRefSlot } from '@lucid-fin/contracts';
import { ChevronDown } from 'lucide-react';
import { useI18n } from '../../../hooks/use-i18n.js';
import { getAPI } from '../../../utils/api.js';
import { cn } from '../../../lib/utils.js';
import { setCharacterRefImage, removeCharacterRefImage } from '../../../store/slices/characters.js';
import { SingleReferenceImage } from './SingleReferenceImage.js';
import { StructField } from './StructField.js';
import { AssetPickerDialog } from './AssetPickerDialog.js';
import type { CharacterDraft } from './utils.js';

const ROLE_OPTIONS: Character['role'][] = ['protagonist', 'antagonist', 'supporting', 'extra'];
const GENDER_OPTIONS: CharacterGender[] = ['male', 'female', 'non-binary', 'other'];

export interface CharacterEditorProps {
  draft: CharacterDraft;
  setDraft: React.Dispatch<React.SetStateAction<CharacterDraft | null>>;
  selectedChar?: Character;
  assetPickerOpen: boolean;
  setAssetPickerOpen: (open: boolean) => void;
  reportError: (reason: unknown, context: string) => void;
  setError: (err: string | null) => void;
  error: string | null;
}

/** The detail form body for a character, lifted out of CharacterManagerPanel
 * so it can live inside the shared EntityDetailDrawer. */
export function CharacterEditor({
  draft,
  setDraft,
  selectedChar,
  assetPickerOpen,
  setAssetPickerOpen,
  reportError,
  setError,
  error,
}: CharacterEditorProps) {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const [structuredOpen, setStructuredOpen] = React.useState(false);

  const handleRefImageUpload = React.useCallback(
    async (slot: string, isStandard: boolean) => {
      if (!selectedChar) return;
      setError(null);
      try {
        const api = getAPI();
        if (!api) return;
        const asset = (await api.asset.pickFile('image')) as { hash: string } | null;
        if (!asset) return;
        const refImage = (await api.character.setRefImage(
          selectedChar.id,
          slot,
          asset.hash,
          isStandard,
        )) as ReferenceImage;
        dispatch(setCharacterRefImage({ characterId: selectedChar.id, refImage }));
      } catch (reason) {
        reportError(reason, 'handleRefImageUpload');
      }
    },
    [dispatch, reportError, selectedChar, setError],
  );

  const handleRefImageRemove = React.useCallback(
    async (slot: string) => {
      if (!selectedChar) return;
      setError(null);
      try {
        const api = getAPI();
        if (api?.character) await api.character.removeRefImage(selectedChar.id, slot);
        dispatch(removeCharacterRefImage({ characterId: selectedChar.id, slot }));
      } catch (reason) {
        reportError(reason, 'handleRefImageRemove');
      }
    },
    [dispatch, reportError, selectedChar, setError],
  );

  const handleRefImageFromAsset = React.useCallback(
    async (hash: string) => {
      if (!selectedChar) return;
      setAssetPickerOpen(false);
      setError(null);
      try {
        const api = getAPI();
        if (!api?.character) return;
        const refImage = (await api.character.setRefImage(
          selectedChar.id,
          'main',
          hash,
          true,
        )) as ReferenceImage;
        dispatch(setCharacterRefImage({ characterId: selectedChar.id, refImage }));
      } catch (reason) {
        reportError(reason, 'handleRefImageFromAsset');
      }
    },
    [dispatch, reportError, selectedChar, setAssetPickerOpen, setError],
  );

  const handleSelectVariant = React.useCallback(
    async (variantHash: string) => {
      if (!selectedChar) return;
      setError(null);
      try {
        const mainRef =
          selectedChar.referenceImages.find((r) => normalizeCharacterRefSlot(r.slot) === 'main') ??
          selectedChar.referenceImages[0];
        if (!mainRef) return;
        const updatedRef: ReferenceImage = { ...mainRef, assetHash: variantHash };
        const updatedRefs = selectedChar.referenceImages.map((r) =>
          r.slot === mainRef.slot ? updatedRef : r,
        );
        const api = getAPI();
        if (api?.character) {
          await api.character.save({
            id: selectedChar.id,
            referenceImages: updatedRefs,
          } as Record<string, unknown>);
        }
        dispatch(setCharacterRefImage({ characterId: selectedChar.id, refImage: updatedRef }));
      } catch (reason) {
        reportError(reason, 'handleSelectVariant');
      }
    },
    [dispatch, reportError, selectedChar, setError],
  );

  const handleDeleteVariant = React.useCallback(
    async (variantHash: string) => {
      if (!selectedChar) return;
      setError(null);
      try {
        const mainRef =
          selectedChar.referenceImages.find((r) => normalizeCharacterRefSlot(r.slot) === 'main') ??
          selectedChar.referenceImages[0];
        if (!mainRef || !mainRef.variants) return;
        const newVariants = mainRef.variants.filter((v) => v !== variantHash);
        const newAssetHash =
          mainRef.assetHash === variantHash ? (newVariants[0] ?? '') : mainRef.assetHash;
        const updatedRef: ReferenceImage = {
          ...mainRef,
          assetHash: newAssetHash,
          variants: newVariants,
        };
        const updatedRefs = selectedChar.referenceImages.map((r) =>
          r.slot === mainRef.slot ? updatedRef : r,
        );
        const api = getAPI();
        if (api?.character) {
          await api.character.save({
            id: selectedChar.id,
            referenceImages: updatedRefs,
          } as Record<string, unknown>);
        }
        dispatch(setCharacterRefImage({ characterId: selectedChar.id, refImage: updatedRef }));
      } catch (reason) {
        reportError(reason, 'handleDeleteVariant');
      }
    },
    [dispatch, reportError, selectedChar, setError],
  );

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
          {t('characterManager.fields.name')}
        </label>
        <input
          value={draft.name}
          onChange={(e) => setDraft((p) => (p ? { ...p, name: e.target.value } : p))}
          className="w-full rounded bg-muted px-2 py-1 text-xs"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
            {t('characterManager.fields.role')}
          </label>
          <select
            value={draft.role}
            onChange={(e) =>
              setDraft((p) => (p ? { ...p, role: e.target.value as Character['role'] } : p))
            }
            className="w-full rounded bg-muted px-2 py-1 text-xs"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {t('characterManager.roles.' + r)}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
            {t('characterManager.fields.gender')}
          </label>
          <select
            value={draft.gender}
            onChange={(e) =>
              setDraft((p) => (p ? { ...p, gender: e.target.value as CharacterGender | '' } : p))
            }
            className="w-full rounded bg-muted px-2 py-1 text-xs"
          >
            <option value="">--</option>
            {GENDER_OPTIONS.map((g) => (
              <option key={g} value={g}>
                {t('characterManager.genders.' + g)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
            {t('characterManager.fields.age')}
          </label>
          <input
            type="number"
            value={draft.age}
            onChange={(e) => setDraft((p) => (p ? { ...p, age: e.target.value } : p))}
            className="w-full rounded bg-muted px-2 py-1 text-xs"
            placeholder={t('characterManager.fields.age')}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
            {t('characterManager.fields.voice')}
          </label>
          <input
            value={draft.voice}
            onChange={(e) => setDraft((p) => (p ? { ...p, voice: e.target.value } : p))}
            className="w-full rounded bg-muted px-2 py-1 text-xs"
            placeholder={t('characterManager.fields.voice')}
          />
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
          {t('characterManager.fields.description')}
        </label>
        <textarea
          value={draft.description}
          onChange={(e) => setDraft((p) => (p ? { ...p, description: e.target.value } : p))}
          className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[50px]"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
          {t('characterManager.fields.appearance')}
        </label>
        <textarea
          value={draft.appearance}
          onChange={(e) => setDraft((p) => (p ? { ...p, appearance: e.target.value } : p))}
          className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[50px]"
        />
      </div>

      <div className="rounded-md border border-border/60">
        <button
          type="button"
          onClick={() => setStructuredOpen((v) => !v)}
          className="flex w-full items-center justify-between px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/40 transition-colors"
        >
          {t('characterManager.structuredAppearance')}
          <ChevronDown
            className={cn('h-3 w-3 transition-transform', structuredOpen && 'rotate-180')}
          />
        </button>
        {structuredOpen && (
          <div className="space-y-2 border-t border-border/40 p-2.5">
            <fieldset className="space-y-1">
              <legend className="text-[9px] uppercase text-muted-foreground tracking-wider font-semibold">
                {t('characterManager.structured.face')}
              </legend>
              <div className="grid grid-cols-2 gap-1.5">
                <StructField
                  label={t('characterManager.structured.eyeShape')}
                  value={draft.face.eyeShape ?? ''}
                  onChange={(v) =>
                    setDraft((p) => (p ? { ...p, face: { ...p.face, eyeShape: v } } : p))
                  }
                />
                <StructField
                  label={t('characterManager.structured.eyeColor')}
                  value={draft.face.eyeColor ?? ''}
                  onChange={(v) =>
                    setDraft((p) => (p ? { ...p, face: { ...p.face, eyeColor: v } } : p))
                  }
                />
                <StructField
                  label={t('characterManager.structured.noseType')}
                  value={draft.face.noseType ?? ''}
                  onChange={(v) =>
                    setDraft((p) => (p ? { ...p, face: { ...p.face, noseType: v } } : p))
                  }
                />
                <StructField
                  label={t('characterManager.structured.lipShape')}
                  value={draft.face.lipShape ?? ''}
                  onChange={(v) =>
                    setDraft((p) => (p ? { ...p, face: { ...p.face, lipShape: v } } : p))
                  }
                />
                <StructField
                  label={t('characterManager.structured.jawline')}
                  value={draft.face.jawline ?? ''}
                  onChange={(v) =>
                    setDraft((p) => (p ? { ...p, face: { ...p.face, jawline: v } } : p))
                  }
                />
              </div>
              <StructField
                label={t('characterManager.structured.definingFeatures')}
                value={draft.face.definingFeatures ?? ''}
                onChange={(v) =>
                  setDraft((p) => (p ? { ...p, face: { ...p.face, definingFeatures: v } } : p))
                }
              />
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="text-[9px] uppercase text-muted-foreground tracking-wider font-semibold">
                {t('characterManager.structured.hair')}
              </legend>
              <div className="grid grid-cols-2 gap-1.5">
                <StructField
                  label={t('characterManager.structured.hairColor')}
                  value={draft.hair.color ?? ''}
                  onChange={(v) =>
                    setDraft((p) => (p ? { ...p, hair: { ...p.hair, color: v } } : p))
                  }
                />
                <StructField
                  label={t('characterManager.structured.hairStyle')}
                  value={draft.hair.style ?? ''}
                  onChange={(v) =>
                    setDraft((p) => (p ? { ...p, hair: { ...p.hair, style: v } } : p))
                  }
                />
                <StructField
                  label={t('characterManager.structured.hairLength')}
                  value={draft.hair.length ?? ''}
                  onChange={(v) =>
                    setDraft((p) => (p ? { ...p, hair: { ...p.hair, length: v } } : p))
                  }
                />
                <StructField
                  label={t('characterManager.structured.hairTexture')}
                  value={draft.hair.texture ?? ''}
                  onChange={(v) =>
                    setDraft((p) => (p ? { ...p, hair: { ...p.hair, texture: v } } : p))
                  }
                />
              </div>
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="text-[9px] uppercase text-muted-foreground tracking-wider font-semibold">
                {t('characterManager.structured.body')}
              </legend>
              <div className="grid grid-cols-2 gap-1.5">
                <StructField
                  label={t('characterManager.structured.skinTone')}
                  value={draft.skinTone}
                  onChange={(v) => setDraft((p) => (p ? { ...p, skinTone: v } : p))}
                />
                <StructField
                  label={t('characterManager.structured.height')}
                  value={draft.body.height ?? ''}
                  onChange={(v) =>
                    setDraft((p) => (p ? { ...p, body: { ...p.body, height: v } } : p))
                  }
                />
                <StructField
                  label={t('characterManager.structured.build')}
                  value={draft.body.build ?? ''}
                  onChange={(v) =>
                    setDraft((p) => (p ? { ...p, body: { ...p.body, build: v } } : p))
                  }
                />
                <StructField
                  label={t('characterManager.structured.proportions')}
                  value={draft.body.proportions ?? ''}
                  onChange={(v) =>
                    setDraft((p) => (p ? { ...p, body: { ...p.body, proportions: v } } : p))
                  }
                />
              </div>
            </fieldset>
            <div className="space-y-1">
              <label className="text-[9px] uppercase text-muted-foreground tracking-wider font-semibold">
                {t('characterManager.structured.distinctTraits')}
              </label>
              <input
                value={draft.distinctTraits}
                onChange={(e) =>
                  setDraft((p) => (p ? { ...p, distinctTraits: e.target.value } : p))
                }
                className="w-full rounded bg-muted px-2 py-1 text-[10px]"
                placeholder={t('characterManager.structured.distinctTraitsHint')}
              />
            </div>
            <fieldset className="space-y-1">
              <legend className="text-[9px] uppercase text-muted-foreground tracking-wider font-semibold">
                {t('characterManager.structured.vocalTraits')}
              </legend>
              <div className="grid grid-cols-3 gap-1.5">
                <StructField
                  label={t('characterManager.structured.pitch')}
                  value={draft.vocalTraits.pitch ?? ''}
                  onChange={(v) =>
                    setDraft((p) => (p ? { ...p, vocalTraits: { ...p.vocalTraits, pitch: v } } : p))
                  }
                />
                <StructField
                  label={t('characterManager.structured.accent')}
                  value={draft.vocalTraits.accent ?? ''}
                  onChange={(v) =>
                    setDraft((p) =>
                      p ? { ...p, vocalTraits: { ...p.vocalTraits, accent: v } } : p,
                    )
                  }
                />
                <StructField
                  label={t('characterManager.structured.cadence')}
                  value={draft.vocalTraits.cadence ?? ''}
                  onChange={(v) =>
                    setDraft((p) =>
                      p ? { ...p, vocalTraits: { ...p.vocalTraits, cadence: v } } : p,
                    )
                  }
                />
              </div>
            </fieldset>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
          {t('characterManager.fields.personality')}
        </label>
        <textarea
          value={draft.personality}
          onChange={(e) => setDraft((p) => (p ? { ...p, personality: e.target.value } : p))}
          className="w-full rounded bg-muted px-2 py-1 text-xs min-h-[50px]"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
          {t('characterManager.fields.tags')}
        </label>
        <input
          value={draft.tags}
          onChange={(e) => setDraft((p) => (p ? { ...p, tags: e.target.value } : p))}
          className="w-full rounded bg-muted px-2 py-1 text-xs"
          placeholder={t('characterManager.fields.tags')}
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] uppercase text-muted-foreground tracking-wider">
          {t('characterManager.referenceImages')}
        </label>
        <SingleReferenceImage
          referenceImages={selectedChar?.referenceImages ?? []}
          onUpload={() => handleRefImageUpload('main', true)}
          onRemove={(slot) => handleRefImageRemove(slot)}
          onFromAssets={() => setAssetPickerOpen(true)}
          onDropHash={(hash) => void handleRefImageFromAsset(hash)}
          onSelectVariant={(hash) => void handleSelectVariant(hash)}
          onDeleteVariant={(hash) => void handleDeleteVariant(hash)}
          entityType="character"
          entityId={selectedChar?.id}
          slot="main"
        />
        <p className="text-[9px] text-muted-foreground/70 italic mt-1">
          {t('characterManager.generateAllHint')}
        </p>
      </div>

      <AssetPickerDialog
        open={assetPickerOpen}
        onClose={() => setAssetPickerOpen(false)}
        onSelect={(hash) => void handleRefImageFromAsset(hash)}
      />

      {error && <div className="text-[11px] text-destructive">{error}</div>}
    </div>
  );
}
