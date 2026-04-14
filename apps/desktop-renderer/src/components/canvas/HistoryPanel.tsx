import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  History,
  Plus,
  Trash2,
  MessageSquare,
  ChevronRight,
  ChevronDown,
  Clock,
  RotateCcw,
  Pencil,
} from 'lucide-react';
import type { RootState } from '../../store/index.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { newSession, loadSession, deleteSession, renameSession } from '../../store/slices/commander.js';
import { setCharacters } from '../../store/slices/characters.js';
import { setEquipment } from '../../store/slices/equipment.js';
import { setLocations } from '../../store/slices/locations.js';
import { setCanvases } from '../../store/slices/canvas.js';
import { enqueueToast } from '../../store/slices/toast.js';
import { cn } from '../../lib/utils.js';
import { getAPI } from '../../utils/api.js';

/** Snapshot metadata returned from the IPC layer (no heavy data blob). */
interface SnapshotMeta {
  id: string;
  sessionId: string;
  label: string;
  trigger: string;
  createdAt: number;
}

function formatDate(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
}

export function HistoryPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const sessions = useSelector((state: RootState) => state.commander.sessions);
  const activeSessionId = useSelector((state: RootState) => state.commander.activeSessionId);
  const isStreaming = useSelector((state: RootState) => state.commander.streaming);
  const activeCanvasId = useSelector((state: RootState) => state.canvas.activeCanvasId);

  // --- Snapshot-related local state ---
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [sessionSnapshots, setSessionSnapshots] = useState<Record<string, SnapshotMeta[]>>({});
  const [loadingSnaps, setLoadingSnaps] = useState<Set<string>>(new Set());
  const [restoringSnap, setRestoringSnap] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');

  // --- Rename state ---
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.messages.some((m) => m.content.toLowerCase().includes(q)),
    );
  }, [sessions, searchQuery]);

  useEffect(() => {
    if (renamingSessionId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingSessionId]);

  const commitRename = useCallback(
    (sessionId: string) => {
      const trimmed = renameValue.trim();
      if (trimmed && trimmed.length > 0) {
        dispatch(renameSession({ id: sessionId, title: trimmed }));
        // Persist to SQLite
        const session = sessions.find((s) => s.id === sessionId);
        if (session) {
          getAPI()?.session?.upsert({
            id: sessionId,
            canvasId: activeCanvasId ?? null,
            title: trimmed,
            messages: JSON.stringify(session.messages),
            createdAt: session.createdAt,
            updatedAt: Date.now(),
          });
        }
      }
      setRenamingSessionId(null);
    },
    [renameValue, dispatch, sessions, activeCanvasId],
  );

  // -----------------------------------------------------------------------
  // Session click — toggle expand + load messages lazily + load snapshots
  // -----------------------------------------------------------------------
  const handleSessionClick = useCallback(
    async (sessionId: string) => {
      if (isStreaming) return;
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

      // Load session messages lazily into commander store
      if (activeSessionId !== sessionId) {
        const stored = sessions.find((s) => s.id === sessionId);
        if (stored && stored.messages.length === 0 && api?.session) {
          try {
            const full = await api.session.get(sessionId);
            const msgs = JSON.parse(full.messages);
            // Patch messages into the session before loading
            stored.messages = msgs;
          } catch {
            /* session fetch failed — fall through to loadSession with empty messages */
          }
        }
        dispatch(loadSession(sessionId));
      }

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
    [isStreaming, activeSessionId, sessions, sessionSnapshots, loadingSnaps, dispatch],
  );

  // -----------------------------------------------------------------------
  // Restore snapshot — reload canvas + entities (Task 7 + Task 8)
  // -----------------------------------------------------------------------
  const handleRestore = useCallback(
    async (snapId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (restoringSnap || isStreaming) return;

      // Confirmation dialog
      if (!confirm(t('history.confirmRestore'))) return;

      const api = getAPI();
      setRestoringSnap(snapId);
      try {
        await api?.snapshot?.restore(snapId);

        // --- Task 8: Reload canvas + entities after restore ---
        const [chars, equip, locs] = await Promise.all([
          api?.character?.list() ?? [],
          api?.equipment?.list() ?? [],
          api?.location?.list() ?? [],
        ]);
        dispatch(setCharacters(chars));
        dispatch(setEquipment(equip));
        dispatch(setLocations(locs));

        // Reload all canvases from SQLite (snapshot may have changed canvas data)
        try {
          const listed = await api?.canvas?.list();
          if (Array.isArray(listed) && listed.length > 0) {
            const loaded = await Promise.all(
              listed.map((item) => api!.canvas.load(item.id)),
            );
            dispatch(setCanvases(loaded));
          }
        } catch {
          /* canvas reload failed — entities are still refreshed */
        }

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
    [restoringSnap, isStreaming, dispatch, t],
  );

  // -----------------------------------------------------------------------
  // Delete snapshot
  // -----------------------------------------------------------------------
  const handleDeleteSnapshot = useCallback(
    async (sessionId: string, snapId: string, e: React.MouseEvent) => {
      e.stopPropagation();
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
      }
    },
    [dispatch, t],
  );

  return (
    <div className="h-full bg-card border-l border-border/60 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60">
        <div className="flex items-center gap-2">
          <History className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{t('history.title')}</span>
        </div>
        <button
          type="button"
          onClick={() => dispatch(newSession())}
          disabled={isStreaming}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
          title={t('history.newSession')}
        >
          <Plus className="w-3 h-3" />
          {t('history.newSession')}
        </button>
      </div>

      <div className="px-2 py-1.5 border-b border-border/60">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('history.search')}
          className="w-full rounded bg-muted/50 border border-border/40 px-2 py-1 text-xs outline-none focus:border-primary placeholder:text-muted-foreground/50"
        />
      </div>

      {filteredSessions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground px-3 text-center">
          {searchQuery.trim() ? t('history.noResults') : t('history.empty')}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {filteredSessions.map((session) => {
            const isExpanded = expandedSessions.has(session.id);
            const snaps = sessionSnapshots[session.id];
            const isLoadingSnaps = loadingSnaps.has(session.id);

            return (
              <div key={session.id}>
                {/* Session row */}
                <div
                  className={cn(
                    'group flex items-start gap-2 rounded-md px-2.5 py-2 cursor-pointer transition-colors hover:bg-muted/60',
                    activeSessionId === session.id && 'bg-primary/10 border border-primary/20',
                  )}
                  onClick={() => void handleSessionClick(session.id)}
                >
                  {/* Expand/collapse chevron */}
                  <span className="mt-0.5 shrink-0 text-muted-foreground">
                    {isExpanded ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                  </span>
                  <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    {renamingSessionId === session.id ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitRename(session.id);
                          } else if (e.key === 'Escape') {
                            setRenamingSessionId(null);
                          }
                        }}
                        onBlur={() => commitRename(session.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full text-xs font-medium bg-background border border-border rounded px-1 py-0 outline-none focus:border-primary"
                      />
                    ) : (
                      <div
                        className="text-xs font-medium truncate"
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          setRenamingSessionId(session.id);
                          setRenameValue(session.title);
                        }}
                      >
                        {session.title}
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{formatDate(session.updatedAt)}</span>
                      <span>
                        {session.messages.length} {t('history.messages')}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingSessionId(session.id);
                      setRenameValue(session.title);
                    }}
                    className="hidden group-hover:flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground"
                    title={t('history.renameSession')}
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch(deleteSession(session.id));
                    }}
                    className="hidden group-hover:flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:text-destructive"
                    title={t('history.delete')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                {/* Snapshot sub-list (expanded) */}
                {isExpanded && (
                  <div className="ml-5 mt-1 space-y-0.5">
                    {isLoadingSnaps && (
                      <div className="text-[10px] text-muted-foreground px-1 py-0.5">
                        {t('history.loadingSnapshots')}
                      </div>
                    )}
                    {!isLoadingSnaps && (snaps ?? []).length === 0 && (
                      <div className="text-[10px] text-muted-foreground px-1 py-0.5">
                        {t('history.noSnapshots')}
                      </div>
                    )}
                    {(snaps ?? []).map((snap) => (
                      <div
                        key={snap.id}
                        className="group/snap flex items-center gap-1.5 rounded px-2 py-1 hover:bg-muted/40"
                      >
                        <Clock className="w-3 h-3 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] truncate">
                            {snap.label || t('history.autoSnapshot')}
                          </div>
                          <div className="text-[9px] text-muted-foreground">
                            {formatDate(snap.createdAt)}
                            {snap.trigger === 'auto' && (
                              <span className="ml-1 text-[8px] rounded bg-muted px-1 py-px">
                                auto
                              </span>
                            )}
                            {snap.trigger === 'manual' && (
                              <span className="ml-1 text-[8px] rounded bg-primary/20 text-primary px-1 py-px">
                                manual
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          title={t('history.restoreSnapshot')}
                          disabled={restoringSnap === snap.id || isStreaming}
                          onClick={(e) => void handleRestore(snap.id, e)}
                          className="hidden group-hover/snap:flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-primary disabled:opacity-40"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          title={t('history.deleteSnapshot')}
                          onClick={(e) => void handleDeleteSnapshot(session.id, snap.id, e)}
                          className="hidden group-hover/snap:flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
