import { useCallback, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { addLog } from '../store/slices/logger.js';
import { useConfirm } from '../components/ui/ConfirmDialog.js';
import { useI18n } from './use-i18n.js';

export interface EntityManagerConfig {
  /** Entity type name for logging (e.g. 'character', 'equipment', 'location') */
  entityType: string;
  /** i18n key for unsaved changes confirm title */
  unsavedChangesKey: string;
}

export interface EntityManagerState<TDraft> {
  draft: TDraft | null;
  originalDraft: TDraft | null;
  search: string;
  error: string | null;
  isDirty: boolean;
  assetPickerOpen: boolean;
}

export interface EntityManagerActions<TDraft> {
  setDraft: React.Dispatch<React.SetStateAction<TDraft | null>>;
  setOriginalDraft: React.Dispatch<React.SetStateAction<TDraft | null>>;
  setSearch: (search: string) => void;
  setError: (error: string | null) => void;
  setAssetPickerOpen: (open: boolean) => void;
  reportError: (reason: unknown, detail: string) => void;
  confirmDiscardIfDirty: () => Promise<boolean>;
}

export type EntityManagerResult<TDraft> = EntityManagerState<TDraft> &
  EntityManagerActions<TDraft> & {
    /** Must be rendered in the component tree for confirm dialogs to work */
    ConfirmDialog: React.ReactNode;
    /** The confirm function from useConfirm, for entity-specific dialogs (e.g. delete) */
    confirm: (opts: {
      title: string;
      description?: string;
      confirmLabel?: string;
      cancelLabel?: string;
      destructive?: boolean;
    }) => Promise<boolean>;
  };

/**
 * Shared state management for entity manager panels (Character, Equipment, Location).
 * Extracts the duplicated draft/dirty/error/confirm patterns.
 */
export function useEntityManager<TDraft>(
  config: EntityManagerConfig,
): EntityManagerResult<TDraft> {
  const { t } = useI18n();
  const { confirm, ConfirmDialog } = useConfirm();
  const dispatch = useDispatch();

  const [draft, setDraft] = useState<TDraft | null>(null);
  const [originalDraft, setOriginalDraft] = useState<TDraft | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);

  const isDirty = useMemo(() => {
    if (!draft || !originalDraft) return false;
    return JSON.stringify(draft) !== JSON.stringify(originalDraft);
  }, [draft, originalDraft]);

  const reportError = useCallback(
    (reason: unknown, detail: string) => {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      dispatch(
        addLog({
          level: 'error',
          category: config.entityType,
          message,
          detail,
        }),
      );
    },
    [dispatch, config.entityType],
  );

  const confirmDiscardIfDirty = useCallback(async (): Promise<boolean> => {
    if (!isDirty) return true;
    return confirm({
      title: t(config.unsavedChangesKey),
      destructive: true,
      confirmLabel: t('action.confirm'),
      cancelLabel: t('action.cancel'),
    });
  }, [confirm, isDirty, t, config.unsavedChangesKey]);

  return {
    draft,
    setDraft,
    originalDraft,
    setOriginalDraft,
    search,
    setSearch,
    error,
    setError,
    assetPickerOpen,
    setAssetPickerOpen,
    isDirty,
    reportError,
    confirmDiscardIfDirty,
    confirm,
    ConfirmDialog,
  };
}
