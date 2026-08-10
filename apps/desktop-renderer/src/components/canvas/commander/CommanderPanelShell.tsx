import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector, shallowEqual } from 'react-redux';
import { X, Zap } from 'lucide-react';
import type { RootState } from '../../../store/index.js';
import {
  setCommanderOpen,
  setPosition,
  selectPhase,
  dequeueMessage,
  resolveQuestion,
} from '../../../store/slices/commander.js';
import {
  selectCommanderView,
  selectActiveTodoSnapshot,
} from '../../../commander/state/commander-timeline-selectors.js';
import { useCommander } from '../../../hooks/useCommander.js';
import { useI18n } from '../../../hooks/use-i18n.js';
import { computeContextUsage } from '../../../commander/state/context-usage.js';
import {
  selectActiveCanvasNodes,
  selectNodesById,
} from '../../../store/slices/canvas/canvas-selectors.js';
import { usePanelDrag } from './usePanelDrag.js';
import { useSlashCommands } from './useSlashCommands.js';
import { MessageList } from './MessageList.js';
import { LiveActivityBar } from './LiveActivityBar.js';
import { PipelineRail } from './PipelineRail.js';
import { QuestionCard } from './QuestionCard.js';
import { CommanderHeader } from './CommanderHeader.js';
import { CommanderInputBar } from './CommanderInputBar.js';
import { CommanderStreamView } from './CommanderStreamView.js';
import type { Attachment } from './CommanderInputBar.js';
import { CommanderContext } from './CommanderContext.js';
import { markQuestionResolvedLocally } from '../../../commander/state/commander-timeline-slice.js';
import { getAPI } from '../../../utils/api.js';

const SAFE_Y = 56;

function useTextCursorGate(
  phase: import('../../../commander/state/run-phase.js').RunPhase,
): boolean {
  const [isFresh, setIsFresh] = useState(false);
  useEffect(() => {
    if (phase.kind !== 'model_streaming' || phase.lastTextDeltaAt === null) {
      setIsFresh(false);
      return;
    }
    const FRESH_WINDOW_MS = 500;
    const age = Date.now() - phase.lastTextDeltaAt;
    if (age >= FRESH_WINDOW_MS) {
      setIsFresh(false);
      return;
    }
    setIsFresh(true);
    const timer = window.setTimeout(() => setIsFresh(false), FRESH_WINDOW_MS - age);
    return () => window.clearTimeout(timer);
  }, [phase]);
  return isFresh;
}

const LS_KEY_FIRST_SESSION = 'lucid-commander-first-session-seen';

function FirstSessionHint({ show, t }: { show: boolean; t: (key: string) => string }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(LS_KEY_FIRST_SESSION) === '1';
    } catch {
      return false;
    }
  });
  if (!show || dismissed) return null;
  return (
    <div className="mb-2 flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
      <Zap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="flex-1">{t('commander.firstSessionHint')}</span>
      <button
        type="button"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => {
          setDismissed(true);
          try {
            localStorage.setItem(LS_KEY_FIRST_SESSION, '1');
          } catch {
            /* noop */
          }
        }}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

// X is used in FirstSessionHint above

