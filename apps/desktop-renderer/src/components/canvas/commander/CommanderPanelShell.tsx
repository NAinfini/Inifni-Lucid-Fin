import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Zap } from 'lucide-react';
import { useDispatch, useSelector, shallowEqual } from 'react-redux';

import type { RootState } from '../../../store/index.js';
import {
  dequeueMessage,
  addSystemNotice,
  clearAgentActivityFocus,
  focusAgentActivity,
  selectActiveCommanderSession,
  selectBackendContextUsage,
  selectConsecutiveConfirmCount,
  selectMessageQueue,
  selectMessageQueueCursor,
  selectPendingInjectedMessages,
  setPosition,
  setSize,
  setCommanderOpen,
} from '../../../store/slices/commander.js';
import {
  selectAgentActivityTreeForSession,
  selectAgentActivityTreeContainingRunForSession,
  selectCommanderView,
  selectCurrentRunId,
  selectLatestRunCapabilityCatalog,
} from '../../../commander/state/commander-timeline-selectors.js';
import { useCommander } from '../../../hooks/useCommander.js';
import { useI18n } from '../../../hooks/use-i18n.js';
import { computeContextUsage } from '../../../commander/state/context-usage.js';
import {
  DEFAULT_COMMANDER_PANEL_HEIGHT,
  DEFAULT_COMMANDER_PANEL_WIDTH,
} from '../../../commander/state/constants.js';
import {
  selectActiveCanvas,
  selectActiveCanvasNodes,
} from '../../../store/slices/canvas/canvas-selectors.js';
import { MessageList } from './MessageList.js';
import { QuestionCard } from './QuestionCard.js';
import { CommanderHeader } from './CommanderHeader.js';
import { CommanderInputBar } from './CommanderInputBar.js';
import { CommanderStreamView } from './CommanderStreamView.js';
import type { Attachment } from './CommanderInputBar.js';
import { CommanderContext } from './CommanderContext.js';
import { useSlashCommands } from './useSlashCommands.js';
import {
  clampPanelGeometry,
  clampPanelPosition,
  getCommanderResizeWidthBounds,
  usePanelDrag,
} from './usePanelDrag.js';
import { CommanderPlanApproval } from './CommanderPlanApproval.js';
import {
  appendEvent as appendTimelineEvent,
  markQuestionResolvedLocally,
} from '../../../commander/state/commander-timeline-slice.js';
import { loadTaskListTasks, loadTaskLists } from '../../../store/slices/task-lists.js';
import { getAPI } from '../../../utils/api.js';
import { AgentActivityControl } from './AgentActivityControl.js';
import { fetchPublicRunTreeEvents } from '../../../commander/transport/fetch-public-run-tree-events.js';
import {
  isTaskProgressActive,
  selectCurrentTaskListForSession,
} from './task-list-session.js';

