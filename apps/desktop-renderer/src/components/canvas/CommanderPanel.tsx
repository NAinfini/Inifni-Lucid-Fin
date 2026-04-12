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
  setSize,
  setPermissionMode,
  clearPendingConfirmation,
  clearPendingQuestion,
  enqueueMessage,
  dequeueMessage,
  removeQueuedMessage,
  editQueuedMessage,
  clearQueue,
  addSystemNotice,
  compactLocalContext,
} from '../../store/slices/commander.js';
import { useCommander } from '../../hooks/useCommander.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { cn } from '../../lib/utils.js';
import { getAPI } from '../../utils/api.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/Tooltip.js';

const MIN_WIDTH = 320;
const MIN_HEIGHT = 400;
const SAFE_Y = 56;
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

/** Format camelCase action name to human-readable. e.g. "generateReferenceImage" → "Generate Reference Image" */
function formatAction(action: string, t?: (key: string) => string): string {
  // Try localized action name first
  if (t) {
    const localized = t(`commander.toolAction.${action}`);
    if (!localized.startsWith('commander.toolAction.')) return localized;
  }
  return action
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/** Format full tool name for display. e.g. "character.list" → "角色: 列表" (localized) */
function formatToolName(name: string, t?: (key: string) => string): string {
  const parts = name.split('.');
  const domain = parts[0] ?? '';
  const action = parts[parts.length - 1] ?? name;
  if (parts.length > 1) {
    const localizedDomain = t?.(`commander.toolDomain.${domain}`);
    const domainLabel = localizedDomain && !localizedDomain.startsWith('commander.toolDomain.')
      ? localizedDomain
      : domain.replace(/^./, (c) => c.toUpperCase());
    return `${domainLabel}: ${formatAction(action, t)}`;
  }
  return formatAction(action, t);
}

/** Build a human-readable one-line summary of what a tool call will do. */
function summarizeToolAction(
  toolName: string,
  args: Record<string, unknown>,
  t: (key: string) => string,
): { action: string; detail: string } {
  const parts = toolName.split('.');
  const domain = parts[0] ?? '';
  const method = parts[parts.length - 1] ?? '';

  // Count nodeIds if present (batch operations)
  const nodeIds = Array.isArray(args.nodeIds) ? args.nodeIds : [];
  const nodeCount = nodeIds.length || (args.nodeId ? 1 : 0);

  // Identify the target entity
  const name = typeof args.name === 'string' ? args.name : undefined;
  const id = typeof args.id === 'string' ? args.id.slice(0, 8) : undefined;
  const canvasId = typeof args.canvasId === 'string' ? args.canvasId.slice(0, 8) : undefined;

  // Domain labels
  const domainLabels: Record<string, string> = {
    canvas: t('commander.toolDomain.canvas'),
    character: t('commander.toolDomain.character'),
    equipment: t('commander.toolDomain.equipment'),
    location: t('commander.toolDomain.location'),
    scene: t('commander.toolDomain.scene'),
    preset: t('commander.toolDomain.preset'),
    provider: t('commander.toolDomain.provider'),
    workflow: t('commander.toolDomain.workflow'),
    script: t('commander.toolDomain.script'),
    render: t('commander.toolDomain.render'),
    project: t('commander.toolDomain.project'),
    series: t('commander.toolDomain.series'),
    settings: t('commander.toolDomain.settings'),
    asset: t('commander.toolDomain.asset'),
    vision: t('commander.toolDomain.vision'),
    tool: t('commander.toolDomain.tool'),
    guide: t('commander.toolDomain.guide'),
    commander: t('commander.toolDomain.commander'),
    logger: t('commander.toolDomain.logger'),
  };
  const domainLabel = domainLabels[domain] ?? domain;

  // Action-specific summaries
  const action = formatAction(method, t);

  // Build detail string
  const detailParts: string[] = [];
  if (nodeCount > 1) detailParts.push(`${nodeCount} ${t('commander.toolSummary.nodes')}`);
  else if (nodeCount === 1) detailParts.push(`1 ${t('commander.toolSummary.node')}`);
  if (name) detailParts.push(`"${name}"`);
  else if (id) detailParts.push(`#${id}…`);
  if (canvasId && !name) detailParts.push(`${t('commander.toolSummary.canvas')} #${canvasId}…`);

  // Slot info
  if (typeof args.slot === 'string') detailParts.push(`slot: ${args.slot}`);

  // Provider info
  if (typeof args.providerId === 'string') detailParts.push(args.providerId as string);

  // Prompt snippet — only if non-empty
  if (typeof args.prompt === 'string' && (args.prompt as string).trim().length > 0) {
    const prompt = (args.prompt as string).trim();
    detailParts.push(`"${prompt.length > 40 ? prompt.slice(0, 40) + '…' : prompt}"`);
  }

  return {
    action: `${domainLabel} — ${action}`,
    detail: detailParts.join(' · ') || method,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeReferenceKey(key: string): boolean {
  return key === 'nodeId' || key.endsWith('NodeId') || key === 'source' || key === 'target';
}

function isNodeReferenceListKey(key: string): boolean {
  return key === 'nodeIds' || key.endsWith('NodeIds');
}

function formatNodeReference(nodeId: string, nodeTitlesById: Record<string, string>): string {
  const title = nodeTitlesById[nodeId]?.trim();
  if (!title || title === nodeId) {
    return nodeId;
  }
  return `${title} (${nodeId})`;
}

function annotateToolPayload(
  value: unknown,
  nodeTitlesById: Record<string, string>,
  parentKey?: string,
): unknown {
  if (typeof value === 'string' && parentKey && isNodeReferenceKey(parentKey)) {
    return formatNodeReference(value, nodeTitlesById);
  }

  if (Array.isArray(value)) {
    if (parentKey && isNodeReferenceListKey(parentKey)) {
      return value.map((entry) =>
        typeof entry === 'string' ? formatNodeReference(entry, nodeTitlesById) : entry,
      );
    }
    return value.map((entry) => annotateToolPayload(entry, nodeTitlesById));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      annotateToolPayload(entry, nodeTitlesById, key),
    ]),
  );
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
  nodeTitlesById,
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
  nodeTitlesById: Record<string, string>;
  t: (key: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const formattedArguments = useMemo(
    () => JSON.stringify(annotateToolPayload(toolCall.arguments, nodeTitlesById), null, 2),
    [nodeTitlesById, toolCall.arguments],
  );
  const formattedResult = useMemo(
    () =>
      toolCall.result === undefined
        ? undefined
        : JSON.stringify(annotateToolPayload(toolCall.result, nodeTitlesById), null, 2),
    [nodeTitlesById, toolCall.result],
  );
  const elapsed =
    toolCall.completedAt && toolCall.startedAt
      ? (() => {
          const ms = toolCall.completedAt! - toolCall.startedAt;
          if (ms < 1) return '<1ms';
          if (ms < 1000) return `${Math.round(ms)}ms`;
          return `${(ms / 1000).toFixed(1)}s`;
        })()
      : null;

  return (
    <div
      className={cn(
        'mt-2 mb-2 overflow-hidden rounded-lg border bg-background/50',
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
        <span className="flex-1 text-left">{formatToolName(toolCall.name, t)}</span>
        {elapsed && (
          <span className="text-[10px] text-muted-foreground">
            {t('commander.elapsed')} {elapsed}
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
        <div className="border-t border-border/40 text-[11px]">
          <div className="max-h-60 overflow-y-auto px-2.5 py-2">
            <pre className="overflow-x-auto whitespace-pre-wrap text-muted-foreground">
              {formattedArguments}
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
                  {formattedResult}
                </pre>
              </>
            )}
          </div>
          <button
            type="button"
            className="flex w-full items-center justify-center gap-1 border-t border-border/40 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            onClick={() => setExpanded(false)}
          >
            <ChevronDown className="h-3 w-3 rotate-180" />
            <span>{t('commander.minimize')}</span>
          </button>
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
    3: t('commander.tierLabels.generation'),
    4: t('commander.tierLabels.system'),
  };
  const tierColors: Record<number, string> = {
    1: 'bg-emerald-500/15 text-emerald-400',
    2: 'bg-amber-500/15 text-amber-400',
    3: 'bg-blue-500/15 text-blue-400',
    4: 'bg-red-500/15 text-red-400',
  };

  const { action, detail } = summarizeToolAction(toolName, args, t);
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="mx-3 my-2 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3">
      <div className="flex items-center gap-2 text-xs font-medium">
        <Shield className="h-4 w-4 text-amber-400" />
        <span>{t('commander.toolConfirm.title')}</span>
        <span
          className={cn(
            'ml-auto rounded px-1.5 py-0.5 text-[10px]',
            tierColors[tier] ?? 'bg-amber-500/15 text-amber-400',
          )}
        >
          {tierLabels[tier] ?? `Tier ${tier}`}
        </span>
      </div>
      <div className="mt-2 text-xs font-medium">{action}</div>
      {detail && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{detail}</div>
      )}
      <button
        type="button"
        className="mt-1.5 text-[9px] text-muted-foreground/60 hover:text-muted-foreground underline"
        onClick={() => setShowRaw((v) => !v)}
      >
        {showRaw ? t('commander.toolConfirm.hideRaw') : t('commander.toolConfirm.showRaw')}
      </button>
      {showRaw && (
        <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-muted/30 p-1.5 text-[10px] text-muted-foreground">
          {JSON.stringify(args, null, 2)}
        </pre>
      )}
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
    historyTokenBudget,
  } = useSelector((state: RootState) => state.commander);
  const [input, setInput] = useState('');
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
    return state.canvas.canvases.find((c) => c.id === activeId)?.nodes;
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

  // Slash command system — Claude Code style: / shows commands, typing filters
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const slashMenuRef = useRef<HTMLDivElement | null>(null);

  const SLASH_COMMANDS = useMemo(
    () => [
      { name: 'compact', desc: t('commander.slashCommand.compactDesc') },
      { name: 'clear', desc: t('commander.slashCommand.clearDesc') },
      { name: 'context', desc: t('commander.slashCommand.contextDesc') },
      { name: 'status', desc: t('commander.slashCommand.statusDesc') },
      { name: 'help', desc: t('commander.slashCommand.helpDesc') },
    ],
    [t],
  );

  const slashQuery = useMemo(() => {
    if (!input.startsWith('/')) return null;
    return input.slice(1).toLowerCase();
  }, [input]);

  const filteredSlashItems = useMemo(() => {
    if (slashQuery === null) return [];
    if (slashQuery === '') return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (cmd) => cmd.name.includes(slashQuery) || cmd.desc.toLowerCase().includes(slashQuery),
    );
  }, [slashQuery, SLASH_COMMANDS]);

  const slashMenuOpen = slashQuery !== null && filteredSlashItems.length > 0;

  // Reset menu index when filtered list changes
  useEffect(() => {
    setSlashMenuIndex(0);
  }, [slashQuery]);

  // Scroll selected item into view
  useEffect(() => {
    if (!slashMenuOpen || !slashMenuRef.current) return;
    const container = slashMenuRef.current;
    const selected = container.children[slashMenuIndex] as HTMLElement | undefined;
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  }, [slashMenuIndex, slashMenuOpen]);

  const triggerCompact = useCallback(async () => {
    dispatch(addSystemNotice(t('commander.slashCommand.compacting')));
    // Phase 1: compact local Redux store (truncate old tool results + assistant text)
    dispatch(compactLocalContext());
    // Phase 2: compact backend activeMessages via IPC
    const api = getAPI();
    const canvasId = store.getState().canvas.activeCanvasId;
    if (api?.commander && canvasId) {
      try {
        const result = await api.commander.compact(canvasId) as { freedChars: number; messageCount: number; toolCount: number };
        if (result.freedChars > 0) {
          dispatch(addSystemNotice(
            t('commander.slashCommand.compactResult')
              .replace('{chars}', result.freedChars.toLocaleString())
              .replace('{messages}', String(result.messageCount))
              .replace('{tools}', String(result.toolCount)),
          ));
        } else {
          dispatch(addSystemNotice(t('commander.slashCommand.compactNoopSuggestClear')));
        }
      } catch {
        dispatch(addSystemNotice(t('commander.slashCommand.compactNoopSuggestClear')));
      }
    }
  }, [dispatch, t]);

  const executeSlashCommand = useCallback(
    async (cmdName: string) => {
      setInput('');
      switch (cmdName) {
        case 'compact': {
          await triggerCompact();
          break;
        }
        case 'clear':
          dispatch(newSession());
          break;
        case 'status': {
          const msgs = store.getState().commander.messages;
          const totalChars = msgs.reduce((sum, m) => sum + m.content.length, 0);
          dispatch(addSystemNotice(
            t('commander.slashCommand.statusResult')
              .replace('{messages}', String(msgs.length))
              .replace('{chars}', totalChars.toLocaleString()),
          ));
          break;
        }
        case 'context': {
          const msgs = store.getState().commander.messages;
          let uChars = 0, aChars = 0, tcChars = 0, trChars = 0;
          let uCount = 0, aCount = 0, tcCount = 0;
          const toolFreq: Record<string, number> = {};
          // Per-tool token breakdown: args + results
          const toolArgChars: Record<string, number> = {};
          const toolResultChars: Record<string, number> = {};
          for (const m of msgs) {
            const cl = m.content?.length ?? 0;
            if (m.role === 'user') { uChars += cl; uCount++; }
            else { aChars += cl; aCount++; }
            if (m.toolCalls) {
              for (const tc of m.toolCalls) {
                const argLen = JSON.stringify(tc.arguments).length;
                const resLen = tc.result !== undefined ? JSON.stringify(tc.result).length : 0;
                tcChars += argLen;
                trChars += resLen;
                tcCount++;
                toolFreq[tc.name] = (toolFreq[tc.name] ?? 0) + 1;
                toolArgChars[tc.name] = (toolArgChars[tc.name] ?? 0) + argLen;
                toolResultChars[tc.name] = (toolResultChars[tc.name] ?? 0) + resLen;
              }
            }
          }
          const tok = (c: number) => Math.round(c / 4);
          const totalTok = tok(uChars + aChars + tcChars + trChars);
          const budget = store.getState().commander.historyTokenBudget;
          const pctVal = Math.min(100, Math.round((totalTok / budget) * 100));
          const fK = (n: number) => {
            if (n >= 1000) { const v = n / 1000; return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}K`; }
            return String(n);
          };
          const pctOf = (part: number, whole: number) => whole > 0 ? `${Math.round(part / whole * 100)}%` : '0%';

          const totalCharsAll = uChars + aChars + tcChars + trChars;

          // Top 10 tools by total token usage (args + results)
          const toolTotalChars: Record<string, number> = {};
          for (const name of Object.keys(toolFreq)) {
            toolTotalChars[name] = (toolArgChars[name] ?? 0) + (toolResultChars[name] ?? 0);
          }
          const topBySize = Object.entries(toolTotalChars)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([name, chars]) => {
              const calls = toolFreq[name];
              const argTok = tok(toolArgChars[name] ?? 0);
              const resTok = tok(toolResultChars[name] ?? 0);
              return `  ${name}: ${fK(tok(chars))} ${t('commander.contextBreakdown.tokens')} (${calls}x) — ${t('commander.contextBreakdown.args')} ${fK(argTok)}, ${t('commander.contextBreakdown.resultsLabel')} ${fK(resTok)}`;
            })
            .join('\n');

          const detail = [
            `${t('commander.contextBreakdown.context')}: ${fK(totalTok)} / ${fK(budget)} ${t('commander.contextBreakdown.tokens')} (${pctVal}%)`,
            ``,
            `${t('commander.contextBreakdown.user')}: ${fK(tok(uChars))} ${t('commander.contextBreakdown.tokens')} (${uCount} ${t('commander.contextBreakdown.msgs')}) — ${pctOf(uChars, totalCharsAll)}`,
            `${t('commander.contextBreakdown.assistant')}: ${fK(tok(aChars))} ${t('commander.contextBreakdown.tokens')} (${aCount} ${t('commander.contextBreakdown.msgs')}) — ${pctOf(aChars, totalCharsAll)}`,
            `${t('commander.contextBreakdown.toolCalls')}: ${fK(tok(tcChars))} ${t('commander.contextBreakdown.tokens')} (${tcCount} ${t('commander.contextBreakdown.calls')}) — ${pctOf(tcChars, totalCharsAll)}`,
            `${t('commander.contextBreakdown.toolResults')}: ${fK(tok(trChars))} ${t('commander.contextBreakdown.tokens')} — ${pctOf(trChars, totalCharsAll)}`,
            ``,
            `${t('commander.contextBreakdown.topToolsBySize')}:`,
            topBySize || `  (${t('commander.contextBreakdown.none')})`,
          ].join('\n');

          dispatch(addSystemNotice(detail));
          break;
        }
        case 'help': {
          const helpLines = SLASH_COMMANDS.map((cmd) => `/${cmd.name} — ${cmd.desc}`).join('\n');
          dispatch(addSystemNotice(`${t('commander.slashCommand.helpTitle')}:\n${helpLines}`));
          break;
        }
        default:
          break;
      }
    },
    [sendMessage, dispatch, t, SLASH_COMMANDS],
  );

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

  // Estimate context usage with per-category breakdown
  const contextUsage = useMemo(() => {
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
    const totalChars = userChars + assistantChars + toolCallChars + toolResultChars;
    // Token estimate: ~4 chars per token (matches backend ESTIMATED_CHARS_PER_TOKEN)
    const toTokens = (c: number) => Math.round(c / 4);
    const estimatedTokens = toTokens(totalChars);
    const ctxWindow = historyTokenBudget;
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
    };
  }, [historyTokenBudget, messages, currentStreamContent]);

  // Auto-compact when context reaches 95%, with 10s cooldown
  const autoCompactedRef = useRef(false);
  const lastCompactTimeRef = useRef(0);
  useEffect(() => {
    const now = Date.now();
    const cooldownMs = 10_000;
    if (
      contextUsage?.pct != null
      && contextUsage.pct >= 95
      && !autoCompactedRef.current
      && !isStreaming
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
        {messages.length === 0 && !liveMessage ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
            {t('commander.thinking')}
          </div>
        ) : null}

        {messages.map((message) => (
          <article
            key={message.id}
            className={cn(
              'w-full text-sm',
              message.role === 'user'
                ? 'border-l-2 border-primary/40 pl-3 py-1.5'
                : 'py-1.5',
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
                      <ToolCallCard
                        key={seg.toolCall.id}
                        toolCall={seg.toolCall}
                        nodeTitlesById={nodeTitlesById}
                        t={t}
                      />
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
                      <ToolCallCard
                        key={toolCall.id}
                        toolCall={toolCall}
                        nodeTitlesById={nodeTitlesById}
                        t={t}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </article>
        ))}

        {liveMessage ? (
          <article className="w-full py-1.5 text-xs">
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
                    <ToolCallCard
                      key={seg.toolCall.id}
                      toolCall={seg.toolCall}
                      nodeTitlesById={nodeTitlesById}
                      t={t}
                    />
                  ),
                )}
              </>
            ) : null}
          </article>
        ) : null}

        {/* Persistent streaming indicator — always visible when AI is working */}
        {isStreaming && (
          <div className="flex items-center gap-2 py-2 text-muted-foreground">
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: '0ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: '150ms' }} />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" style={{ animationDelay: '300ms' }} />
            </div>
            <span className="text-[10px]">{t('commander.streaming')}</span>
          </div>
        )}

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

      <footer className="shrink-0 border-t border-border/60 bg-card">
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
            {isStreaming && input.trim().length > 0 ? (
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
                disabled={input.trim().length === 0 && messageQueue.length === 0}
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
