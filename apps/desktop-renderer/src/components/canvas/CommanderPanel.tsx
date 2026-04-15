import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Check,
  ChevronDown,
  Image as ImageIcon,
  MapPin,
  Minus,
  Paperclip,
  Pencil,
  Play,
  SendHorizonal,
  Shield,
  ShieldAlert,
  Slash,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { RootState } from '../../store/index.js';
import { store } from '../../store/index.js';
import {
  newSession,
  minimizeCommander,
  setCommanderOpen,
  setProviderId,
  setPosition,
  setPermissionMode,
  clearPendingConfirmation,
  setConfirmAutoMode,
  resolveQuestion,
  enqueueMessage,
  dequeueMessage,
  removeQueuedMessage,
  editQueuedMessage,
  clearQueue,
} from '../../store/slices/commander.js';
import { useCommander } from '../../hooks/useCommander.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { cn } from '../../lib/utils.js';
import { getAPI } from '../../utils/api.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/Tooltip.js';
import { ToolConfirmCard } from './commander/ToolConfirmCard.js';
import { QuestionCard } from './commander/QuestionCard.js';
import { useSlashCommands } from './commander/useSlashCommands.js';
import { usePanelDrag } from './commander/usePanelDrag.js';
import { MessageList } from './commander/MessageList.js';

const SAFE_Y = 56;

// ---------------------------------------------------------------------------
// Attachment types
// ---------------------------------------------------------------------------

