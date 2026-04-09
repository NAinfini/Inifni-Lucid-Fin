import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Check,
  ChevronDown,
  Copy,
  Image as ImageIcon,
  Loader2,
  MapPin,
  MessageCircleQuestion,
  Minus,
  Paperclip,
  Pencil,
  Play,
  Shield,
  ShieldAlert,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import type { RootState } from '../../store/index.js';
import { store } from '../../store/index.js';
import {
  clearHistory,
  minimizeCommander,
  setCommanderOpen,
  setProviderId,
  setPosition,
  setSize,
  setPermissionMode,
  clearPendingConfirmation,
  clearPendingQuestion,
  enqueueMessage,
  dequeueMessage,
  removeQueuedMessage,
  editQueuedMessage,
  clearQueue,
  type PermissionMode,
} from '../../store/slices/commander.js';
import { useCommander } from '../../hooks/useCommander.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { cn } from '../../lib/utils.js';
import { getAPI } from '../../utils/api.js';

const MIN_WIDTH = 320;
const MIN_HEIGHT = 400;
const SAFE_Y = 56;
const MAX_INPUT_ROWS = 4;

// ---------------------------------------------------------------------------
// Inline markdown renderer
// ---------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdown(raw: string): string {
  const codeBlockRe = new RegExp('```(\\w*)\\n([\\s\\S]*?)```', 'g');
  const inlineCodeRe = new RegExp('`([^`\\n]+)`', 'g');
  const boldRe = new RegExp('\\*\\*(.+?)\\*\\*', 'g');
  const italicRe = new RegExp('(?<!\\*)\\*(?!\\*)(.+?)(?<!\\*)\\*(?!\\*)', 'g');
  const linkRe = new RegExp('\\[([^\\]]+)\\]\\(([^)]+)\\)', 'g');
  const listItemRe = new RegExp('^- (.+)$', 'gm');
  const ulWrapRe = new RegExp('((?:<li[^>]*>.*?</li>\\n?)+)', 'g');
  const newlineRe = new RegExp('\\n', 'g');

  let html = raw.replace(
    codeBlockRe,
    (_m: string, lang: string, code: string) =>
      `<pre class="commander-codeblock" data-lang="${lang}"><code>${escapeHtml(code.trimEnd())}</code></pre>`,
  );
  html = html.replace(inlineCodeRe, '<code class="commander-inline-code">$1</code>');
  html = html.replace(boldRe, '<strong>$1</strong>');
  html = html.replace(italicRe, '<em>$1</em>');
  html = html.replace(
    linkRe,
    '<a href="$2" target="_blank" rel="noopener" class="text-primary underline">$1</a>',
  );
  html = html.replace(listItemRe, '<li class="ml-4 list-disc">$1</li>');
  html = html.replace(ulWrapRe, '<ul class="my-1">$1</ul>');
  html = html.replace(newlineRe, '<br/>');
  return html;
}

function formatToolName(name: string): string {
  const parts = name.split('.');
  const domain = parts[0] ?? '';
  const action = parts[parts.length - 1] ?? name;
  const actionFormatted = action
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
  return parts.length > 1 ? `${domain}.${actionFormatted}` : actionFormatted;
}

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
// Sub-components
// ---------------------------------------------------------------------------

