import { useState, useCallback, useRef, useEffect, useMemo, startTransition } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  History,
  Plus,
  Camera,
  Trash2,
  MessageSquare,
  ChevronRight,
  ChevronDown,
  Clock,
  Archive,
  RotateCcw,
  Pencil,
  FolderOpen,
  MoreHorizontal,
  Loader2,
  AlertCircle,
  CircleHelp,
  PauseCircle,
} from 'lucide-react';
import type { RootState } from '../../store/index.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { getLocale } from '../../i18n.js';
import {
  newSession,
  loadSession,
  hydrateSessionMessages,
  deleteSession,
  renameSession,
  moveSession,
  focusAgentActivity,
  unassignSessionsFromCanvas,
  selectIsStreaming,
  type CommanderMessage,
  type CommanderSession,
} from '../../store/slices/commander.js';
import { setCharacters } from '../../store/slices/characters.js';
import { setEquipment } from '../../store/slices/equipment.js';
import { setLocations } from '../../store/slices/locations.js';
import {
  archiveCanvas,
  removeCanvas,
  renameCanvas,
  restoreCanvas,
  setActiveCanvas,
  setCanvases,
} from '../../store/slices/canvas/canvas.js';
import { selectAllCanvases } from '../../store/slices/canvas/canvas-selectors.js';
import { enqueueToast } from '../../store/slices/toast.js';
import { useConfirm } from '../ui/ConfirmDialog.js';
import { cn } from '../../lib/utils.js';
import { getAPI } from '../../utils/api.js';
import { EmptyState } from '../ui/EmptyState.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu.js';
import { sanitizeCommanderMessages } from '../../commander/state/session-persistence.js';
import {
  selectAgentActivitySummaryBySession,
  type AgentActivitySessionSummary,
} from '../../commander/state/commander-timeline-selectors.js';
import { appendEvent as appendTimelineEvent } from '../../commander/state/commander-timeline-slice.js';
import { fetchPublicRunTreeEvents } from '../../commander/transport/fetch-public-run-tree-events.js';

/** Snapshot metadata returned from the IPC layer (no heavy data blob). */
interface SnapshotMeta {
  id: string;
  sessionId: string;
  label: string;
  trigger: string;
  createdAt: number;
}

interface SessionGroup {
  id: string;
  label: string;
  defaultCanvasId: string | null;
  archivedAt?: number;
  sessions: CommanderSession[];
}

function formatDate(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const locale = getLocale();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  return (
    d.toLocaleDateString(locale, { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  );
}

function parseCommanderMessages(serialized: string): CommanderMessage[] {
  const parsed = JSON.parse(serialized) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Stored session messages are invalid');
  }
  const messages = sanitizeCommanderMessages(parsed);
  if (messages.length !== parsed.length) throw new Error('Stored session messages are invalid');
  return messages;
}

function activeUnitsLabel(summary: AgentActivitySessionSummary, t: (key: string) => string): string {
  return t('commander.agentActivity.activeUnitsLabel').replace('{count}', String(summary.activeCount));
}

function ActivityTreeIndicator({
  summary,
  onOpen,
  t,
}: {
  summary: AgentActivitySessionSummary;
  onOpen: () => void;
  t: (key: string) => string;
}) {
  const label = activeUnitsLabel(summary, t);
  const status = summary.highestPriorityStatus;
  const icon =
    status === 'waiting_user' ? (
      <CircleHelp className="h-3.5 w-3.5 text-amber-400" aria-hidden />
    ) : status === 'paused' ? (
      <PauseCircle className="h-3.5 w-3.5 text-amber-400" aria-hidden />
    ) : status === 'failed' || status === 'blocked' ? (
      <AlertCircle className="h-3.5 w-3.5 text-destructive" aria-hidden />
    ) : (
      <Loader2
        className="h-3.5 w-3.5 animate-spin text-primary motion-reduce:animate-none"
        aria-hidden
      />
    );

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {icon}
    </button>
  );
}

