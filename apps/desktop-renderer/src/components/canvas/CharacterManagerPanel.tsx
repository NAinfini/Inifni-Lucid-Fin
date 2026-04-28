import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { selectEntityUsageCounts } from '../../store/slices/canvas-selectors.js';
import { removeEntityRefsFromAllCanvases } from '../../store/slices/canvas.js';
import { enqueueToast } from '../../store/slices/toast.js';
import {
  setCharacters,
  addCharacter,
  updateCharacter,
  removeCharacter,
  selectCharacter,
  setLoading,
  setFolders,
  addFolder,
  updateFolder,
  removeFolder,
  setCurrentFolder,
  setFoldersLoading,
  moveItemToFolder,
} from '../../store/slices/characters.js';
import { getAPI } from '../../utils/api.js';
import type {
  Character,
} from '@lucid-fin/contracts';
import { normalizeCharacterRefSlot } from '@lucid-fin/contracts';
import { Link2, User } from 'lucide-react';
import { useI18n } from '../../hooks/use-i18n.js';
import { useEntityManager } from '../../hooks/useEntityManager.js';
import { useEntityFolders } from '../../hooks/useEntityFolders.js';
import { useEntityClipboard } from '../../hooks/useEntityClipboard.js';
import { EntityFileExplorer } from './EntityFileExplorer.js';
import { EntityDetailDrawer } from './EntityDetailDrawer.js';
import { createDraft, type CharacterDraft } from './character-manager/utils.js';
import { ListThumb } from './character-manager/StructField.js';
import { CharacterEditor } from './character-manager/CharacterEditor.js';