function ConversationActions({
  currentRunId,
  pendingQuestion,
  pendingConfirmation,
  consecutiveConfirmCount,
  onAnswer,
  t,
}: {
  currentRunId: string | null;
  pendingQuestion: ReturnType<typeof selectCommanderView>['pendingQuestion'];
  pendingConfirmation: ReturnType<typeof selectCommanderView>['pendingConfirmation'];
  consecutiveConfirmCount: number;
  onAnswer: (toolCallId: string, answer: string) => Promise<void>;
  t: (key: string) => string;
}) {
  const [answeringQuestionId, setAnsweringQuestionId] = useState<string | null>(null);
  const [questionError, setQuestionError] = useState<string | null>(null);

  useEffect(() => {
    setAnsweringQuestionId(null);
    setQuestionError(null);
  }, [pendingQuestion?.toolCallId]);

  const count = (pendingQuestion ? 1 : 0) + (pendingConfirmation ? 1 : 0);

  if (count === 0) return null;

  const answerQuestion = async (toolCallId: string, answer: string) => {
    setAnsweringQuestionId(toolCallId);
    setQuestionError(null);
    try {
      await onAnswer(toolCallId, answer);
    } catch (error) {
      setQuestionError(
        error instanceof Error ? error.message : t('commander.question.answerFailed'),
      );
    } finally {
      setAnsweringQuestionId(null);
    }
  };

  return (
    <section aria-label={t('commander.attentionTray')} className="mt-5 space-y-3 pb-2">
      {pendingQuestion ? (
        <article aria-labelledby={`commander-question-${pendingQuestion.toolCallId}`}>
          <QuestionCard
            key={pendingQuestion.toolCallId}
            id={`commander-question-${pendingQuestion.toolCallId}`}
            question={pendingQuestion.question}
            options={pendingQuestion.options}
            allowFreeText={pendingQuestion.allowFreeText}
            disabled={answeringQuestionId !== null}
            status={
              answeringQuestionId === pendingQuestion.toolCallId
                ? t('commander.question.saving')
                : null
            }
            error={questionError}
            onAnswer={(answer) => answerQuestion(pendingQuestion.toolCallId, answer)}
            t={t}
          />
        </article>
      ) : null}

      {pendingConfirmation ? (
        <CommanderStreamView
          pendingConfirmation={pendingConfirmation}
          consecutiveConfirmCount={consecutiveConfirmCount}
          currentRunId={currentRunId}
          t={t}
        />
      ) : null}
    </section>
  );
}