export function CommanderPanelShell() {
  const dispatch = useDispatch();
  const { t } = useI18n();
  const { sendMessage, cancelCurrentStep, isStreaming } = useCommander();
  const isBackendReady = useSelector((state: RootState) => state.settings.bootstrapped);
  const phase = useSelector((state: RootState) => selectPhase(state));
  const showTextCursor = useTextCursorGate(phase);
  const open = useSelector((state: RootState) => state.commander.open);
  const minimized = useSelector((state: RootState) => state.commander.minimized);
  const position = useSelector((state: RootState) => state.commander.position, shallowEqual);
  const size = useSelector((state: RootState) => state.commander.size, shallowEqual);
  const maxTokens = useSelector((state: RootState) => state.commander.maxTokens);
  const maxSteps = useSelector((state: RootState) => state.commander.maxSteps);
  const backendContextUsage = useSelector(
    (state: RootState) => state.commander.backendContextUsage,
    shallowEqual,
  );
  const pendingInjectedMessages = useSelector(
    (state: RootState) => state.commander.pendingInjectedMessages,
    shallowEqual,
  );
  const consecutiveConfirmCount = useSelector(
    (state: RootState) => state.commander.consecutiveConfirmCount,
  );
  // Track activeCanvasId in a ref so IPC handlers can read the current value
  // without being stale in callbacks — avoids the direct store.getState() pattern.
  const activeCanvasId = useSelector((state: RootState) => state.canvas.activeCanvasId);
  const activeCanvasIdRef = useRef(activeCanvasId);
  useEffect(() => {
    activeCanvasIdRef.current = activeCanvasId;
  }, [activeCanvasId]);
  const derived = useSelector((state: RootState) => selectCommanderView(state));
  const todoSnapshot = useSelector(selectActiveTodoSnapshot);
  const messages = derived.messages;
  const currentStreamContent = derived.currentStreamContent;
  const currentToolCalls = derived.currentToolCalls;
  const currentSegments = derived.currentSegments;
  const pendingConfirmation = derived.pendingConfirmation;
  const pendingQuestion = derived.pendingQuestion;
  const error = derived.error;

  const canvasNodes = useSelector(selectActiveCanvasNodes);
  const nodesById = useSelector(selectNodesById);
  const nodeTitlesById = useMemo(
    () =>
      Object.fromEntries(
        (canvasNodes ?? []).map((node) => [node.id, node.title?.trim() || node.type]),
      ) as Record<string, string>,
    [canvasNodes],
  );
  const resolveNodeAssetHash = useCallback(
    (nodeId: string): string | undefined => {
      const node = nodesById.get(nodeId);
      if (!node) return undefined;
      const data = node.data as Record<string, unknown>;
      return typeof data.assetHash === 'string' ? data.assetHash : undefined;
    },
    [nodesById],
  );

  // ---- Local UI state --------------------------------------------------------
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editingQueueIndex, setEditingQueueIndex] = useState<number | null>(null);
  const [editingQueueText, setEditingQueueText] = useState('');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [permPickerOpen, setPermPickerOpen] = useState(false);
  const [nodePickerOpen, setNodePickerOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUpRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const wasDraggingRef = useRef(false);
  const sectionRef = useRef<HTMLElement>(null);
  // AbortController stored in ref so it can be aborted in cleanup effect
  const resizeAcRef = useRef<AbortController | null>(null);

  // Slash command system
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const {
    slashQuery: _slashQuery,
    slashMenuIndex,
    setSlashMenuIndex,
    showSlashMenu: slashMenuOpen,
    filteredCommands: filteredSlashItems,
    slashCommands: SLASH_COMMANDS,
    executeSlashCommand,
    triggerCompact,
  } = useSlashCommands({ t, input, setInput });

  // Scroll slash menu item into view
  useEffect(() => {
    if (!slashMenuOpen || !slashMenuRef.current) return;
    const container = slashMenuRef.current;
    const selected = container.children[slashMenuIndex] as HTMLElement | undefined;
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }, [slashMenuIndex, slashMenuOpen]);

  // Auto-expanding textarea
  const rafId = useRef(0);
  useEffect(() => {
    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 400)}px`;
    });
    return () => cancelAnimationFrame(rafId.current);
  }, [input]);

  const liveMessage = useMemo(() => {
    if (!isStreaming && currentToolCalls.length === 0 && currentStreamContent.length === 0) {
      return null;
    }
    return {
      id: 'streaming',
      role: 'assistant' as const,
      content: currentStreamContent,
      toolCalls: currentToolCalls,
    };
  }, [currentStreamContent, currentToolCalls, isStreaming]);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!modelPickerOpen && !nodePickerOpen && !permPickerOpen) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-dropdown-menu]')) {
        setModelPickerOpen(false);
        setNodePickerOpen(false);
        setPermPickerOpen(false);
      }
    };
    window.addEventListener('mousedown', handle);
    return () => window.removeEventListener('mousedown', handle);
  }, [modelPickerOpen, nodePickerOpen, permPickerOpen]);

  // Ctrl+J keyboard shortcut to toggle panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault();
        dispatch(setCommanderOpen(!open));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch, open]);

  // Auto-send next queued message when streaming finishes
  const prevStreamingRef = useRef(false);
  const hasMountedRef = useRef(false);
  const messageQueueRef = useRef<{ content: string }[]>([]);
  const messageQueue = useSelector(
    (state: RootState) => state.commander.messageQueue,
    shallowEqual,
  );
  messageQueueRef.current = messageQueue;
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      prevStreamingRef.current = isStreaming;
      return;
    }
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;
    if (wasStreaming && !isStreaming && messageQueueRef.current.length > 0) {
      const next = messageQueueRef.current[0];
      dispatch(dequeueMessage());
      void sendMessage(next.content);
    }
  }, [isStreaming, dispatch, sendMessage]);

  // Track scroll position
  useEffect(() => {
    const target = scrollRef.current;
    if (!target) return;
    const handleScroll = () => {
      const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
      userScrolledUpRef.current = distanceFromBottom > 80;
    };
    target.addEventListener('scroll', handleScroll, { passive: true });
    return () => target.removeEventListener('scroll', handleScroll);
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (!open) return;
    const target = scrollRef.current;
    if (!target) return;
    if (!userScrolledUpRef.current) {
      target.scrollTop = target.scrollHeight;
    }
  }, [currentStreamContent, currentToolCalls, messages, open]);

  usePanelDrag({ panelRef: sectionRef, open, size });

  // Context usage
  const contextUsage = useMemo(
    () =>
      computeContextUsage({
        messages,
        currentStreamContent,
        currentToolCalls,
        maxTokens,
        backendContextUsage,
      }),
    [maxTokens, messages, currentStreamContent, currentToolCalls, backendContextUsage],
  );

  // Auto-compact at 95%
  const autoCompactedRef = useRef(false);
  const lastCompactTimeRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    const cooldownMs = 10_000;
    if (
      contextUsage?.pct != null &&
      contextUsage.pct >= 95 &&
      !autoCompactedRef.current &&
      isStreaming &&
      now - lastCompactTimeRef.current > cooldownMs
    ) {
      autoCompactedRef.current = true;
      lastCompactTimeRef.current = now;
      void triggerCompact();
    }
    if (contextUsage?.pct != null && contextUsage.pct < 70) {
      autoCompactedRef.current = false;
    }
  }, [contextUsage?.pct, isStreaming, triggerCompact]);

  const handleNodeClick = useCallback((nodeId: string) => {
    window.dispatchEvent(new CustomEvent('commander:navigate-to-node', { detail: { nodeId } }));
  }, []);

  // ---- Resize handle — AbortController stored in ref, aborted in cleanup ----
  const handleResizeMouseDown = useCallback(
    (event: React.MouseEvent) => {
      // Abort any previous resize listener pair before starting a new one
      resizeAcRef.current?.abort();
      const ac = new AbortController();
      resizeAcRef.current = ac;

      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = size.width;
      const startHeight = size.height;

      document.addEventListener(
        'mousemove',
        (e: MouseEvent) => {
          const newWidth = Math.max(320, startWidth + (e.clientX - startX));
          const newHeight = Math.max(200, startHeight + (e.clientY - startY));
          const el = sectionRef.current;
          if (el) {
            el.style.width = `${newWidth}px`;
            el.style.height = `${newHeight}px`;
          }
        },
        { signal: ac.signal },
      );

      document.addEventListener(
        'mouseup',
        (e: MouseEvent) => {
          ac.abort();
          const el = sectionRef.current;
          if (el) {
            const newWidth = Math.max(320, startWidth + (e.clientX - startX));
            const newHeight = Math.max(200, startHeight + (e.clientY - startY));
            // Commit to DOM directly for now; size is not persisted to Redux
            // (to avoid a separate action — the panel drag already handles position)
            el.style.width = `${newWidth}px`;
            el.style.height = `${newHeight}px`;
          }
        },
        { signal: ac.signal },
      );
    },
    [size],
  );

  // Cleanup resize listeners on unmount
  useEffect(() => {
    return () => {
      resizeAcRef.current?.abort();
    };
  }, []);

  // ---- Header drag handler ---------------------------------------------------
  const handleHeaderMouseDown = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const target = event.currentTarget;
      target.dataset.dragOrigin = 'true';
      target.dataset.dragOffsetX = String(event.clientX - position.x);
      target.dataset.dragOffsetY = String(event.clientY - position.y);
    },
    [position],
  );

  const commanderContextValue = useMemo(
    () => ({
      input,
      setInput,
      inputRef,
      attachments,
      setAttachments,
      modelPickerOpen,
      setModelPickerOpen,
      permPickerOpen,
      setPermPickerOpen,
      nodePickerOpen,
      setNodePickerOpen,
      editingQueueIndex,
      setEditingQueueIndex,
      editingQueueText,
      setEditingQueueText,
      slashMenuRef,
      slashMenuOpen,
      slashMenuIndex,
      setSlashMenuIndex,
      filteredSlashItems,
      executeSlashCommand,
      SLASH_COMMANDS,
      canvasNodes: canvasNodes ?? undefined,
      contextUsage,
      triggerCompact,
      userScrolledUpRef,
      isBackendReady,
      t,
    }),
    [
      input,
      setInput,
      inputRef,
      attachments,
      setAttachments,
      modelPickerOpen,
      setModelPickerOpen,
      permPickerOpen,
      setPermPickerOpen,
      nodePickerOpen,
      setNodePickerOpen,
      editingQueueIndex,
      setEditingQueueIndex,
      editingQueueText,
      setEditingQueueText,
      slashMenuRef,
      slashMenuOpen,
      slashMenuIndex,
      setSlashMenuIndex,
      filteredSlashItems,
      executeSlashCommand,
      SLASH_COMMANDS,
      canvasNodes,
      contextUsage,
      triggerCompact,
      userScrolledUpRef,
      isBackendReady,
      t,
    ],
  );

  if (!open) return null;

  if (minimized) {
    return (
      <button
        type="button"
        className="fixed z-40 flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2.5 py-1.5 shadow-lg backdrop-blur-sm hover:bg-muted/80 transition-colors cursor-move"
        style={{ left: position.x, top: position.y }}
        onClick={() => {
          if (wasDraggingRef.current) {
            wasDraggingRef.current = false;
            return;
          }
          dispatch(setCommanderOpen(true));
        }}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          const target = event.currentTarget;
          const startX = event.clientX;
          const startY = event.clientY;
          target.dataset.dragOrigin = 'true';
          target.dataset.dragOffsetX = String(event.clientX - position.x);
          target.dataset.dragOffsetY = String(event.clientY - position.y);
          wasDraggingRef.current = false;

          const ac = new AbortController();
          const handleMouseMove = (e: MouseEvent) => {
            if (!target.dataset.dragOrigin) return;
            const dx = Math.abs(e.clientX - startX);
            const dy = Math.abs(e.clientY - startY);
            if (dx > 5 || dy > 5) wasDraggingRef.current = true;
            const offsetX = Number(target.dataset.dragOffsetX);
            const offsetY = Number(target.dataset.dragOffsetY);
            target.style.left = `${e.clientX - offsetX}px`;
            target.style.top = `${Math.max(SAFE_Y, e.clientY - offsetY)}px`;
          };
          const handleMouseUp = () => {
            delete target.dataset.dragOrigin;
            delete target.dataset.dragOffsetX;
            delete target.dataset.dragOffsetY;
            dispatch(
              setPosition({ x: parseInt(target.style.left), y: parseInt(target.style.top) }),
            );
            ac.abort();
          };
          document.addEventListener('mousemove', handleMouseMove, { signal: ac.signal });
          document.addEventListener('mouseup', handleMouseUp, { signal: ac.signal });
        }}
      >
        <Zap className="h-4 w-4 text-amber-400" />
        <span className="text-xs font-medium">{t('commander.commanderAI')}</span>
        {isStreaming && (
          <span role="status">
            <span className="sr-only">{t('commander.streaming')}</span>
            <span className="flex gap-0.5" aria-hidden="true">
              <span
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary"
                style={{ animationDelay: '0ms' }}
              />
              <span
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary"
                style={{ animationDelay: '150ms' }}
              />
              <span
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary"
                style={{ animationDelay: '300ms' }}
              />
            </span>
          </span>
        )}
      </button>
    );
  }

  return (
    <CommanderContext.Provider value={commanderContextValue}>
      <section
        ref={sectionRef}
        aria-label={t('commander.commanderAI')}
        className="fixed z-40 flex flex-col overflow-hidden rounded-lg border border-border/70 bg-card shadow-2xl backdrop-blur-sm"
        style={{
          left: position.x,
          top: position.y,
          width: size.width,
          height: size.height,
        }}
      >
        <CommanderHeader onMouseDown={handleHeaderMouseDown} t={t} />

        <div
          ref={scrollRef}
          data-testid="commander-message-scroll"
          aria-live="polite"
          aria-relevant="additions"
          className="flex min-w-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto px-3 py-2 pb-3"
        >
          <FirstSessionHint show={messages.length === 0 && !liveMessage} t={t} />
          <MessageList
            messages={messages}
            liveMessage={liveMessage}
            currentSegments={currentSegments}
            pendingInjectedMessages={pendingInjectedMessages}
            showTextCursor={showTextCursor}
            error={error}
            nodeTitlesById={nodeTitlesById}
            resolveNodeAssetHash={resolveNodeAssetHash}
            t={t}
            emptyLabel={t('commander.thinking')}
            onNodeClick={handleNodeClick}
            onSendMessage={(msg) => void sendMessage(msg)}
          />
        </div>

        <CommanderStreamView
          pendingConfirmation={pendingConfirmation}
          consecutiveConfirmCount={consecutiveConfirmCount}
          t={t}
        />

        <div className="relative shrink-0">
          <LiveActivityBar
            maxSteps={maxSteps}
            t={t}
            onCancelCurrentStep={() => void cancelCurrentStep()}
          />
          {/* Question card overlay — absolute so it covers the input area */}
          {pendingQuestion && (
            <div className="absolute inset-x-0 bottom-0 z-10 bg-card/95 backdrop-blur-[2px] rounded-b-lg border-t border-blue-500/30">
              <QuestionCard
                question={pendingQuestion.question}
                options={pendingQuestion.options}
                allowFreeText={pendingQuestion.allowFreeText}
                onAnswer={(answer) => {
                  const api = getAPI();
                  const canvasId = activeCanvasIdRef.current;
                  if (api?.commander && canvasId) {
                    void api.commander.answerQuestion(canvasId, pendingQuestion.toolCallId, answer);
                  }
                  dispatch(markQuestionResolvedLocally(pendingQuestion.toolCallId));
                  dispatch(resolveQuestion({ answer }));
                }}
                t={t}
              />
            </div>
          )}
          <PipelineRail snapshot={todoSnapshot} isStreaming={isStreaming} t={t} />
          <CommanderInputBar />
        </div>

        {/* Resize handle — memory-safe: AbortController aborted in cleanup effect */}
        <div
          className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
          onMouseDown={handleResizeMouseDown}
        />
      </section>
    </CommanderContext.Provider>
  );
}