interface FileAttachment {
  type: 'file';
  name: string;
  hash: string;
}
interface NodeAttachment {
  type: 'node';
  id: string;
  title: string;
}
type Attachment = FileAttachment | NodeAttachment;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CommanderPanel() {
  const dispatch = useDispatch();
  const { t } = useI18n();
  const { sendMessage, cancel, isStreaming } = useCommander();
  const {
    open,
    minimized,
    providerId,
    messages,
    currentStreamContent,
    currentThinkingContent,
    currentToolCalls,
    currentSegments,
    position,
    size,
    error,
    permissionMode,
    pendingConfirmation,
    pendingQuestion,
    consecutiveConfirmCount,
    messageQueue,
    pendingInjectedMessages,
    maxTokens,
    backendContextUsage,
  } = useSelector((state: RootState) => state.commander);
  const [input, setInput] = useState('');
  const inputHasText = input.trim().length > 0;
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editingQueueIndex, setEditingQueueIndex] = useState<number | null>(null);
  const [editingQueueText, setEditingQueueText] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const userScrolledUpRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const wasDraggingRef = useRef(false);

  // LLM model selector state
  const llmSettings = useSelector((state: RootState) => state.settings.llm);
  const canvasNodes = useSelector((state: RootState) => {
    const activeId = state.canvas.activeCanvasId;
    if (!activeId) return undefined;
    return state.canvas.canvases.entities[activeId]?.nodes;
  });
  const nodeTitlesById = useMemo(
    () =>
      Object.fromEntries(
        (canvasNodes ?? []).map((node) => [node.id, node.title?.trim() || node.type]),
      ) as Record<string, string>,
    [canvasNodes],
  );
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [permPickerOpen, setPermPickerOpen] = useState(false);
  const [nodePickerOpen, setNodePickerOpen] = useState(false);

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

  // Scroll selected item into view
  useEffect(() => {
    if (!slashMenuOpen || !slashMenuRef.current) return;
    const container = slashMenuRef.current;
    const selected = container.children[slashMenuIndex] as HTMLElement | undefined;
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }, [slashMenuIndex, slashMenuOpen]);

  // Auto-expanding textarea height — batched into a single rAF to avoid layout thrash
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

  // Auto-send next queued message when streaming finishes
  const prevStreamingRef = useRef(false);
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      // Skip first run on mount — sync ref without triggering dispatch
      hasMountedRef.current = true;
      prevStreamingRef.current = isStreaming;
      return;
    }
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;
    // Trigger when streaming just finished and queue has messages
    if (wasStreaming && !isStreaming && messageQueue.length > 0) {
      const next = messageQueue[0];
      dispatch(dequeueMessage());
      void sendMessage(next);
    }
  }, [isStreaming, messageQueue, dispatch, sendMessage]);

  // Track whether user has manually scrolled up
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

  // Only auto-scroll if user is near the bottom
  useEffect(() => {
    if (!open) return;
    const target = scrollRef.current;
    if (!target) return;
    if (!userScrolledUpRef.current) {
      target.scrollTop = target.scrollHeight;
    }
  }, [currentStreamContent, currentToolCalls, messages, open]);

  const sectionRef = useRef<HTMLElement>(null);

  usePanelDrag({ panelRef: sectionRef, open, size });

  // Estimate context usage with per-category breakdown
  const contextUsage = useMemo(() => {
    // Use backend-reported numbers when available (accurate: includes system prompt + tool schemas)
    if (backendContextUsage) {
      const { estimatedTokensUsed, contextWindowTokens } = backendContextUsage;
      const pct = Math.min(100, Math.round((estimatedTokensUsed / contextWindowTokens) * 100));

      // Local breakdown for per-category display (best-effort from Redux messages)
      let userChars = 0;
      let assistantChars = 0;
      let toolCallChars = 0;
      let toolResultChars = 0;
      let userCount = 0;
      let assistantCount = 0;
      let toolCallCount = 0;
      for (const msg of messages) {
        const contentLen = msg.content?.length ?? 0;
        if (msg.role === 'user') { userChars += contentLen; userCount++; }
        else { assistantChars += contentLen; assistantCount++; }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            toolCallChars += JSON.stringify(tc.arguments).length;
            toolCallCount++;
            if (tc.result !== undefined) toolResultChars += JSON.stringify(tc.result).length;
          }
        }
      }
      assistantChars += currentStreamContent?.length ?? 0;
      for (const tc of currentToolCalls) {
        toolCallChars += JSON.stringify(tc.arguments).length;
        toolCallCount++;
        if (tc.result !== undefined) toolResultChars += JSON.stringify(tc.result).length;
      }
      const toTokens = (c: number) => Math.round(c / 3.5);
      return {
        pct,
        estimatedTokens: estimatedTokensUsed,
        ctxWindow: contextWindowTokens,
        breakdown: {
          user: toTokens(userChars),
          assistant: toTokens(assistantChars),
          toolCalls: toTokens(toolCallChars),
          toolResults: toTokens(toolResultChars),
        },
        counts: { user: userCount, assistant: assistantCount, toolCalls: toolCallCount },
        cache: {
          chars: backendContextUsage.cacheChars,
          entries: backendContextUsage.cacheEntryCount,
        },
        historyTrimmed: backendContextUsage.historyMessagesTrimmed,
      };
    }

    // Fallback: local estimate (less accurate — missing system prompt + tool schemas)
    let userChars = 0;
    let assistantChars = 0;
    let toolCallChars = 0;
    let toolResultChars = 0;
    let userCount = 0;
    let assistantCount = 0;
    let toolCallCount = 0;
    for (const msg of messages) {
      const contentLen = msg.content?.length ?? 0;
      if (msg.role === 'user') {
        userChars += contentLen;
        userCount++;
      } else {
        assistantChars += contentLen;
        assistantCount++;
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          toolCallChars += JSON.stringify(tc.arguments).length;
          toolCallCount++;
          if (tc.result !== undefined) toolResultChars += JSON.stringify(tc.result).length;
        }
      }
    }
    assistantChars += currentStreamContent?.length ?? 0;
    for (const tc of currentToolCalls) {
      toolCallChars += JSON.stringify(tc.arguments).length;
      toolCallCount++;
      if (tc.result !== undefined) toolResultChars += JSON.stringify(tc.result).length;
    }
    const totalChars = userChars + assistantChars + toolCallChars + toolResultChars;
    const toTokens = (c: number) => Math.round(c / 3.5);
    const estimatedTokens = toTokens(totalChars);
    const ctxWindow = maxTokens;
    const pct = Math.min(100, Math.round((estimatedTokens / ctxWindow) * 100));
    return {
      pct,
      estimatedTokens,
      ctxWindow,
      breakdown: {
        user: toTokens(userChars),
        assistant: toTokens(assistantChars),
        toolCalls: toTokens(toolCallChars),
        toolResults: toTokens(toolResultChars),
      },
      counts: { user: userCount, assistant: assistantCount, toolCalls: toolCallCount },
      cache: { chars: 0, entries: 0 },
      historyTrimmed: 0,
    };
  }, [maxTokens, messages, currentStreamContent, currentToolCalls, backendContextUsage]);

  // Auto-compact when context reaches 95%, with 10s cooldown
  // Triggers DURING active session (isStreaming) so the backend session still exists.
  const autoCompactedRef = useRef(false);
  const lastCompactTimeRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    const cooldownMs = 10_000;
    if (
      contextUsage?.pct != null
      && contextUsage.pct >= 95
      && !autoCompactedRef.current
      && isStreaming
      && now - lastCompactTimeRef.current > cooldownMs
    ) {
      autoCompactedRef.current = true;
      lastCompactTimeRef.current = now;
      void triggerCompact();
    }
    // Reset the flag when usage drops below 70% (after successful compact)
    if (contextUsage?.pct != null && contextUsage.pct < 70) {
      autoCompactedRef.current = false;
    }
  }, [contextUsage?.pct, isStreaming, triggerCompact]);

  const handleNodeClick = useCallback((nodeId: string) => {
    window.dispatchEvent(new CustomEvent('commander:navigate-to-node', { detail: { nodeId } }));
  }, []);

  if (!open) {
    return null;
  }

  if (minimized) {
    return (
      <button
        type="button"
        className="fixed z-40 flex items-center gap-1.5 rounded-md border border-border/60 bg-card px-2.5 py-1.5 shadow-lg backdrop-blur-sm hover:bg-muted/80 transition-colors cursor-move"
        style={{ left: position.x, top: position.y }}
        onClick={() => {
          // Don't open if we just finished dragging
          if (wasDraggingRef.current) {
            wasDraggingRef.current = false;
            return;
          }
          dispatch(setCommanderOpen(true));
        }}
        onMouseDown={(event) => {
          // Only handle left click for dragging
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

            // If moved more than 5px, consider it a drag
            const dx = Math.abs(e.clientX - startX);
            const dy = Math.abs(e.clientY - startY);
            if (dx > 5 || dy > 5) {
              wasDraggingRef.current = true;
            }

            const offsetX = Number(target.dataset.dragOffsetX);
            const offsetY = Number(target.dataset.dragOffsetY);
            // Direct DOM update — skip Redux during drag
            target.style.left = `${e.clientX - offsetX}px`;
            target.style.top = `${Math.max(SAFE_Y, e.clientY - offsetY)}px`;
          };

          const handleMouseUp = () => {
            delete target.dataset.dragOrigin;
            delete target.dataset.dragOffsetX;
            delete target.dataset.dragOffsetY;
            // Commit final position to Redux
            dispatch(setPosition({ x: parseInt(target.style.left), y: parseInt(target.style.top) }));
            ac.abort();
          };

          document.addEventListener('mousemove', handleMouseMove, { signal: ac.signal });
          document.addEventListener('mouseup', handleMouseUp, { signal: ac.signal });
        }}
      >
        <Zap className="h-4 w-4 text-amber-400" />
        <span className="text-xs font-medium">{t('commander.commanderAI')}</span>
        {isStreaming && (
          <div className="flex gap-0.5">
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
          </div>
        )}
      </button>
    );
  }

  const handlePushQueueItem = async (index: number) => {
    const msg = messageQueue[index];
    if (!msg || !isStreaming) return;
    dispatch(removeQueuedMessage(index));
    await sendMessage(msg);
  };

  const handleAddToQueue = () => {
    const value = input.trim();
    if (!value) return;
    dispatch(enqueueMessage(value));
    setInput('');
    setAttachments([]);
  };

  const handleSendNow = async () => {
    const value = input.trim();
    userScrolledUpRef.current = false;
    if (value) {
      // Check for exact slash command match
      if (value.startsWith('/')) {
        const cmdName = value.slice(1).toLowerCase();
        const matched = SLASH_COMMANDS.find((cmd) => cmd.name === cmdName);
        if (matched) {
          void executeSlashCommand(matched.name);
          return;
        }
      }
      setInput('');
      setAttachments([]);
      await sendMessage(value);
    } else if (messageQueue.length > 0) {
      const next = messageQueue[0];
      dispatch(dequeueMessage());
      await sendMessage(next);
    }
  };

  const handleAttachFile = async () => {
    const api = getAPI();
    if (!api) return;
    const ref = (await api.asset.pickFile('image')) as { hash: string; name?: string } | null;
    if (ref)
      setAttachments((prev) => [
        ...prev,
        { type: 'file', name: ref.name ?? ref.hash.slice(0, 8), hash: ref.hash },
      ]);
  };

  const handleAttachNode = (node: { id: string; title: string }) => {
    setAttachments((prev) => [...prev, { type: 'node', id: node.id, title: node.title }]);
    setNodePickerOpen(false);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const providers = llmSettings?.providers ?? [];
  const activeProvider = providers.find((p) => p.id === providerId) ?? providers[0];

  return (
    <section
      ref={sectionRef}
      className="fixed z-40 flex flex-col overflow-hidden rounded-lg border border-border/70 bg-card shadow-2xl backdrop-blur-sm"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
    >
      <header
        className="flex shrink-0 cursor-move items-center justify-between border-b border-border/60 bg-muted/30 px-3 py-1.5"
        onMouseDown={(event) => {
          const target = event.currentTarget;
          target.dataset.dragOrigin = 'true';
          target.dataset.dragOffsetX = String(event.clientX - position.x);
          target.dataset.dragOffsetY = String(event.clientY - position.y);
        }}
      >
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Zap className="h-3.5 w-3.5 text-amber-400" />
          <span>{t('commander.commanderAI')}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => dispatch(newSession())}
            title={t('commander.clearHistory')}
            aria-label={t('commander.clearHistory')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <button
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => dispatch(minimizeCommander())}
            title={t('commander.minimize')}
            aria-label={t('commander.minimize')}
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => {
              if (isStreaming) void cancel();
              dispatch(setCommanderOpen(false));
            }}
            title={t('commander.close')}
            aria-label={t('commander.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-2 pb-3">
        <MessageList
          messages={messages}
          liveMessage={liveMessage}
          currentSegments={currentSegments}
          pendingInjectedMessages={pendingInjectedMessages}
          isStreaming={isStreaming}
          error={error}
          nodeTitlesById={nodeTitlesById}
          thinkingContent={currentThinkingContent}
          t={t}
          emptyLabel={t('commander.thinking')}
          streamingLabel={t('commander.streaming')}
          onNodeClick={handleNodeClick}
        />
      </div>

      {/* Tool confirmation card */}
      {pendingConfirmation && (
        <div className="space-y-1">
          <ToolConfirmCard
            toolName={pendingConfirmation.toolName}
            args={pendingConfirmation.args}
            tier={pendingConfirmation.tier}
            onExecute={() => {
              const api = getAPI();
              const canvasId = store.getState().canvas.activeCanvasId;
              if (api?.commander && canvasId) {
                void api.commander.confirmTool(canvasId, pendingConfirmation.toolCallId, true);
              }
              dispatch(clearPendingConfirmation());
            }}
            onSkip={() => {
              const api = getAPI();
              const canvasId = store.getState().canvas.activeCanvasId;
              if (api?.commander && canvasId) {
                void api.commander.confirmTool(canvasId, pendingConfirmation.toolCallId, false);
              }
              dispatch(clearPendingConfirmation());
            }}
            t={t}
          />
          {consecutiveConfirmCount >= 4 && (
            <div className="flex items-center justify-end gap-1.5 px-3 pb-1">
              <span className="text-[10px] text-muted-foreground mr-auto">
                {t('commander.confirmBatchHint')}
              </span>
              <button
                type="button"
                className="text-[10px] px-2 py-0.5 rounded border border-border/60 text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
                onClick={() => {
                  const api = getAPI();
                  const canvasId = store.getState().canvas.activeCanvasId;
                  if (api?.commander && canvasId) {
                    void api.commander.confirmTool(canvasId, pendingConfirmation.toolCallId, false);
                  }
                  dispatch(setConfirmAutoMode('skip'));
                  dispatch(clearPendingConfirmation());
                }}
              >
                {t('commander.skipAll')}
              </button>
              <button
                type="button"
                className="text-[10px] px-2 py-0.5 rounded border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
                onClick={() => {
                  const api = getAPI();
                  const canvasId = store.getState().canvas.activeCanvasId;
                  if (api?.commander && canvasId) {
                    void api.commander.confirmTool(canvasId, pendingConfirmation.toolCallId, true);
                  }
                  dispatch(setConfirmAutoMode('approve'));
                  dispatch(clearPendingConfirmation());
                }}
              >
                {t('commander.executeAll')}
              </button>
            </div>
          )}
        </div>
      )}

      <footer className="relative shrink-0 border-t border-border/60 bg-card">
        {/* Question card overlay — extends upward from footer to cover chatbox */}
        {pendingQuestion && (
          <div className="absolute inset-x-0 bottom-0 z-10 bg-card/95 backdrop-blur-[2px] rounded-b-lg border-t border-blue-500/30">
            <QuestionCard
              question={pendingQuestion.question}
              options={pendingQuestion.options}
              onAnswer={(answer) => {
                const api = getAPI();
                const canvasId = store.getState().canvas.activeCanvasId;
                if (api?.commander && canvasId) {
                  void api.commander.answerQuestion(canvasId, pendingQuestion.toolCallId, answer);
                }
                dispatch(resolveQuestion({ answer }));
              }}
              t={t}
            />
          </div>
        )}
        {/* Attachment preview chips */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 px-3 pt-2">
            {attachments.map((att, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded bg-muted/80 px-1.5 py-0.5 text-[10px]"
              >
                {att.type === 'file' ? (
                  <Paperclip className="h-2.5 w-2.5" />
                ) : (
                  <MapPin className="h-2.5 w-2.5" />
                )}
                {att.type === 'file' ? att.name : att.title}
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  className="hover:text-destructive"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Message Queue */}
        {messageQueue.length > 0 && (
          <div className="mx-2 mb-1 rounded-lg border border-border/60 bg-muted/30 text-xs">
            <div className="flex items-center justify-between px-2 py-1 text-[10px] text-muted-foreground border-b border-border/40">
              <span>
                {t('commander.queue')} ({messageQueue.length})
              </span>
              <button
                type="button"
                onClick={() => dispatch(clearQueue())}
                className="text-muted-foreground hover:text-destructive"
                title={t('commander.clearQueue')}
              >
                {t('commander.clearQueue')}
              </button>
            </div>
            {messageQueue.map((msg, i) => (
              <div
                key={i}
                className="flex items-center gap-1 px-2 py-1 border-b border-border/20 last:border-0"
              >
                {editingQueueIndex === i ? (
                  <>
                    <input
                      className="flex-1 bg-background rounded px-1 py-0.5 text-xs outline-none border border-primary/40"
                      value={editingQueueText}
                      onChange={(e) => setEditingQueueText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          dispatch(editQueuedMessage({ index: i, content: editingQueueText }));
                          setEditingQueueIndex(null);
                        } else if (e.key === 'Escape') {
                          setEditingQueueIndex(null);
                        }
                      }}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => {
                        dispatch(editQueuedMessage({ index: i, content: editingQueueText }));
                        setEditingQueueIndex(null);
                      }}
                      className="text-primary hover:opacity-70"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 truncate text-muted-foreground">
                      {i + 1}. {msg}
                    </span>
                    {isStreaming && (
                      <button
                        type="button"
                        onClick={() => void handlePushQueueItem(i)}
                        className="text-primary hover:opacity-70"
                        title={t('commander.pushToSession')}
                      >
                        <SendHorizonal className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditingQueueIndex(i);
                        setEditingQueueText(msg);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => dispatch(removeQueuedMessage(i))}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Input area — Claude Code style */}
        <div className="relative rounded-xl border border-border/60 bg-background m-2 mb-3">
          {/* Slash command popup */}
          {slashMenuOpen && (
            <div
              ref={slashMenuRef}
              className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-48 overflow-y-auto rounded-lg border border-border bg-card shadow-xl"
            >
              {filteredSlashItems.map((cmd, i) => (
                <button
                  key={cmd.name}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs',
                    i === slashMenuIndex
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-muted',
                  )}
                  onMouseEnter={() => setSlashMenuIndex(i)}
                  onMouseDown={(e) => {
                    e.preventDefault(); // prevent blur
                    void executeSlashCommand(cmd.name);
                  }}
                >
                  <Slash className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="font-medium">{cmd.name}</span>
                  <span className="truncate text-muted-foreground">{cmd.desc}</span>
                </button>
              ))}
            </div>
          )}
          {/* Textarea */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              // Slash menu navigation
              if (slashMenuOpen) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSlashMenuIndex((prev) => Math.min(prev + 1, filteredSlashItems.length - 1));
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSlashMenuIndex((prev) => Math.max(prev - 1, 0));
                  return;
                }
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  const selected = filteredSlashItems[slashMenuIndex];
                  if (selected) void executeSlashCommand(selected.name);
                  return;
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setInput('');
                  return;
                }
                if (event.key === 'Tab') {
                  event.preventDefault();
                  const selected = filteredSlashItems[slashMenuIndex];
                  if (selected) setInput(`/${selected.name}`);
                  return;
                }
              }
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void handleSendNow();
              } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                if (isStreaming) {
                  handleAddToQueue();
                } else {
                  void handleSendNow();
                }
              }
              if (event.key === 'Escape' && isStreaming) void cancel();
            }}
            rows={1}
            placeholder={t('commander.sendMessage')}
            className="w-full resize-none border-0 bg-transparent px-3 pt-2.5 pb-1 text-xs outline-none placeholder:text-muted-foreground/60 overflow-y-auto"
            style={{ minHeight: '32px', maxHeight: '120px' }}
          />

          {/* Bottom toolbar — like Claude Code */}
          <div className="flex items-center gap-0.5 border-t border-border/40 px-2 py-1">
            {/* + Add resource button */}
            <div className="relative" data-dropdown-menu>
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setNodePickerOpen((v) => !v)}
                title={t('commander.attachNode')}
              >
                <span className="text-sm font-bold">+</span>
              </button>
              {nodePickerOpen && (
                <div className="absolute bottom-8 left-0 z-50 w-52 rounded-lg border border-border bg-card shadow-xl">
                  <div className="border-b border-border/60 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {t('commander.attachNode')}
                  </div>
                  <div className="max-h-40 overflow-auto p-1">
                    {!canvasNodes || canvasNodes.length === 0 ? (
                      <div className="px-2 py-1 text-[10px] text-muted-foreground">No nodes</div>
                    ) : (
                      canvasNodes.map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          className="w-full rounded px-2 py-1 text-left text-[11px] hover:bg-muted"
                          onClick={() =>
                            handleAttachNode({ id: node.id, title: node.title || node.type })
                          }
                        >
                          <span className="font-medium">{node.title || node.type}</span>
                          <span className="ml-1 text-muted-foreground">{node.type}</span>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="border-t border-border/60 p-1">
                    <button
                      type="button"
                      className="w-full rounded px-2 py-1 text-left text-[11px] hover:bg-muted"
                      onClick={() => {
                        void handleAttachFile();
                        setNodePickerOpen(false);
                      }}
                    >
                      <Paperclip className="mr-1 inline h-3 w-3" />
                      {t('commander.attachFile')}
                    </button>
                    <button
                      type="button"
                      className="w-full rounded px-2 py-1 text-left text-[11px] hover:bg-muted"
                      onClick={() => {
                        void handleAttachFile();
                        setNodePickerOpen(false);
                      }}
                    >
                      <ImageIcon className="mr-1 inline h-3 w-3" />
                      {t('commander.attachImage')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Separator */}
            <div className="mx-0.5 h-4 w-px bg-border/60" />

            {/* Context indicator — attached count */}
            {attachments.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {`${attachments.length} attached`}
              </span>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Context usage — click to compact, hover for details */}
            {contextUsage && (() => {
              const pct = contextUsage.pct;
              const r = 6;
              const circ = 2 * Math.PI * r;
              const offset = circ - (circ * Math.min(pct, 100)) / 100;
              const ringColor = pct >= 80 ? 'stroke-red-400' : pct >= 50 ? 'stroke-amber-400' : 'stroke-emerald-400';
              const fmtK = (n: number) => { if (n >= 1000) { const v = n / 1000; return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}K`; } return String(n); };
              const used = fmtK(contextUsage.estimatedTokens);
              const total = contextUsage.ctxWindow >= 1_000_000
                ? `${(contextUsage.ctxWindow / 1_000_000).toFixed(contextUsage.ctxWindow % 1_000_000 === 0 ? 0 : 1)}M`
                : `${Math.round(contextUsage.ctxWindow / 1000)}K`;
              const { breakdown: bd, counts: ct } = contextUsage;
              return (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => void triggerCompact()}
                        className="shrink-0 rounded p-0.5 hover:bg-muted transition-colors"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16">
                          <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2" className="stroke-border" />
                          {pct > 0 && (
                            <circle
                              cx="8" cy="8" r={r} fill="none" strokeWidth="2"
                              className={ringColor}
                              strokeDasharray={circ}
                              strokeDashoffset={offset}
                              strokeLinecap="round"
                              transform="rotate(-90 8 8)"
                            />
                          )}
                        </svg>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={8} className="max-w-xs">
                      <div className="text-[11px] font-medium">{used} / {total} {t('commander.contextBreakdown.tokens')} ({pct}%)</div>
                      <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] text-primary-foreground/70">
                        <span>{t('commander.contextBreakdown.user')}</span>
                        <span className="text-right">{fmtK(bd.user)} ({ct.user})</span>
                        <span>{t('commander.contextBreakdown.assistant')}</span>
                        <span className="text-right">{fmtK(bd.assistant)} ({ct.assistant})</span>
                        <span>{t('commander.contextBreakdown.toolCalls')}</span>
                        <span className="text-right">{fmtK(bd.toolCalls)} ({ct.toolCalls})</span>
                        <span>{t('commander.contextBreakdown.toolResults')}</span>
                        <span className="text-right">{fmtK(bd.toolResults)}</span>
                        {contextUsage.cache.entries > 0 && (<>
                          <span>Cache</span>
                          <span className="text-right">{fmtK(Math.round(contextUsage.cache.chars / 3.5))} ({contextUsage.cache.entries})</span>
                        </>)}
                        {contextUsage.historyTrimmed > 0 && (<>
                          <span>Trimmed</span>
                          <span className="text-right">{contextUsage.historyTrimmed} msgs</span>
                        </>)}
                      </div>
                      <div className="mt-1 text-[10px] text-primary-foreground/50">{t('commander.slashCommand.compact')}</div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })()}
            <div className="relative" data-dropdown-menu>
              <button
                type="button"
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setModelPickerOpen((v) => !v)}
              >
                <span className="max-w-[80px] truncate">{activeProvider?.name ?? 'LLM'}</span>
                <ChevronDown className="h-2.5 w-2.5" />
              </button>
              {modelPickerOpen && (
                <div className="absolute bottom-7 right-0 z-50 w-48 rounded-lg border border-border bg-card p-1 shadow-xl max-h-48 overflow-y-auto">
                  {providers.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={cn(
                        'w-full rounded px-2 py-1 text-left text-[11px] hover:bg-muted',
                        p.id === activeProvider?.id && 'bg-primary/10 text-primary',
                      )}
                      onClick={() => {
                        dispatch(setProviderId(p.id));
                        setModelPickerOpen(false);
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{p.name}</span>
                        {p.contextWindow && (
                          <span className="text-[9px] text-muted-foreground/60">
                            {p.contextWindow >= 1_000_000
                              ? `${(p.contextWindow / 1_000_000).toFixed(p.contextWindow % 1_000_000 === 0 ? 0 : 1)}M`
                              : `${Math.round(p.contextWindow / 1000)}K`}
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] text-muted-foreground">{p.model}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Permission mode selector */}
            <div className="relative" data-dropdown-menu>
              <button
                type="button"
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setPermPickerOpen((v) => !v)}
              >
                {permissionMode === 'auto' && <Zap className="h-2.5 w-2.5 text-emerald-400" />}
                {permissionMode === 'normal' && <Shield className="h-2.5 w-2.5 text-amber-400" />}
                {permissionMode === 'strict' && (
                  <ShieldAlert className="h-2.5 w-2.5 text-red-400" />
                )}
                <span>{t(`commander.permissionMode.${permissionMode}`)}</span>
                <ChevronDown className="h-2.5 w-2.5" />
              </button>
              {permPickerOpen && (
                <div className="absolute bottom-7 right-0 z-50 w-44 rounded-lg border border-border bg-card p-1 shadow-xl">
                  {[
                    { value: 'auto' as const, icon: Zap, color: 'text-emerald-400' },
                    { value: 'normal' as const, icon: Shield, color: 'text-amber-400' },
                    { value: 'strict' as const, icon: ShieldAlert, color: 'text-red-400' },
                  ].map((m) => {
                    const Icon = m.icon;
                    return (
                      <button
                        key={m.value}
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] hover:bg-muted',
                          permissionMode === m.value && 'bg-primary/10 text-primary',
                        )}
                        onClick={() => {
                          dispatch(setPermissionMode(m.value));
                          setPermPickerOpen(false);
                        }}
                      >
                        <Icon className={cn('h-3.5 w-3.5', m.color)} />
                        <div>
                          <div className="font-medium">
                            {t(`commander.permissionMode.${m.value}`)}
                          </div>
                          <div className="text-[9px] text-muted-foreground">
                            {t(`commander.permissionMode.${m.value}Desc`)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Single smart button: Send / Queue / Cancel */}
            {isStreaming && inputHasText ? (
              /* AI running + text in box → Queue message */
              <button
                className="flex h-6 items-center gap-1 rounded-md bg-primary px-2 text-[10px] text-primary-foreground hover:bg-primary/90"
                onClick={handleAddToQueue}
                title={t('commander.addToQueue')}
              >
                <Play className="h-3 w-3" />
                {t('commander.addToQueue')}
              </button>
            ) : isStreaming ? (
              /* AI running + empty box → Cancel */
              <button
                className="flex h-6 w-6 items-center justify-center rounded-md bg-destructive/20 text-destructive hover:bg-destructive/30"
                onClick={() => void cancel()}
                title={t('commander.cancel')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              /* AI idle → Send */
              <button
                className="flex h-6 items-center gap-1 rounded-md bg-primary px-2 text-[10px] text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
                onClick={() => void handleSendNow()}
                disabled={!inputHasText && messageQueue.length === 0}
                title={t('commander.sendNow')}
              >
                <Play className="h-3 w-3" />
                {t('commander.sendNow')}
              </button>
            )}
          </div>
        </div>
      </footer>

      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
        onMouseDown={(event) => {
          const target = event.currentTarget;
          target.dataset.resizeOrigin = 'true';
          target.dataset.resizeStartX = String(event.clientX);
          target.dataset.resizeStartY = String(event.clientY);
          target.dataset.resizeStartWidth = String(size.width);
          target.dataset.resizeStartHeight = String(size.height);
        }}
      />
    </section>
  );
}