export function CommanderPanelShell() {
  const dispatch = useDispatch();
  const { t } = useI18n();
  const { sendMessage, sendIntent, isStreaming } = useCommander();
  const isBackendReady = useSelector((state: RootState) => state.settings.bootstrapped);
  const open = useSelector((state: RootState) => state.commander.open);
  const minimized = useSelector((state: RootState) => state.commander.minimized);
  const position = useSelector((state: RootState) => state.commander.position, shallowEqual);
  const size = useSelector((state: RootState) => state.commander.size, shallowEqual);
  const activeCanvas = useSelector(selectActiveCanvas);
  const activeCanvasId = activeCanvas?.id ?? null;
  const activeSession = useSelector(selectActiveCommanderSession);
  const activeSessionId = activeSession?.id ?? null;
  const activityFocusRunId = useSelector((state: RootState) =>
    state.commander.activityFocus?.sessionId === activeSessionId
      ? (state.commander.activityFocus.runId ?? null)
      : null,
  );
  const defaultCanvasId = activeSession?.defaultCanvasId ?? null;
  const defaultCanvasLabel = useSelector((state: RootState) =>
    defaultCanvasId ? (state.canvas.canvases.entities[defaultCanvasId]?.name ?? null) : null,
  );
  const currentRunId = useSelector(selectCurrentRunId);
  const contextWindowTokens = useSelector(
    (state: RootState) => state.commander.contextWindowTokens,
  );
  const backendContextUsage = useSelector(selectBackendContextUsage, shallowEqual);
  const pendingInjectedMessages = useSelector(selectPendingInjectedMessages, shallowEqual);
  const consecutiveConfirmCount = useSelector(selectConsecutiveConfirmCount);
  const messageQueue = useSelector(selectMessageQueue, shallowEqual);
  const messageQueueCursor = useSelector(selectMessageQueueCursor);
  const derived = useSelector((state: RootState) => selectCommanderView(state));
  const capabilityCatalog = useSelector(selectLatestRunCapabilityCatalog);
  const activeActivityTree = useSelector((state: RootState) =>
    selectAgentActivityTreeForSession(state, activeSessionId),
  );
  const focusedActivityTree = useSelector((state: RootState) =>
    activityFocusRunId
      ? selectAgentActivityTreeContainingRunForSession(state, activeSessionId, activityFocusRunId)
      : null,
  );
  const sessionTaskLists = useSelector(
    (state: RootState) =>
      state.taskLists.allIds.flatMap((id) => {
        const taskList = state.taskLists.summariesById[id];
        return taskList ? [taskList] : [];
      }),
    shallowEqual,
  );
  const currentTaskList = useMemo(
    () => selectCurrentTaskListForSession(sessionTaskLists, activeSessionId),
    [activeSessionId, sessionTaskLists],
  );
  const currentTaskListTasks = useSelector((state: RootState) =>
    currentTaskList ? state.taskLists.tasksByTaskListId[currentTaskList.id] : undefined,
  );
  const canvasNodes = useSelector(selectActiveCanvasNodes);

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editingQueueIndex, setEditingQueueIndex] = useState<number | null>(null);
  const [editingQueueText, setEditingQueueText] = useState('');
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [permPickerOpen, setPermPickerOpen] = useState(false);
  const [nodePickerOpen, setNodePickerOpen] = useState(false);
  const hasActiveRun = activeActivityTree?.hasActiveDescendant ?? false;
  const taskProgressActive = isTaskProgressActive(hasActiveRun, currentTaskList);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUpRef = useRef(false);
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  usePanelDrag({ panelRef, open, position, size });

  useEffect(() => {
    if (activeSessionId) dispatch(loadTaskLists({}));
  }, [activeSessionId, dispatch]);

  useEffect(() => {
    if (taskProgressActive && currentTaskList) {
      dispatch(loadTaskListTasks(currentTaskList.id));
    }
  }, [currentTaskList?.id, currentTaskList?.updatedAt, dispatch, taskProgressActive]);

  const movePanel = useCallback(
    (next: { x: number; y: number }, compact = false) => {
      const renderedSize = compact
        ? {
            width: panelRef.current?.offsetWidth || 152,
            height: panelRef.current?.offsetHeight || 44,
          }
        : size;
      dispatch(
        setPosition(
          clampPanelPosition(next, renderedSize, {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        ),
      );
    },
    [dispatch, size],
  );

  const resizePanel = useCallback(
    (next: { width: number; height: number }) => {
      const clamped = clampPanelGeometry(position, next, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      dispatch(setPosition(clamped.position));
      dispatch(setSize(clamped.size));
    },
    [dispatch, position],
  );

  useEffect(() => {
    if (!activeSessionId) return;
    let disposed = false;

    const hydratePublicRunTree = async () => {
      try {
        const events = await fetchPublicRunTreeEvents(activeSessionId);
        if (disposed) return;
        for (const event of events) {
          dispatch(appendTimelineEvent({ sessionId: activeSessionId, event }));
        }
      } catch {
        // Live stream delivery remains the source of truth when historical hydration is unavailable.
      }
    };

    void hydratePublicRunTree();
    return () => {
      disposed = true;
    };
  }, [activeSessionId, dispatch]);

  const {
    slashMenuIndex,
    setSlashMenuIndex,
    showSlashMenu: slashMenuOpen,
    filteredCommands: filteredSlashItems,
    slashCommands: slashCommands,
    executeSlashCommand,
    triggerCompact,
  } = useSlashCommands({ t, input, setInput });

  const contextUsage = useMemo(
    () =>
      computeContextUsage({
        messages: derived.messages,
        currentStreamContent: derived.currentStreamContent,
        currentToolCalls: derived.currentToolCalls,
        contextWindowTokens,
        backendContextUsage,
      }),
    [
      backendContextUsage,
      derived.currentStreamContent,
      derived.currentToolCalls,
      derived.messages,
      contextWindowTokens,
    ],
  );

  useEffect(() => {
    if (!modelPickerOpen && !nodePickerOpen && !permPickerOpen) return;
    const closeDropdowns = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('[data-dropdown-menu]')) {
        setModelPickerOpen(false);
        setNodePickerOpen(false);
        setPermPickerOpen(false);
      }
    };
    window.addEventListener('mousedown', closeDropdowns);
    return () => window.removeEventListener('mousedown', closeDropdowns);
  }, [modelPickerOpen, nodePickerOpen, permPickerOpen]);

  useEffect(() => {
    const inputElement = inputRef.current;
    if (!inputElement) return;
    inputElement.style.height = 'auto';
    inputElement.style.height = `${Math.min(inputElement.scrollHeight, 120)}px`;
  }, [input]);

  useEffect(() => {
    if (!slashMenuOpen || !slashMenuRef.current) return;
    const selected = slashMenuRef.current.children[slashMenuIndex] as HTMLElement | undefined;
    selected?.scrollIntoView?.({ block: 'nearest' });
  }, [slashMenuIndex, slashMenuOpen]);

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

  useEffect(() => {
    if (userScrolledUpRef.current) return;
    const target = scrollRef.current;
    if (target) target.scrollTop = target.scrollHeight;
  }, [
    derived.currentStreamContent,
    derived.currentToolCalls,
    derived.messages,
    derived.pendingConfirmation?.toolCallId,
    derived.pendingQuestion?.toolCallId,
  ]);

  const revealNewConversationContent = useCallback(() => {
    if (userScrolledUpRef.current) return;
    const target = scrollRef.current;
    if (target) target.scrollTop = target.scrollHeight;
  }, []);

  const submitMessage = useCallback(
    async (
      message: string,
      resources: {
        attachments?: Array<{ assetEntryId: string; role: 'reference' }>;
        selectedNodes?: Array<{ canvasId: string; nodeId: string }>;
        extraCanvasIds?: string[];
      } = {},
    ): Promise<boolean> => {
      const hasResources =
        (resources.attachments?.length ?? 0) > 0 ||
        (resources.selectedNodes?.length ?? 0) > 0 ||
        (resources.extraCanvasIds?.length ?? 0) > 0;
      return hasResources ? sendMessage(message, resources) : sendMessage(message);
    },
    [sendMessage],
  );

  const sendingQueuedMessageRef = useRef(false);
  useEffect(() => {
    if (
      isStreaming ||
      messageQueueCursor >= messageQueue.length ||
      sendingQueuedMessageRef.current
    ) {
      return;
    }
    const next = messageQueue[messageQueueCursor];
    sendingQueuedMessageRef.current = true;
    const submission = next.intent
      ? sendIntent(next.intent, { extraCanvasIds: next.extraCanvasIds })
      : submitMessage(next.content, { extraCanvasIds: next.extraCanvasIds });
    void submission
      .then((accepted) => {
        if (accepted && activeSessionId) {
          dispatch(dequeueMessage(activeSessionId));
        }
      })
      .catch((error: unknown) => {
        if (activeSessionId) {
          dispatch(
            addSystemNotice({
              sessionId: activeSessionId,
              content: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      })
      .finally(() => {
        sendingQueuedMessageRef.current = false;
      });
  }, [
    activeSessionId,
    dispatch,
    isStreaming,
    messageQueue,
    messageQueueCursor,
    sendIntent,
    submitMessage,
  ]);

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
      void triggerCompact({ silent: true });
    }
    if (contextUsage?.pct != null && contextUsage.pct < 70) {
      autoCompactedRef.current = false;
    }
  }, [contextUsage?.pct, isStreaming, triggerCompact]);

  const handleNodeClick = useCallback((nodeId: string) => {
    window.dispatchEvent(new CustomEvent('commander:navigate-to-node', { detail: { nodeId } }));
  }, []);

  const openActivityFromHistory = useCallback(
    (runId: string) => {
      if (!activeSessionId) return;
      if (activityFocusRunId === runId) dispatch(clearAgentActivityFocus());
      else dispatch(focusAgentActivity({ sessionId: activeSessionId, runId }));
    },
    [activeSessionId, activityFocusRunId, dispatch],
  );

  const answerQuestion = useCallback(
    async (toolCallId: string, answer: string) => {
      const api = getAPI();
      if (!api?.commander || !activeSessionId || !currentRunId) {
        throw new Error(t('commander.question.answerUnavailable'));
      }
      const result = await api.commander.toolAnswer({
        sessionId: activeSessionId,
        runId: currentRunId,
        toolCallId,
        answer,
      });
      if (!result.accepted) {
        throw new Error(t('commander.question.answerRejected').replace('{code}', result.code));
      }
      dispatch(
        markQuestionResolvedLocally({
          sessionId: activeSessionId,
          runId: currentRunId,
          toolCallId,
        }),
      );
    },
    [activeSessionId, currentRunId, dispatch, t],
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
      SLASH_COMMANDS: slashCommands,
      canvasNodes: canvasNodes ?? undefined,
      viewedCanvasId: activeCanvasId,
      contextUsage,
      triggerCompact,
      userScrolledUpRef,
      isBackendReady,
      submitMessage,
      t,
    }),
    [
      attachments,
      activeCanvasId,
      canvasNodes,
      contextUsage,
      editingQueueIndex,
      editingQueueText,
      executeSlashCommand,
      filteredSlashItems,
      input,
      isBackendReady,
      modelPickerOpen,
      nodePickerOpen,
      permPickerOpen,
      slashCommands,
      setSlashMenuIndex,
      slashMenuIndex,
      slashMenuOpen,
      submitMessage,
      t,
      triggerCompact,
    ],
  );

  if (!open) return null;

  if (minimized) {
    return (
      <button
        ref={(node) => {
          panelRef.current = node;
        }}
        type="button"
        aria-label={t('commander.commanderAI')}
        className="fixed z-40 flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 text-xs font-medium shadow-xl hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        style={{ left: position.x, top: position.y }}
        data-drag-origin="false"
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          const origin = event.currentTarget;
          origin.dataset.dragOrigin = 'true';
          origin.dataset.dragMoved = 'false';
          origin.dataset.dragStartX = String(event.clientX);
          origin.dataset.dragStartY = String(event.clientY);
          origin.dataset.dragOffsetX = String(event.clientX - position.x);
          origin.dataset.dragOffsetY = String(event.clientY - position.y);
        }}
        onClick={(event) => {
          const moved = event.currentTarget.dataset.dragMoved === 'true';
          delete event.currentTarget.dataset.dragMoved;
          if (!moved) dispatch(setCommanderOpen(true));
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 24 : 8;
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key))
            return;
          event.preventDefault();
          if (event.key === 'Home') movePanel({ x: 24, y: 96 }, true);
          else
            movePanel(
              {
                x:
                  position.x +
                  (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
                y:
                  position.y +
                  (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
              },
              true,
            );
        }}
      >
        <Zap className="h-4 w-4 text-amber-400" />
        {t('commander.commanderAI')}
        {isStreaming ? (
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
        ) : null}
      </button>
    );
  }

  const resizeWidthBounds = getCommanderResizeWidthBounds(window.innerWidth);

  return (
    <CommanderContext.Provider value={commanderContextValue}>
      <section
        ref={panelRef}
        aria-label={t('commander.commanderAI')}
        className="fixed z-40 flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-2xl transition-[width] duration-200 ease-out max-[720px]:!bottom-2 max-[720px]:!left-2 max-[720px]:!right-2 max-[720px]:!top-14 max-[720px]:!h-auto max-[720px]:!w-auto max-[720px]:rounded-lg"
        style={{
          left: position.x,
          top: position.y,
          width: size.width,
          height: size.height,
          maxWidth: `calc(100vw - ${Math.max(position.x + 16, 32)}px)`,
          maxHeight: `calc(100vh - ${Math.max(position.y + 16, 72)}px)`,
        }}
      >
        <div
          data-drag-origin="false"
          className="shrink-0 cursor-move"
          role="toolbar"
          aria-label={t('commander.moveDock')}
          tabIndex={0}
          onMouseDown={(event) => {
            if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
            const origin = event.currentTarget;
            origin.dataset.dragOrigin = 'true';
            origin.dataset.dragMoved = 'false';
            origin.dataset.dragStartX = String(event.clientX);
            origin.dataset.dragStartY = String(event.clientY);
            origin.dataset.dragOffsetX = String(event.clientX - position.x);
            origin.dataset.dragOffsetY = String(event.clientY - position.y);
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            const step = event.shiftKey ? 24 : 8;
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key))
              return;
            event.preventDefault();
            if (event.key === 'Home') movePanel({ x: 24, y: 96 });
            else
              movePanel({
                x:
                  position.x +
                  (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
                y:
                  position.y +
                  (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
              });
          }}
        >
          <CommanderHeader
            canvasLabel={defaultCanvasLabel}
            capabilityCatalog={capabilityCatalog}
            t={t}
          />
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            data-testid="commander-message-scroll"
            aria-live="polite"
            aria-relevant="additions"
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-6 py-6"
          >
            <MessageList
              messages={derived.messages}
              hasActiveRun={hasActiveRun}
              pendingInjectedMessages={pendingInjectedMessages}
              error={derived.error}
              t={t}
              emptyLabel={t('commander.emptyState')}
              onNodeClick={handleNodeClick}
              onViewActivity={openActivityFromHistory}
              expandedActivityRunId={activityFocusRunId}
              activityContent={
                activityFocusRunId && focusedActivityTree ? (
                  <AgentActivityControl
                    key={`${activeSessionId ?? 'new-session'}:${activityFocusRunId}`}
                    sessionId={activeSessionId}
                    tree={focusedActivityTree}
                    taskList={taskProgressActive ? currentTaskList : null}
                    taskListTasks={taskProgressActive ? currentTaskListTasks : undefined}
                    focusRunId={activityFocusRunId}
                    inline
                    t={t}
                  />
                ) : null
              }
            />

            <CommanderPlanApproval
              key={activeSessionId ?? 'new-session'}
              canvasId={defaultCanvasId}
              sessionId={activeSessionId}
              t={t}
              onContentChange={revealNewConversationContent}
            />

            <ConversationActions
              currentRunId={currentRunId}
              pendingQuestion={derived.pendingQuestion}
              pendingConfirmation={derived.pendingConfirmation}
              consecutiveConfirmCount={consecutiveConfirmCount}
              onAnswer={answerQuestion}
              t={t}
            />
          </div>

          <div className="relative shrink-0">
            <AgentActivityControl
              key={activeSessionId ?? 'new-session'}
              sessionId={activeSessionId}
              tree={activityFocusRunId ? null : activeActivityTree}
              taskList={taskProgressActive ? currentTaskList : null}
              taskListTasks={taskProgressActive ? currentTaskListTasks : undefined}
              t={t}
            />
            <CommanderInputBar />
          </div>
        </div>

        <div
          role="separator"
          aria-label={t('commander.resizeDock')}
          aria-orientation="horizontal"
          aria-valuenow={size.width}
          aria-valuemin={resizeWidthBounds.min}
          aria-valuemax={resizeWidthBounds.max}
          tabIndex={0}
          data-resize-origin="false"
          className="absolute bottom-0 right-0 h-5 w-5 cursor-se-resize outline-none focus-visible:ring-2 focus-visible:ring-primary max-[720px]:hidden"
          onMouseDown={(event) => {
            if (event.button !== 0) return;
            const origin = event.currentTarget;
            origin.dataset.resizeOrigin = 'true';
            origin.dataset.resizeStartX = String(event.clientX);
            origin.dataset.resizeStartY = String(event.clientY);
            origin.dataset.resizeStartWidth = String(size.width);
            origin.dataset.resizeStartHeight = String(size.height);
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 48 : 16;
            if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key))
              return;
            event.preventDefault();
            if (event.key === 'Home')
              resizePanel({
                width: DEFAULT_COMMANDER_PANEL_WIDTH,
                height: DEFAULT_COMMANDER_PANEL_HEIGHT,
              });
            else
              resizePanel({
                width:
                  size.width +
                  (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
                height:
                  size.height +
                  (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0),
              });
          }}
        />
      </section>
    </CommanderContext.Provider>
  );
}