export function CharacterManagerPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const { items, selectedId, loading } = useSelector((s: RootState) => s.characters);

  const {
    draft, setDraft,
    setOriginalDraft,
    error, setError,
    assetPickerOpen, setAssetPickerOpen,
    isDirty,
    reportError,
    confirmDiscardIfDirty,
    confirm,
    ConfirmDialog,
  } = useEntityManager<CharacterDraft>({
    entityType: 'character',
    unsavedChangesKey: 'characterManager.unsavedChanges',
  });

  const [drawerOpen, setDrawerOpen] = useState(false);

  const folderApi = useEntityFolders({
    kind: 'character',
    selectFolders: (s) => s.characters.folders,
    selectCurrentFolderId: (s) => s.characters.currentFolderId,
    selectFoldersLoading: (s) => s.characters.foldersLoading,
    actions: {
      setFolders,
      addFolder,
      updateFolder,
      removeFolder,
      setCurrentFolder,
      setFoldersLoading,
    },
  });

  const clipboard = useEntityClipboard<Character>('character');
  const cutIds = useMemo(() => {
    if (!clipboard.isCut) return new Set<string>();
    const p = clipboard.peek();
    return new Set(p?.items.map((it) => it.id) ?? []);
  }, [clipboard]);

  const selectedChar = useMemo(() => items.find((c) => c.id === selectedId), [items, selectedId]);

  const usageCountById = useSelector(selectEntityUsageCounts).character;

  useEffect(() => {
    if (!selectedChar) {
      setDraft(null);
      setOriginalDraft(null);
      return;
    }
    const d = createDraft(selectedChar);
    setDraft(d);
    setOriginalDraft(d);
  }, [selectedChar, setDraft, setOriginalDraft]);

  const loadCharacters = useCallback(async () => {
    dispatch(setLoading(true));
    try {
      const api = getAPI();
      if (api?.character) {
        const list = (await api.character.list()) as Character[];
        dispatch(setCharacters(list));
      }
    } catch (reason) {
      reportError(reason, 'loadCharacters');
    } finally {
      dispatch(setLoading(false));
    }
  }, [dispatch, reportError]);

  useEffect(() => { void loadCharacters(); }, [loadCharacters]);

  const handleOpenItem = useCallback(async (char: Character) => {
    if (selectedId !== char.id) {
      if (!(await confirmDiscardIfDirty())) return;
      dispatch(selectCharacter(char.id));
    }
    setDrawerOpen(true);
  }, [confirmDiscardIfDirty, dispatch, selectedId]);

  const createNewCharacter = useCallback(async () => {
    if (!(await confirmDiscardIfDirty())) return;
    setError(null);
    try {
      const api = getAPI();
      const data: Partial<Character> = {
        name: t('characterManager.newCharacter'),
        role: 'supporting',
        description: '',
        appearance: '',
        personality: '',
        tags: [],
        referenceImages: [],
        loadouts: [],
        defaultLoadoutId: '',
        folderId: folderApi.currentFolderId,
      };
      if (api?.character) {
        const saved = (await api.character.save(data as Record<string, unknown>)) as Character;
        dispatch(addCharacter(saved));
        dispatch(selectCharacter(saved.id));
        setDrawerOpen(true);
      }
    } catch (reason) {
      reportError(reason, 'createNewCharacter');
    }
  }, [dispatch, confirmDiscardIfDirty, reportError, setError, t, folderApi.currentFolderId]);

  const saveDraft = useCallback(async () => {
    if (!draft || !selectedChar) return;
    setError(null);
    try {
      const data: Partial<Character> = {
        id: draft.id,
        name: draft.name.trim(),
        role: draft.role,
        description: draft.description,
        appearance: draft.appearance,
        personality: draft.personality,
        tags: draft.tags.split(',').map((s) => s.trim()).filter(Boolean),
        age: draft.age ? Number(draft.age) : undefined,
        gender: draft.gender || undefined,
        voice: draft.voice || undefined,
        face: Object.values(draft.face).some(Boolean) ? draft.face : undefined,
        hair: Object.values(draft.hair).some(Boolean) ? draft.hair : undefined,
        skinTone: draft.skinTone || undefined,
        body: Object.values(draft.body).some(Boolean) ? draft.body : undefined,
        distinctTraits: draft.distinctTraits
          ? draft.distinctTraits.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
        vocalTraits: Object.values(draft.vocalTraits).some(Boolean) ? draft.vocalTraits : undefined,
      };
      const api = getAPI();
      if (api?.character) {
        const saved = (await api.character.save(data as Record<string, unknown>)) as Character;
        dispatch(updateCharacter({ id: saved.id, data: saved }));
        dispatch(enqueueToast({ variant: 'success', title: t('toast.entitySaved') }));
      }
    } catch (reason) {
      reportError(reason, 'saveDraft');
    }
  }, [dispatch, draft, reportError, selectedChar, setError, t]);

  const handleDeleteIds = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const names = ids
      .map((id) => items.find((c) => c.id === id)?.name || id)
      .join(', ');
    const ok = await confirm({
      title: t('characterManager.deleteConfirm').replace('{name}', names),
      destructive: true,
      confirmLabel: t('action.confirm'),
      cancelLabel: t('action.cancel'),
    });
    if (!ok) return;
    setError(null);
    const api = getAPI();
    for (const id of ids) {
      try {
        if (api?.character) await api.character.delete(id);
        dispatch(removeCharacter(id));
        dispatch(removeEntityRefsFromAllCanvases({ entityType: 'character', entityId: id }));
        if (selectedId === id) setDrawerOpen(false);
      } catch (reason) {
        reportError(reason, 'handleDeleteIds');
      }
    }
  }, [confirm, dispatch, items, reportError, selectedId, setError, t]);

  const handleMoveToFolder = useCallback(
    async (ids: string[], folderId: string | null) => {
      const api = getAPI();
      if (!api?.character) return;
      for (const id of ids) {
        try {
          await api.character.setFolder(id, folderId);
          dispatch(moveItemToFolder({ id, folderId }));
        } catch (reason) {
          reportError(reason, 'handleMoveToFolder');
        }
      }
    },
    [dispatch, reportError],
  );

  const handlePaste = useCallback((payload: { mode: 'copy' | 'cut'; items: Character[] }) => {
    const folderId = folderApi.currentFolderId;
    if (payload.mode === 'cut') {
      void handleMoveToFolder(payload.items.map((it) => it.id), folderId);
    } else {
      // Copy: duplicate each character via the API.
      const api = getAPI();
      if (!api?.character) return;
      (async () => {
        for (const original of payload.items) {
          try {
            const { id: _id, ...rest } = original;
            const saved = (await api.character.save({
              ...rest,
              name: `${original.name} ${t('action.copySuffix')}`,
              folderId,
            } as Record<string, unknown>)) as Character;
            dispatch(addCharacter(saved));
          } catch (reason) {
            reportError(reason, 'handlePasteCopy');
          }
        }
      })();
    }
  }, [folderApi.currentFolderId, handleMoveToFolder, dispatch, reportError, t]);

  const drawerShown = drawerOpen && draft !== null;
  return (
    <div className="flex h-full min-h-0">
      <div className={drawerShown ? 'w-[140px] shrink-0 border-r border-border/60' : 'flex-1 min-w-0'}>
        <EntityFileExplorer<Character>
          items={items}
          folders={folderApi.folders}
          currentFolderId={folderApi.currentFolderId}
          onNavigateFolder={folderApi.setCurrentFolder}
          onCreateFolder={folderApi.createFolder}
          onRenameFolder={folderApi.renameFolder}
          onDeleteFolder={folderApi.deleteFolder}
          onMoveItemsToFolder={(ids, folderId) => void handleMoveToFolder(ids, folderId)}
          onCreateItem={() => void createNewCharacter()}
          onOpenItem={(c) => void handleOpenItem(c)}
          onDeleteItems={(ids) => void handleDeleteIds(ids)}
          compact={drawerShown}
          renderThumbnail={(c) => (
            <ListThumb
              hash={
                c.referenceImages?.find((r) => normalizeCharacterRefSlot(r.slot) === 'main')?.assetHash ??
                c.referenceImages?.[0]?.assetHash
              }
            />
          )}
          renderSubtitle={(c) => (
            <span className="inline-flex items-center gap-1">
              {t('characterManager.roles.' + c.role)}
              {(usageCountById[c.id] ?? 0) > 0 && (
                <span
                  className="inline-flex items-center gap-0.5"
                  title={t('characterManager.usedInNodes').replace('{count}', String(usageCountById[c.id]))}
                >
                  <Link2 className="h-3 w-3" />
                  {usageCountById[c.id]}
                </span>
              )}
            </span>
          )}
          clipboard={{
            hasClipboard: clipboard.hasClipboard,
            isCut: clipboard.isCut,
            copy: clipboard.copy,
            cut: clipboard.cut,
            paste: clipboard.paste,
            cutIds,
          }}
          onPaste={handlePaste}
          header={(
            <div className="flex items-center gap-2">
              <User className="h-3.5 w-3.5 text-primary" />
              <h2 className="text-xs font-semibold">{t('characterManager.title')}</h2>
            </div>
          )}
          newItemLabel={t('characterManager.newCharacter')}
          activeItemId={drawerOpen ? (selectedId ?? null) : null}
          loading={loading}
          emptyLabel={t('characterManager.noResults')}
        />
      </div>

      <EntityDetailDrawer
        open={drawerShown}
        onOpenChange={async (o) => {
          if (!o) {
            if (await confirmDiscardIfDirty()) setDrawerOpen(false);
            else return;
          } else {
            setDrawerOpen(true);
          }
        }}
        title={draft?.name ?? ''}
        subtitle={draft ? t('characterManager.roles.' + draft.role) : undefined}
        onSave={() => void saveDraft()}
        isDirty={isDirty}
        onDelete={selectedId ? () => void handleDeleteIds([selectedId]) : undefined}
      >
        {draft && (
          <CharacterEditor
            draft={draft}
            setDraft={setDraft}
            selectedChar={selectedChar}
            assetPickerOpen={assetPickerOpen}
            setAssetPickerOpen={setAssetPickerOpen}
            reportError={reportError}
            setError={setError}
            error={error}
          />
        )}
      </EntityDetailDrawer>
      {ConfirmDialog}
    </div>
  );
}