function ToolCallCard({
  toolCall,
  t,
}: {
  toolCall: {
    name: string;
    id: string;
    arguments: Record<string, unknown>;
    startedAt?: number;
    completedAt?: number;
    result?: unknown;
    status: string;
  };
  t: (key: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const elapsed =
    toolCall.completedAt && toolCall.startedAt
      ? ((toolCall.completedAt - toolCall.startedAt) / 1000).toFixed(1)
      : null;

  return (
    <div
      className={cn(
        'mt-2 overflow-hidden rounded-lg border bg-background/50',
        toolCall.status === 'pending' && 'border-amber-500/40 animate-pulse',
        toolCall.status === 'done' && 'border-emerald-500/30',
        toolCall.status === 'error' && 'border-destructive/40',
        toolCall.status !== 'pending' &&
          toolCall.status !== 'done' &&
          toolCall.status !== 'error' &&
          'border-border/60',
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-muted/50"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {toolCall.status === 'pending' && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
        )}
        {toolCall.status === 'done' && <Check className="h-3.5 w-3.5 text-emerald-400" />}
        {toolCall.status === 'error' && <X className="h-3.5 w-3.5 text-destructive" />}
        <span className="flex-1 text-left">{formatToolName(toolCall.name)}</span>
        {elapsed && (
          <span className="text-[10px] text-muted-foreground">
            {t('commander.elapsed')} {elapsed}s
          </span>
        )}
        <ChevronDown
          className={cn(
            'h-3 w-3 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded && (
        <div className="border-t border-border/40 px-2.5 py-2 text-[11px]">
          <pre className="overflow-x-auto whitespace-pre-wrap text-muted-foreground">
            {JSON.stringify(toolCall.arguments, null, 2)}
          </pre>
          {toolCall.result !== undefined && (
            <>
              <div className="mt-2 font-medium">
                {t('commander.toolResult')}:{' '}
                <span
                  className={cn(
                    toolCall.status === 'error' ? 'text-destructive' : 'text-emerald-400',
                  )}
                >
                  {toolCall.status}
                </span>
              </div>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-muted-foreground">
                {JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      onClick={handleCopy}
      title={label}
      aria-label={label}
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function MessageActionStrip({
  messageId,
  children,
}: {
  messageId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={`commander-message-actions-${messageId}`}
      className="flex h-5 items-center justify-end border-b border-border/40 bg-background/10 px-2"
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool confirmation card
// ---------------------------------------------------------------------------

function ToolConfirmCard({
  toolName,
  args,
  tier,
  onExecute,
  onSkip,
  t,
}: {
  toolName: string;
  args: Record<string, unknown>;
  tier: number;
  onExecute: () => void;
  onSkip: () => void;
  t: (key: string) => string;
}) {
  const tierLabels: Record<number, string> = {
    1: t('commander.tierLabels.safe'),
    2: t('commander.tierLabels.mutation'),
    3: t('commander.tierLabels.destructive'),
    4: t('commander.tierLabels.system'),
  };

  return (
    <div className="mx-3 my-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2 text-xs font-medium">
        <Shield className="h-4 w-4 text-amber-400" />
        <span>{t('commander.toolConfirm.title')}</span>
        <span
          className={cn(
            'ml-auto rounded px-1.5 py-0.5 text-[10px]',
            tier <= 2 ? 'bg-amber-500/15 text-amber-400' : 'bg-red-500/15 text-red-400',
          )}
        >
          {tierLabels[tier] ?? `Tier ${tier}`}
        </span>
      </div>
      <div className="mt-2 text-xs">
        <span className="font-medium">{formatToolName(toolName)}</span>
        <span className="ml-1 text-muted-foreground">({toolName})</span>
      </div>
      <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-[10px] text-muted-foreground">
        {JSON.stringify(args, null, 2)}
      </pre>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={onSkip}
        >
          {t('commander.toolConfirm.skip')}
        </button>
        <button
          type="button"
          className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90"
          onClick={onExecute}
        >
          {t('commander.toolConfirm.execute')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Question card (askUser tool)
// ---------------------------------------------------------------------------

function QuestionCard({
  question,
  options,
  onAnswer,
  t,
}: {
  question: string;
  options: Array<{ label: string; description?: string }>;
  onAnswer: (answer: string) => void;
  t: (key: string) => string;
}) {
  const [customText, setCustomText] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  return (
    <div className="mx-3 my-2 rounded-lg border border-blue-500/50 bg-blue-500/5 p-3">
      <div className="flex items-center gap-2 text-xs font-medium">
        <MessageCircleQuestion className="h-4 w-4 text-blue-400" />
        <span>{t('commander.question.title')}</span>
      </div>
      <p className="mt-2 text-sm text-foreground">{question}</p>
      <div className="mt-3 flex flex-col gap-1.5">
        {options.map((opt) => (
          <button
            key={opt.label}
            type="button"
            className="flex flex-col items-start rounded-md border border-border/60 px-3 py-2 text-left text-xs transition-colors hover:border-blue-500/50 hover:bg-blue-500/10"
            onClick={() => onAnswer(opt.label)}
          >
            <span className="font-medium text-foreground">{opt.label}</span>
            {opt.description && (
              <span className="mt-0.5 text-muted-foreground">{opt.description}</span>
            )}
          </button>
        ))}
      </div>
      {showCustom ? (
        <div className="mt-2 flex gap-1.5">
          <input
            type="text"
            className="flex-1 rounded border border-border bg-background px-2 py-1 text-xs outline-none focus:border-blue-500/50"
            placeholder={t('commander.question.otherAnswer')}
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customText.trim()) {
                onAnswer(customText.trim());
              }
            }}
            autoFocus
          />
          <button
            type="button"
            className="rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={!customText.trim()}
            onClick={() => {
              if (customText.trim()) onAnswer(customText.trim());
            }}
          >
            {t('commander.question.submit')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="mt-2 text-xs text-muted-foreground underline hover:text-foreground"
          onClick={() => setShowCustom(true)}
        >
          {t('commander.question.otherAnswer')}
        </button>
      )}
    </div>
  );
}

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
    currentToolCalls,
    currentSegments,
    position,
    size,
    error,
    permissionMode,
    pendingConfirmation,
    pendingQuestion,
    messageQueue,
  } = useSelector((state: RootState) => state.commander);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editingQueueIndex, setEditingQueueIndex] = useState<number | null>(null);
  const [editingQueueText, setEditingQueueText] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const wasDraggingRef = useRef(false);

  // LLM model selector state
  const llmSettings = useSelector((state: RootState) => state.settings.llm);
  const canvasNodes = useSelector((state: RootState) => {
    const activeId = state.canvas.activeCanvasId;
    return state.canvas.canvases.find((c) => c.id === activeId)?.nodes ?? [];
  });
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [permPickerOpen, setPermPickerOpen] = useState(false);
  const [nodePickerOpen, setNodePickerOpen] = useState(false);

  // Auto-expanding textarea height
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 400)}px`;
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
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;
    // Trigger when streaming just finished and queue has messages
    if (wasStreaming && !isStreaming && messageQueue.length > 0) {
      const next = messageQueue[0];
      dispatch(dequeueMessage());
      void sendMessage(next);
    }
  }, [isStreaming, messageQueue, dispatch, sendMessage]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const target = scrollRef.current;
    if (!target) {
      return;
    }
    target.scrollTop = target.scrollHeight;
  }, [currentStreamContent, currentToolCalls, messages, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const target = document.querySelector<HTMLElement>('[data-drag-origin="true"]');
      if (!target) {
        return;
      }
      const offsetX = Number(target.dataset.dragOffsetX ?? '0');
      const offsetY = Number(target.dataset.dragOffsetY ?? '0');
      dispatch(
        setPosition({
          x: Math.max(8, event.clientX - offsetX),
          y: Math.max(SAFE_Y, event.clientY - offsetY),
        }),
      );
    };

    const handleMouseUp = () => {
      const dragOrigin = document.querySelector<HTMLElement>('[data-drag-origin="true"]');
      if (dragOrigin) {
        delete dragOrigin.dataset.dragOrigin;
        delete dragOrigin.dataset.dragOffsetX;
        delete dragOrigin.dataset.dragOffsetY;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dispatch, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const target = document.querySelector<HTMLElement>('[data-resize-origin="true"]');
      if (!target) {
        return;
      }
      const startX = Number(target.dataset.resizeStartX ?? '0');
      const startY = Number(target.dataset.resizeStartY ?? '0');
      const startWidth = Number(target.dataset.resizeStartWidth ?? String(size.width));
      const startHeight = Number(target.dataset.resizeStartHeight ?? String(size.height));
      dispatch(
        setSize({
          width: Math.max(MIN_WIDTH, startWidth + (event.clientX - startX)),
          height: Math.max(MIN_HEIGHT, startHeight + (event.clientY - startY)),
        }),
      );
    };

    const handleMouseUp = () => {
      const resizeOrigin = document.querySelector<HTMLElement>('[data-resize-origin="true"]');
      if (resizeOrigin) {
        delete resizeOrigin.dataset.resizeOrigin;
        delete resizeOrigin.dataset.resizeStartX;
        delete resizeOrigin.dataset.resizeStartY;
        delete resizeOrigin.dataset.resizeStartWidth;
        delete resizeOrigin.dataset.resizeStartHeight;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dispatch, open, size.height, size.width]);

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
            dispatch(
              setPosition({ x: e.clientX - offsetX, y: Math.max(SAFE_Y, e.clientY - offsetY) }),
            );
          };

          const handleMouseUp = () => {
            delete target.dataset.dragOrigin;
            delete target.dataset.dragOffsetX;
            delete target.dataset.dragOffsetY;
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
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

  const handleAddToQueue = () => {
    const value = input.trim();
    if (!value) return;
    dispatch(enqueueMessage(value));
    setInput('');
    setAttachments([]);
  };

  const handleSendNow = async () => {
    const value = input.trim();
    if (value) {
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

  const activeProvider =
    llmSettings.providers.find((p) => p.id === providerId) ?? llmSettings.providers[0];

  return (
    <section
      className="fixed z-40 flex flex-col overflow-hidden rounded-lg border border-border/70 bg-card shadow-2xl backdrop-blur-sm"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
      }}
    >
      <header
        className="flex cursor-move items-center justify-between border-b border-border/60 bg-muted/30 px-3 py-1.5"
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
            onClick={() => dispatch(clearHistory())}
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
            onClick={() => dispatch(setCommanderOpen(false))}
            title={t('commander.close')}
            aria-label={t('commander.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-2 pb-3">
        {messages.length === 0 && !liveMessage ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
            {t('commander.thinking')}
          </div>
        ) : null}

        {messages.map((message) => (
          <article
            key={message.id}
            className={cn(
              'max-w-[88%] rounded-2xl text-sm',
              message.role === 'user'
                ? 'ml-auto bg-primary/10 px-3 py-2 text-foreground'
                : 'mr-auto overflow-hidden bg-muted text-foreground',
            )}
          >
            {message.role === 'user' ? (
              <div className="whitespace-pre-wrap">{message.content}</div>
            ) : message.segments && message.segments.length > 0 ? (
              <>
                {message.content ? (
                  <MessageActionStrip messageId={message.id}>
                    <CopyButton text={message.content} label={t('commander.copy')} />
                  </MessageActionStrip>
                ) : null}
                <div className="px-3 py-2">
                  {message.segments.map((seg, i) =>
                    seg.type === 'text' ? (
                      <div
                        key={i}
                        className="commander-markdown"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.content) }}
                      />
                    ) : (
                      <ToolCallCard key={seg.toolCall.id} toolCall={seg.toolCall} t={t} />
                    ),
                  )}
                </div>
              </>
            ) : (
              <>
                {message.content ? (
                  <>
                    <MessageActionStrip messageId={message.id}>
                      <CopyButton text={message.content} label={t('commander.copy')} />
                    </MessageActionStrip>
                    <div className="px-3 py-2">
                      <div
                        className="commander-markdown"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                      />
                    </div>
                  </>
                ) : null}
                {message.toolCalls?.length ? (
                  <div className={cn('px-3', message.content ? 'pb-2' : 'py-2')}>
                    {message.toolCalls.map((toolCall) => (
                      <ToolCallCard key={toolCall.id} toolCall={toolCall} t={t} />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </article>
        ))}

        {liveMessage ? (
          <article className="mr-auto max-w-[88%] rounded-md bg-muted/80 px-2.5 py-1.5 text-xs">
            {currentSegments.length > 0 ? (
              <>
                {currentSegments.map((seg, i) =>
                  seg.type === 'text' ? (
                    <div key={i}>
                      <div
                        className="commander-markdown"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.content) }}
                      />
                      {isStreaming && i === currentSegments.length - 1 ? (
                        <span className="inline-block animate-pulse text-primary">▌</span>
                      ) : null}
                    </div>
                  ) : (
                    <ToolCallCard key={seg.toolCall.id} toolCall={seg.toolCall} t={t} />
                  ),
                )}
              </>
            ) : isStreaming ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <div className="flex gap-1">
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
                <span className="text-xs">{t('commander.streaming')}</span>
              </div>
            ) : null}
          </article>
        ) : null}

        {error ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
            {error}
          </div>
        ) : null}
      </div>

      {/* Tool confirmation card */}
      {pendingConfirmation && (
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
      )}

      {/* Question card (askUser tool) */}
      {pendingQuestion && (
        <QuestionCard
          question={pendingQuestion.question}
          options={pendingQuestion.options}
          onAnswer={(answer) => {
            const api = getAPI();
            const canvasId = store.getState().canvas.activeCanvasId;
            if (api?.commander && canvasId) {
              void api.commander.answerQuestion(canvasId, pendingQuestion.toolCallId, answer);
            }
            dispatch(clearPendingQuestion());
          }}
          t={t}
        />
      )}

      <footer className="border-t border-border/60 bg-card">
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
        <div className="rounded-xl border border-border/60 bg-background m-2 mb-3">
          {/* Textarea */}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void handleSendNow();
              } else if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleAddToQueue();
              }
              if (event.key === 'Escape' && isStreaming) void cancel();
            }}
            rows={1}
            placeholder={t('commander.sendMessage')}
            className="w-full resize-none border-0 bg-transparent px-3 pt-2.5 pb-1 text-xs outline-none placeholder:text-muted-foreground/60 overflow-y-auto"
            style={{ minHeight: '32px', maxHeight: '400px' }}
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
                    {canvasNodes.length === 0 ? (
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

            {/* Model selector */}
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
                  {llmSettings.providers.map((p) => (
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
                      <div className="font-medium">{p.name}</div>
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

            {/* Send / Cancel button */}
            {isStreaming ? (
              <button
                className="flex h-6 w-6 items-center justify-center rounded-md bg-destructive/20 text-destructive hover:bg-destructive/30"
                onClick={() => void cancel()}
                title={t('commander.cancel')}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <>
                {/* Add to Queue button */}
                <button
                  className="flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-30"
                  onClick={handleAddToQueue}
                  disabled={input.trim().length === 0}
                  title={t('commander.addToQueue')}
                >
                  {t('commander.addToQueue')}
                </button>
                {/* Send Now button */}
                <button
                  className="flex h-6 items-center gap-1 rounded-md bg-primary px-2 text-[10px] text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
                  onClick={() => void handleSendNow()}
                  disabled={input.trim().length === 0 && messageQueue.length === 0}
                  title={t('commander.sendNow')}
                >
                  <Play className="h-3 w-3" />
                  {t('commander.sendNow')}
                </button>
              </>
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