export function HistoryPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const sessions = useSelector((state: RootState) => state.commander.sessions);
  const activeSessionId = useSelector((state: RootState) => state.commander.activeSessionId);
  const isStreaming = useSelector((state: RootState) => selectIsStreaming(state));
  const activityBySessionId = useSelector(selectAgentActivitySummaryBySession);
  const canvases = useSelector(selectAllCanvases);
  const { confirm, ConfirmDialog } = useConfirm();

  // --- Snapshot-related local state ---
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [sessionSnapshots, setSessionSnapshots] = useState<Record<string, SnapshotMeta[]>>({});
  const [loadingSnaps, setLoadingSnaps] = useState<Set<string>>(new Set());
  const [restoringSnap, setRestoringSnap] = useState<string | null>(null);
  const [deletingSnapId, setDeletingSnapId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [movingSessionId, setMovingSessionId] = useState<string | null>(null);
  const [draggedSessionId, setDraggedSessionId] = useState<string | null>(null);
  const [dragTargetGroupId, setDragTargetGroupId] = useState<string | null>(null);
  const hydratingSessionsRef = useRef<Set<string>>(new Set());
  const hydratedActivitySessionsRef = useRef<Set<string>>(new Set());
  const renamingSessionsRef = useRef<Set<string>>(new Set());

  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let disposed = false;

    const hydratePublicRunTree = async (sessionId: string) => {
      try {
        const events = await fetchPublicRunTreeEvents(sessionId);
        if (disposed) return;
        for (const event of events) {
          dispatch(appendTimelineEvent({ sessionId, event }));
        }
      } catch {
        // The stream remains authoritative; a later session refresh can retry hydration.
        hydratedActivitySessionsRef.current.delete(sessionId);
      }
    };

    for (const session of sessions) {
      if (hydratedActivitySessionsRef.current.has(session.id)) continue;
      hydratedActivitySessionsRef.current.add(session.id);
      void hydratePublicRunTree(session.id);
    }

    return () => {
      disposed = true;
    };
  }, [dispatch, sessions]);

  // --- Rename state ---
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [renamingCanvasId, setRenamingCanvasId] = useState<string | null>(null);
  const [canvasRenameValue, setCanvasRenameValue] = useState('');
  const canvasRenameInputRef = useRef<HTMLInputElement>(null);
  const renamingCanvasesRef = useRef<Set<string>>(new Set());
  const pendingCanvasRenameFocusRef = useRef<string | null>(null);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
  }, [sessions, searchQuery]);

  const sessionGroups = useMemo<SessionGroup[]>(() => {
    const sessionsByCanvas = new Map(
      canvases.map((canvas) => [canvas.id, [] as CommanderSession[]]),
    );
    const unassigned: CommanderSession[] = [];

    for (const session of filteredSessions) {
      const canvasSessions = session.defaultCanvasId
        ? sessionsByCanvas.get(session.defaultCanvasId)
        : undefined;
      (canvasSessions ?? unassigned).push(session);
    }

    const byRecent = (items: CommanderSession[]) =>
      [...items].sort((a, b) => b.updatedAt - a.updatedAt);

    return [
      {
        id: 'unassigned',
        label: t('history.unassigned'),
        defaultCanvasId: null,
        sessions: byRecent(unassigned),
      },
      ...canvases
        .filter((canvas) => canvas.archivedAt === undefined)
        .map((canvas) => ({
          id: `canvas:${canvas.id}`,
          label: canvas.name,
          defaultCanvasId: canvas.id,
          sessions: byRecent(sessionsByCanvas.get(canvas.id) ?? []),
        })),
      ...canvases
        .filter((canvas) => canvas.archivedAt !== undefined)
        .map((canvas) => ({
          id: `canvas:${canvas.id}`,
          label: canvas.name,
          defaultCanvasId: canvas.id,
          archivedAt: canvas.archivedAt,
          sessions: byRecent(sessionsByCanvas.get(canvas.id) ?? []),
        })),
    ];
  }, [canvases, filteredSessions, t]);

  useEffect(() => {
    if (renamingSessionId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingSessionId]);

  useEffect(() => {
    if (renamingCanvasId && canvasRenameInputRef.current) {
      canvasRenameInputRef.current.focus();
      canvasRenameInputRef.current.select();
      pendingCanvasRenameFocusRef.current = null;
    }
  }, [renamingCanvasId]);

  const commitRename = useCallback(
    async (sessionId: string) => {
      if (renamingSessionsRef.current.has(sessionId)) return;
      const trimmed = renameValue.trim();
      setRenamingSessionId(null);
      if (!trimmed) return;

      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (!session) return;
      renamingSessionsRef.current.add(sessionId);
      try {
        if (session.messages.length !== session.messageCount) {
          const sessionApi = getAPI()?.session;
          if (!sessionApi) throw new Error('Session API is unavailable');
          const full = await sessionApi.get(sessionId);
          dispatch(
            hydrateSessionMessages({
              id: sessionId,
              messages: parseCommanderMessages(full.messages),
            }),
          );
        }
        dispatch(renameSession({ id: sessionId, title: trimmed }));
      } catch (error) {
        dispatch(
          enqueueToast({
            variant: 'warning',
            title: t('history.sessionLoadFailed'),
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        renamingSessionsRef.current.delete(sessionId);
      }
    },
    [dispatch, renameValue, sessions, t],
  );

  const sessionIsLocked = useCallback(
    (session: CommanderSession) => activityBySessionId[session.id]?.hasActiveDescendant ?? false,
    [activityBySessionId],
  );

  const startCanvasRename = useCallback((canvasId: string, canvasName: string) => {
    setRenamingCanvasId(canvasId);
    setCanvasRenameValue(canvasName);
  }, []);

  const commitCanvasRename = useCallback(
    async (canvasId: string) => {
      if (renamingCanvasesRef.current.has(canvasId)) return;
      const name = canvasRenameValue.trim();
      pendingCanvasRenameFocusRef.current = null;
      setRenamingCanvasId(null);
      if (!name) return;

      const canvas = canvases.find((candidate) => candidate.id === canvasId);
      if (!canvas || canvas.name === name) return;

      renamingCanvasesRef.current.add(canvasId);
      try {
        const api = getAPI();
        if (!api?.canvas?.rename) throw new Error('Canvas rename API is unavailable');
        await api.canvas.rename(canvasId, name);
        dispatch(renameCanvas({ id: canvasId, name }));
      } catch (error) {
        dispatch(
          enqueueToast({
            variant: 'error',
            title: t('toast.error.operationFailed'),
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        renamingCanvasesRef.current.delete(canvasId);
      }
    },
    [canvasRenameValue, canvases, dispatch, t],
  );

  const handleArchiveCanvas = useCallback(
    async (canvasId: string) => {
      const canvas = canvases.find((candidate) => candidate.id === canvasId);
      if (!canvas) return;

      const shouldArchive = await confirm({
        title: t('history.archiveCanvasConfirm'),
        description: t('history.archiveCanvasDescription'),
        confirmLabel: t('history.archiveCanvas'),
        cancelLabel: t('action.cancel'),
      });
      if (!shouldArchive) return;

      try {
        const api = getAPI();
        if (!api?.canvas?.delete) throw new Error('Canvas archive API is unavailable');
        await api.canvas.delete(canvasId);
        dispatch(archiveCanvas({ id: canvasId, archivedAt: Date.now() }));
      } catch (error) {
        dispatch(
          enqueueToast({
            variant: 'error',
            title: t('toast.error.operationFailed'),
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
    [canvases, confirm, dispatch, t],
  );

  const handleRestoreCanvas = useCallback(
    async (canvasId: string) => {
      try {
        const api = getAPI();
        if (!api?.canvas?.restore) throw new Error('Canvas restore API is unavailable');
        await api.canvas.restore(canvasId);
        dispatch(restoreCanvas(canvasId));
      } catch (error) {
        dispatch(
          enqueueToast({
            variant: 'error',
            title: t('toast.error.operationFailed'),
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
    [dispatch, t],
  );

  const handleDeleteCanvasPermanently = useCallback(
    async (canvasId: string) => {
      const canvas = canvases.find((candidate) => candidate.id === canvasId);
      if (!canvas?.archivedAt) return;
      const shouldDelete = await confirm({
        title: t('history.deleteCanvasPermanentlyConfirm'),
        description: t('history.deleteCanvasPermanentlyDescription'),
        destructive: true,
        confirmLabel: t('history.deletePermanently'),
        cancelLabel: t('action.cancel'),
      });
      if (!shouldDelete) return;

      try {
        const api = getAPI();
        if (!api?.canvas?.deletePermanent) {
          throw new Error('Permanent Canvas delete API is unavailable');
        }
        await api.canvas.deletePermanent(canvasId);
        dispatch(unassignSessionsFromCanvas(canvasId));
        dispatch(removeCanvas(canvasId));
      } catch (error) {
        dispatch(
          enqueueToast({
            variant: 'error',
            title: t('toast.error.operationFailed'),
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    },
    [canvases, confirm, dispatch, t],
  );

  // -----------------------------------------------------------------------
  // Toggle expand/collapse + load snapshots lazily
  // -----------------------------------------------------------------------
  const handleToggleExpand = useCallback(
    async (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const api = getAPI();

      // Toggle expansion
      setExpandedSessions((prev) => {
        const next = new Set(prev);
        if (next.has(sessionId)) {
          next.delete(sessionId);
        } else {
          next.add(sessionId);
        }
        return next;
      });

      // Load snapshots lazily on first expand
      if (!sessionSnapshots[sessionId] && !loadingSnaps.has(sessionId)) {
        setLoadingSnaps((prev) => new Set(prev).add(sessionId));
        try {
          const snaps = (await api?.snapshot?.list(sessionId)) ?? [];
          setSessionSnapshots((prev) => ({ ...prev, [sessionId]: snaps }));
        } catch {
          setSessionSnapshots((prev) => ({ ...prev, [sessionId]: [] }));
        } finally {
          setLoadingSnaps((prev) => {
            const s = new Set(prev);
            s.delete(sessionId);
            return s;
          });
        }
      }
    },
    [sessionSnapshots, loadingSnaps],
  );

  // -----------------------------------------------------------------------
  // Load session into Commander
  // -----------------------------------------------------------------------
  const handleSessionClick = useCallback(
    async (sessionId: string, focusRunId?: string): Promise<boolean> => {
      const api = getAPI();

      // Lazy-load session messages from SQLite if not yet hydrated
      const stored = sessions.find((s) => s.id === sessionId);
      if (!stored || hydratingSessionsRef.current.has(sessionId)) return false;
      let hydratedMessages: CommanderMessage[] | undefined;
      if (stored.messages.length === 0 && stored.messageCount > 0) {
        hydratingSessionsRef.current.add(sessionId);
        try {
          if (!api?.session) throw new Error('Session API is unavailable');
          const full = await api.session.get(sessionId);
          hydratedMessages = parseCommanderMessages(full.messages);
        } catch (error) {
          dispatch(
            enqueueToast({
              variant: 'warning',
              title: t('history.sessionLoadFailed'),
              message: error instanceof Error ? error.message : String(error),
            }),
          );
          return false;
        } finally {
          hydratingSessionsRef.current.delete(sessionId);
        }
      }

      // Wrap in startTransition so the heavy message list re-render
      // doesn't block INP (allows the click highlight to paint first).
      startTransition(() => {
        dispatch(loadSession({ id: sessionId, hydratedMessages }));
        if (focusRunId) {
          dispatch(focusAgentActivity({ sessionId, runId: focusRunId }));
        }
        if (stored.defaultCanvasId) {
          dispatch(setActiveCanvas(stored.defaultCanvasId));
        }
      });
      return true;
    },
    [sessions, dispatch, t],
  );

  const handleMoveSession = useCallback(
    async (sessionId: string, defaultCanvasId: string | null) => {
      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (!session || session.defaultCanvasId === defaultCanvasId || movingSessionId) return;
      if (sessionIsLocked(session)) {
        dispatch(enqueueToast({ variant: 'warning', title: t('history.stopBeforeMove') }));
        return;
      }

      setMovingSessionId(sessionId);
      try {
        const sessionApi = getAPI()?.session;
        if (!sessionApi?.move) throw new Error('Session move API is unavailable');
        await sessionApi.move(sessionId, defaultCanvasId);
        dispatch(moveSession({ id: sessionId, defaultCanvasId }));
      } catch (error) {
        dispatch(
          enqueueToast({
            variant: 'error',
            title: t('history.sessionMoveFailed'),
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        setMovingSessionId(null);
        setDraggedSessionId(null);
        setDragTargetGroupId(null);
      }
    },
    [dispatch, movingSessionId, sessionIsLocked, sessions, t],
  );

  const handleKeyboardMove = useCallback(
    (session: CommanderSession, direction: -1 | 1) => {
      const currentIndex = sessionGroups.findIndex(
        (group) => group.defaultCanvasId === session.defaultCanvasId,
      );
      const target = sessionGroups[currentIndex + direction];
      if (target) void handleMoveSession(session.id, target.defaultCanvasId);
    },
    [handleMoveSession, sessionGroups],
  );

  const handleDeleteSession = useCallback(
    async (session: CommanderSession) => {
      if (deletingSessionId) return;
      if (sessionIsLocked(session)) {
        dispatch(enqueueToast({ variant: 'warning', title: t('history.stopBeforeDelete') }));
        return;
      }
      const ok = await confirm({
        title: t('history.confirmDelete'),
        description: t('history.confirmDeleteDescription'),
        confirmLabel: t('history.delete'),
        destructive: true,
      });
      if (!ok) return;

      setDeletingSessionId(session.id);
      try {
        const sessionApi = getAPI()?.session;
        if (!sessionApi) throw new Error('Session API is unavailable');
        await sessionApi.delete(session.id);
        dispatch(deleteSession(session.id));
      } catch (error) {
        dispatch(
          enqueueToast({
            variant: 'error',
            title: t('history.sessionDeleteFailed'),
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      } finally {
        setDeletingSessionId(null);
      }
    },
    [confirm, deletingSessionId, dispatch, sessionIsLocked, t],
  );

  // -----------------------------------------------------------------------
  // Restore snapshot — reload canvas + entities (Task 7 + Task 8)
  // -----------------------------------------------------------------------
  const handleRestore = useCallback(
    async (snapId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (restoringSnap || isStreaming) return;

      // Confirmation dialog
      const ok = await confirm({
        title: t('history.confirmRestore'),
        description: t('history.confirmRestoreDescription'),
        confirmLabel: t('history.restore'),
        destructive: true,
      });
      if (!ok) return;

      const api = getAPI();
      setRestoringSnap(snapId);
      try {
        if (
          !api?.snapshot?.restore ||
          !api.canvas?.loadAll ||
          !api.character?.list ||
          !api.equipment?.list ||
          !api.location?.list
        ) {
          throw new Error('Snapshot restore APIs are unavailable');
        }
        await api.snapshot.restore(snapId);

        // --- Task 8: Reload canvas + entities after restore ---
        const [chars, equip, locs] = await Promise.all([
          api.character.list(),
          api.equipment.list(),
          api.location.list(),
        ]);
        dispatch(setCharacters(chars));
        dispatch(setEquipment(equip));
        dispatch(setLocations(locs));

        const loaded = await api.canvas.loadAll();
        dispatch(setCanvases(loaded));

        dispatch(
          enqueueToast({
            variant: 'success',
            title: t('history.restoreSuccess'),
            message: t('history.restoreSuccessMessage'),
          }),
        );
      } catch (err) {
        console.error('Snapshot restore failed', err);
        dispatch(
          enqueueToast({
            variant: 'error',
            title: t('history.restoreFailed'),
            message: t('history.restoreFailedMessage'),
          }),
        );
      } finally {
        setRestoringSnap(null);
      }
    },
    [restoringSnap, isStreaming, confirm, dispatch, t],
  );

  // -----------------------------------------------------------------------
  // Delete snapshot
  // -----------------------------------------------------------------------
  const handleDeleteSnapshot = useCallback(
    async (sessionId: string, snapId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (deletingSnapId) return;
      setDeletingSnapId(snapId);
      const api = getAPI();
      try {
        await api?.snapshot?.delete(snapId);
        setSessionSnapshots((prev) => ({
          ...prev,
          [sessionId]: (prev[sessionId] ?? []).filter((s) => s.id !== snapId),
        }));
      } catch {
        dispatch(
          enqueueToast({
            variant: 'error',
            title: t('history.deleteSnapshotFailed'),
          }),
        );
      } finally {
        setDeletingSnapId(null);
      }
    },
    [deletingSnapId, dispatch, t],
  );

  const handleTakeSnapshot = useCallback(async () => {
    if (!activeSessionId) return;
    const api = getAPI();
    try {
      await api?.snapshot?.capture(activeSessionId, t('history.manualSnapshot'), 'manual');
      const snaps = (await api?.snapshot?.list(activeSessionId)) ?? [];
      setSessionSnapshots((prev) => ({ ...prev, [activeSessionId]: snaps as SnapshotMeta[] }));
      dispatch(enqueueToast({ variant: 'success', title: t('history.snapshotCreated') }));
    } catch {
      dispatch(enqueueToast({ variant: 'error', title: t('history.snapshotFailed') }));
    }
  }, [activeSessionId, dispatch, t]);

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  return (
    <div className="flex h-full flex-col border-r border-border/60 bg-card">
      <div className="border-b border-border/60 p-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => dispatch(newSession(null))}
            className="flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md bg-muted px-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/70 disabled:opacity-30"
            title={t('commander.newChat')}
          >
            <Plus className="h-3.5 w-3.5" />
            {t('commander.newChat')}
          </button>
          <button
            type="button"
            onClick={() => void handleTakeSnapshot()}
            disabled={!activeSessionId}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
            title={t('history.takeSnapshot')}
            aria-label={t('history.takeSnapshot')}
          >
            <Camera className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="mt-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('history.search')}
            aria-label={t('history.search')}
            className="w-full rounded-md border border-border/60 bg-background/50 px-2 py-1.5 text-xs outline-none transition-colors focus:border-primary placeholder:text-muted-foreground/50"
          />
        </div>
      </div>

      {filteredSessions.length === 0 && searchQuery.trim() ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState icon={History} title={t('history.noResults')} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {sessionGroups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.id);
            const canvasId = group.defaultCanvasId;
            const isArchived = group.archivedAt !== undefined;
            const isRenamingCanvas = canvasId !== null && renamingCanvasId === canvasId;

            return (
              <section
                key={group.id}
                aria-label={group.label}
                onDragOver={(event) => {
                  if (!draggedSessionId || isArchived) return;
                  const dragged = sessions.find((session) => session.id === draggedSessionId);
                  if (!dragged || dragged.defaultCanvasId === group.defaultCanvasId) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDragTargetGroupId(group.id);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedSessionId && !isArchived) {
                    void handleMoveSession(draggedSessionId, group.defaultCanvasId);
                  }
                }}
                className={cn(
                  'mb-2 rounded-md last:mb-0',
                  isArchived && 'opacity-70',
                  dragTargetGroupId === group.id && 'bg-primary/10 ring-1 ring-primary/50',
                )}
              >
                <div className="flex min-w-0 items-center gap-0.5">
                  {isRenamingCanvas ? (
                    <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded px-1.5">
                      <input
                        ref={canvasRenameInputRef}
                        type="text"
                        value={canvasRenameValue}
                        aria-label={`${t('panels.renameCanvas')} — ${group.label}`}
                        onChange={(event) => setCanvasRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void commitCanvasRename(canvasId);
                          } else if (event.key === 'Escape') {
                            pendingCanvasRenameFocusRef.current = null;
                            setRenamingCanvasId(null);
                          }
                        }}
                        onBlur={() => void commitCanvasRename(canvasId)}
                        className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium outline-none focus:border-primary"
                      />
                      <span className="shrink-0 text-[10px] font-normal text-muted-foreground/70">
                        {group.sessions.length}
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-expanded={!isCollapsed}
                      aria-label={`${group.label} (${group.sessions.length})`}
                      onClick={() => toggleGroup(group.id)}
                      className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      )}
                      {isArchived ? (
                        <Archive className="h-3 w-3 shrink-0" aria-hidden="true" />
                      ) : null}
                      <span className="min-w-0 flex-1 truncate">{group.label}</span>
                      <span className="text-[10px] font-normal text-muted-foreground/70">
                        {group.sessions.length}
                      </span>
                    </button>
                  )}
                  {!isArchived ? (
                    <button
                      type="button"
                      onClick={() => dispatch(newSession(canvasId))}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      title={`${t('commander.newChat')} — ${group.label}`}
                      aria-label={`${t('commander.newChat')} — ${group.label}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  {canvasId ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          title={`${t('history.canvasActions')} — ${group.label}`}
                          aria-label={`${t('history.canvasActions')} — ${group.label}`}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="min-w-[10rem]"
                        onCloseAutoFocus={(event) => {
                          if (pendingCanvasRenameFocusRef.current === canvasId) {
                            event.preventDefault();
                            startCanvasRename(canvasId, group.label);
                          }
                        }}
                      >
                        {isArchived ? (
                          <>
                            <DropdownMenuItem
                              onSelect={() => void handleRestoreCanvas(canvasId)}
                              className="gap-2 text-xs"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              {t('history.restoreCanvas')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => void handleDeleteCanvasPermanently(canvasId)}
                              className="gap-2 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              {t('history.deletePermanently')}
                            </DropdownMenuItem>
                          </>
                        ) : (
                          <>
                            <DropdownMenuItem
                              onSelect={() => dispatch(setActiveCanvas(canvasId))}
                              className="gap-2 text-xs"
                            >
                              <FolderOpen className="h-3.5 w-3.5" />
                              {t('history.openCanvas')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                pendingCanvasRenameFocusRef.current = canvasId;
                              }}
                              className="gap-2 text-xs"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              {t('panels.renameCanvas')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() => void handleArchiveCanvas(canvasId)}
                              className="gap-2 text-xs"
                            >
                              <Archive className="h-3.5 w-3.5" />
                              {t('history.archiveCanvas')}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>

                {!isCollapsed ? (
                  <div className="mt-0.5 space-y-0.5">
                    {group.sessions.map((session) => {
                      const isExpanded = expandedSessions.has(session.id);
                      const snaps = sessionSnapshots[session.id];
                      const isLoadingSnaps = loadingSnaps.has(session.id);
                      const activity = activityBySessionId[session.id];
                      const activeRootRunId = activity?.hasActiveDescendant
                        ? activity.rootRunId
                        : null;
                      const isLocked = activity?.hasActiveDescendant ?? false;
                      const displayedMessageCount =
                        session.messages.length > 0
                          ? session.messages.length
                          : session.messageCount;

                      return (
                        <div key={session.id}>
                          <div className="group/session flex min-w-0 items-center gap-0.5">
                            {renamingSessionId === session.id ? (
                              <input
                                ref={renameInputRef}
                                type="text"
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    void commitRename(session.id);
                                  } else if (e.key === 'Escape') {
                                    setRenamingSessionId(null);
                                  }
                                }}
                                onBlur={() => void commitRename(session.id)}
                                className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-xs font-medium outline-none focus:border-primary"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => void handleSessionClick(session.id)}
                                draggable={movingSessionId !== session.id}
                                onDragStart={(event) => {
                                  if (isLocked) {
                                    event.preventDefault();
                                    dispatch(
                                      enqueueToast({
                                        variant: 'warning',
                                        title: t('history.stopBeforeMove'),
                                      }),
                                    );
                                    return;
                                  }
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', session.id);
                                  setDraggedSessionId(session.id);
                                }}
                                onDragEnd={() => {
                                  setDraggedSessionId(null);
                                  setDragTargetGroupId(null);
                                }}
                                onKeyDown={(event) => {
                                  if (
                                    !event.altKey ||
                                    !['ArrowUp', 'ArrowDown'].includes(event.key)
                                  ) {
                                    return;
                                  }
                                  event.preventDefault();
                                  handleKeyboardMove(session, event.key === 'ArrowUp' ? -1 : 1);
                                }}
                                aria-label={`${t('history.loadSession')} — ${session.title}`}
                                aria-describedby={`session-move-hint-${session.id}`}
                                aria-busy={movingSessionId === session.id}
                                className={cn(
                                  'flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted',
                                  activeSessionId === session.id && 'bg-primary/10 text-foreground',
                                )}
                                title={
                                  isLocked
                                    ? t('history.stopBeforeMove')
                                    : t('history.moveKeyboardHint')
                                }
                              >
                                <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-medium">
                                    {session.title}
                                  </span>
                                  <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                    <span>{formatDate(session.updatedAt)}</span>
                                    <span>
                                      {displayedMessageCount} {t('history.messages')}
                                    </span>
                                  </span>
                                </span>
                                <span id={`session-move-hint-${session.id}`} className="sr-only">
                                  {isLocked
                                    ? t('history.stopBeforeMove')
                                    : t('history.moveKeyboardHint')}
                                </span>
                              </button>
                            )}
                            {activity && activeRootRunId ? (
                              <ActivityTreeIndicator
                                summary={activity}
                                t={t}
                                onOpen={() => {
                                  void handleSessionClick(session.id, activeRootRunId);
                                }}
                              />
                            ) : null}
                            <button
                              type="button"
                              aria-label={t('history.snapshots')}
                              aria-expanded={isExpanded}
                              onClick={(event) => void handleToggleExpand(session.id, event)}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/session:opacity-100"
                            >
                              {isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingSessionId(session.id);
                                setRenameValue(session.title);
                              }}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/session:opacity-100"
                              title={t('history.renameSession')}
                              aria-label={t('history.renameSession')}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteSession(session)}
                              disabled={deletingSessionId === session.id}
                              aria-disabled={isLocked || deletingSessionId === session.id}
                              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive focus-visible:opacity-100 group-hover/session:opacity-100"
                              title={isLocked ? t('history.stopBeforeDelete') : t('history.delete')}
                              aria-label={`${t('history.delete')} — ${session.title}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          {isExpanded ? (
                            <div className="ml-7 mt-0.5 max-h-32 overflow-y-auto rounded border border-border/40 bg-muted/20">
                              <div className="space-y-0.5 p-1">
                                {isLoadingSnaps ? (
                                  <div className="px-1 py-0.5 text-[10px] text-muted-foreground">
                                    {t('history.loadingSnapshots')}
                                  </div>
                                ) : null}
                                {!isLoadingSnaps && (snaps ?? []).length === 0 ? (
                                  <div className="px-1 py-0.5 text-[10px] text-muted-foreground">
                                    {t('history.noSnapshots')}
                                  </div>
                                ) : null}
                                {(snaps ?? []).map((snap) => (
                                  <div
                                    key={snap.id}
                                    className="group/snap flex items-center gap-1.5 rounded px-2 py-1 hover:bg-muted/40"
                                  >
                                    <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-[10px]">
                                        {snap.label === 'Before Commander session'
                                          ? t('history.beforeSession')
                                          : snap.label || t('history.autoSnapshot')}
                                      </div>
                                      <div className="text-[9px] text-muted-foreground">
                                        {formatDate(snap.createdAt)}
                                        {snap.trigger === 'auto' ? (
                                          <span className="ml-1 rounded bg-muted px-1 py-px text-[8px]">
                                            {t('history.triggerAuto')}
                                          </span>
                                        ) : null}
                                        {snap.trigger === 'manual' ? (
                                          <span className="ml-1 rounded bg-primary/20 px-1 py-px text-[8px] text-primary">
                                            {t('history.triggerManual')}
                                          </span>
                                        ) : null}
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      title={t('history.restoreSnapshot')}
                                      aria-label={t('history.restoreSnapshot')}
                                      disabled={restoringSnap === snap.id || isStreaming}
                                      onClick={(event) => void handleRestore(snap.id, event)}
                                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover/snap:opacity-100 disabled:opacity-40"
                                    >
                                      <RotateCcw className="h-3 w-3" />
                                    </button>
                                    <button
                                      type="button"
                                      title={t('history.deleteSnapshot')}
                                      aria-label={t('history.deleteSnapshot')}
                                      disabled={deletingSnapId === snap.id}
                                      onClick={(event) =>
                                        void handleDeleteSnapshot(session.id, snap.id, event)
                                      }
                                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover/snap:opacity-100 disabled:opacity-40"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
      {ConfirmDialog}
    </div>
  );
}
