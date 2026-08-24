import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { selectEntityUsageCounts } from '../../store/slices/canvas/canvas-selectors.js';
import { removeEntityRefsFromAllCanvases } from '../../store/slices/canvas/canvas.js';
import { enqueueToast } from '../../store/slices/toast.js';
import {
  setCharacters,
  addCharacter,
  addCharacters,
  updateCharacter,
  removeCharacters,
  selectCharacter,
  setLoading,
  setFolders,
  addFolder,
  updateFolder,
  removeFolder,
  setCurrentFolder,
  setFoldersLoading,
  moveItemsToFolder,
} from '../../store/slices/characters.js';
import { getAPI } from '../../utils/api.js';
import type { Character } from '@lucid-fin/contracts';
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
    draft,
    setDraft,
    setOriginalDraft,
    error,
    setError,
    assetPickerOpen,
    setAssetPickerOpen,
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

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const selectedChar = selectedId ? itemsById.get(selectedId) : undefined;

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

  useEffect(() => {
    void loadCharacters();
  }, [loadCharacters]);

  const handleOpenItem = useCallback(
    async (char: Character) => {
      if (selectedId !== char.id) {
        if (!(await confirmDiscardIfDirty())) return;
        dispatch(selectCharacter(char.id));
      }
      setDrawerOpen(true);
    },
    [confirmDiscardIfDirty, dispatch, selectedId],
  );

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
        tags: draft.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        age: draft.age ? Number(draft.age) : undefined,
        gender: draft.gender || undefined,
        voice: draft.voice || undefined,
        face: Object.values(draft.face).some(Boolean) ? draft.face : undefined,
        hair: Object.values(draft.hair).some(Boolean) ? draft.hair : undefined,
        skinTone: draft.skinTone || undefined,
        body: Object.values(draft.body).some(Boolean) ? draft.body : undefined,
        distinctTraits: draft.distinctTraits
          ? draft.distinctTraits
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
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

  const handleDeleteIds = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      const names = ids.map((id) => itemsById.get(id)?.name ?? id).join(', ');
      const ok = await confirm({
        title: t('characterManager.deleteConfirm').replace('{name}', names),
        destructive: true,
        confirmLabel: t('action.confirm'),
        cancelLabel: t('action.cancel'),
      });
      if (!ok) return;
      setError(null);
      const api = getAPI();
      if (!api?.character) return;
      try {
        const { deletedIds } = await api.character.delete(ids);
        dispatch(removeCharacters(deletedIds));
        if (selectedId && deletedIds.includes(selectedId)) setDrawerOpen(false);
        dispatch(
          removeEntityRefsFromAllCanvases({ entityType: 'character', entityIds: deletedIds }),
        );
      } catch (reason) {
        reportError(reason, 'handleDeleteIds');
      }
    },
    [confirm, dispatch, itemsById, reportError, selectedId, setError, t],
  );

  const handleMoveToFolder = useCallback(
    async (ids: string[], folderId: string | null) => {
      if (ids.length === 0) return;
      const api = getAPI();
      if (!api?.character) return;
      try {
        const { movedIds } = await api.character.setFolder(ids, folderId);
        dispatch(moveItemsToFolder({ ids: movedIds, folderId }));
      } catch (reason) {
        reportError(reason, 'handleMoveToFolder');
      }
    },
    [dispatch, reportError],
  );

  const handleCopyIds = useCallback(
    async (ids: string[], targetFolderId: string | null) => {
      if (ids.length === 0) return;
      const api = getAPI();
      if (!api?.character) return;
      try {
        const { created } = await api.character.copy(ids, targetFolderId);
        dispatch(addCharacters(created));
      } catch (reason) {
        reportError(reason, 'handleCopyIds');
      }
    },
    [dispatch, reportError],
  );

  const handlePaste = useCallback(
    async (payload: { mode: 'copy' | 'cut'; items: Character[] }) => {
      const folderId = folderApi.currentFolderId;
      if (payload.mode === 'cut') {
        await handleMoveToFolder(
          payload.items.map((it) => it.id),
          folderId,
        );
      } else {
        await handleCopyIds(
          payload.items.map((item) => item.id),
          folderId,
        );
      }
    },
    [folderApi.currentFolderId, handleCopyIds, handleMoveToFolder],
  );

  const drawerShown = drawerOpen && draft !== null;
  return (
    <div className="flex h-full min-h-0">
      <div
        className={drawerShown ? 'w-[140px] shrink-0 border-r border-border/60' : 'flex-1 min-w-0'}
      >
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
          onDuplicateItems={(ids) => void handleCopyIds(ids, folderApi.currentFolderId)}
          compact={drawerShown}
          renderThumbnail={(c) => (
            <ListThumb
              hash={
                c.referenceImages?.find((r) => normalizeCharacterRefSlot(r.slot) === 'main')
                  ?.assetHash ?? c.referenceImages?.[0]?.assetHash
              }
            />
          )}
          renderSubtitle={(c) => (
            <span className="inline-flex items-center gap-1">
              {t('characterManager.roles.' + c.role)}
              {(usageCountById[c.id] ?? 0) > 0 && (
                <span
                  className="inline-flex items-center gap-0.5"
                  title={t('characterManager.usedInNodes').replace(
                    '{count}',
                    String(usageCountById[c.id]),
                  )}
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
          onPaste={(payload) => void handlePaste(payload)}
          header={
            <div className="flex items-center gap-2">
              <User className="h-3.5 w-3.5 text-primary" />
              <h2 className="text-xs font-semibold">{t('characterManager.title')}</h2>
            </div>
          }
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
