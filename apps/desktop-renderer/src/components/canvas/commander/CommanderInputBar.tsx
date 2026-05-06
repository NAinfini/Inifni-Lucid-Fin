import { useDispatch, useSelector } from 'react-redux';
import {
  Check,
  ChevronDown,
  Image as ImageIcon,
  MapPin,
  Paperclip,
  Pencil,
  Play,
  SendHorizonal,
  Shield,
  ShieldAlert,
  Slash,
  X,
  Zap,
} from 'lucide-react';
import type { RootState } from '../../../store/index.js';
import {
  setProviderId,
  setPermissionMode,
  clearQueue,
  editQueuedMessage,
  removeQueuedMessage,
  dequeueMessage,
  enqueueMessage,
} from '../../../store/slices/commander.js';
import { useCommander } from '../../../hooks/useCommander.js';
import { cn } from '../../../lib/utils.js';
import { getAPI } from '../../../utils/api.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../ui/Tooltip.js';
import type { ContextUsage } from '../../../commander/state/context-usage.js';
import type { SlashCommand } from './useSlashCommands.js';
import type { CanvasNode } from '@lucid-fin/contracts';

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
export type Attachment = FileAttachment | NodeAttachment;

interface CommanderInputBarProps {
  input: string;
  setInput: (value: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  attachments: Attachment[];
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  modelPickerOpen: boolean;
  setModelPickerOpen: (open: boolean) => void;
  permPickerOpen: boolean;
  setPermPickerOpen: (open: boolean) => void;
  nodePickerOpen: boolean;
  setNodePickerOpen: (open: boolean) => void;
  editingQueueIndex: number | null;
  setEditingQueueIndex: (index: number | null) => void;
  editingQueueText: string;
  setEditingQueueText: (text: string) => void;
  contextUsage: ContextUsage | null;
  triggerCompact: () => Promise<void>;
  slashMenuRef: React.RefObject<HTMLDivElement | null>;
  slashMenuOpen: boolean;
  slashMenuIndex: number;
  setSlashMenuIndex: (index: number | ((prev: number) => number)) => void;
  filteredSlashItems: SlashCommand[];
  executeSlashCommand: (name: string) => Promise<void>;
  SLASH_COMMANDS: SlashCommand[];
  canvasNodes: CanvasNode[] | undefined;
  userScrolledUpRef: React.RefObject<boolean>;
  isBackendReady: boolean;
  t: (key: string) => string;
}

export function CommanderInputBar({
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
  contextUsage,
  triggerCompact,
  slashMenuRef,
  slashMenuOpen,
  slashMenuIndex,
  setSlashMenuIndex,
  filteredSlashItems,
  executeSlashCommand,
  SLASH_COMMANDS,
  canvasNodes,
  userScrolledUpRef,
  isBackendReady,
  t,
}: CommanderInputBarProps) {
  const dispatch = useDispatch();
  const { sendMessage, cancel, isStreaming } = useCommander();
  const providerId = useSelector((state: RootState) => state.commander.providerId);
  const permissionMode = useSelector((state: RootState) => state.commander.permissionMode);
  const messageQueue = useSelector(
    (state: RootState) => state.commander.messageQueue,
    (a, b) => a === b,
  );
  const llmSettings = useSelector((state: RootState) => state.settings.llm);

  const providers = llmSettings?.providers ?? [];
  const activeProvider = providers.find((p) => p.id === providerId) ?? providers[0];
  const inputHasText = input.trim().length > 0;

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

  const handleAddToQueue = () => {
    if (!isBackendReady) return;
    const value = input.trim();
    if (!value) return;
    dispatch(enqueueMessage(value));
    setInput('');
    setAttachments([]);
  };

  const handleSendNow = async () => {
    if (!isBackendReady) return;
    const value = input.trim();
    userScrolledUpRef.current = false;
    if (value) {
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
      await sendMessage(next.content);
    }
  };

  const handlePushQueueItem = async (index: number) => {
    const msg = messageQueue[index];
    if (!msg || !isStreaming) return;
    dispatch(removeQueuedMessage(index));
    await sendMessage(msg.content);
  };

  const fmtK = (n: number) => {
    if (n >= 1000) {
      const v = n / 1000;
      return `${v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)}K`;
    }
    return String(n);
  };

  return (
    <footer className="relative shrink-0 border-t border-border/60">
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
                aria-label={t('action.remove')}
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
              key={msg.id}
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
                    {i + 1}. {msg.content}
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
                      setEditingQueueText(msg.content);
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

      {/* Input area */}
      <div className="relative">
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
                  i === slashMenuIndex ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
                )}
                onMouseEnter={() => setSlashMenuIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
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
          placeholder={t('commander.sendMessageHint')}
          className="w-full resize-none border-0 bg-transparent px-3 pt-2 pb-1 text-xs outline-none placeholder:text-muted-foreground/60 overflow-y-auto"
          style={{ minHeight: '32px', maxHeight: '120px' }}
          disabled={!isBackendReady}
        />

        {/* Bottom toolbar */}
        <div className="flex items-center gap-0.5 border-t border-border/40 px-2 py-1">
          {/* + Add resource button */}
          <div className="relative" data-dropdown-menu>
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setNodePickerOpen(!nodePickerOpen)}
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
                    <div className="px-2 py-1 text-[10px] text-muted-foreground">
                      {t('commander.noNodes')}
                    </div>
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
              {`${attachments.length} ${t('commander.attachedCount')}`}
            </span>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Context usage ring */}
          {contextUsage &&
            (() => {
              const pct = contextUsage.pct;
              const r = 6;
              const circ = 2 * Math.PI * r;
              const offset = circ - (circ * Math.min(pct, 100)) / 100;
              const ringColor =
                pct >= 80
                  ? 'stroke-red-400'
                  : pct >= 50
                    ? 'stroke-amber-400'
                    : 'stroke-emerald-400';
              const used = fmtK(contextUsage.estimatedTokens);
              const total =
                contextUsage.ctxWindow >= 1_000_000
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
                          <circle
                            cx="8"
                            cy="8"
                            r={r}
                            fill="none"
                            strokeWidth="2"
                            className="stroke-border"
                          />
                          {pct > 0 && (
                            <circle
                              cx="8"
                              cy="8"
                              r={r}
                              fill="none"
                              strokeWidth="2"
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
                      <div className="text-[11px] font-medium">
                        {used} / {total} {t('commander.contextBreakdown.tokens')} ({pct}%)
                      </div>
                      <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] text-primary-foreground/70">
                        <span>{t('commander.contextBreakdown.user')}</span>
                        <span className="text-right">
                          {fmtK(bd.user)} ({ct.user})
                        </span>
                        <span>{t('commander.contextBreakdown.assistant')}</span>
                        <span className="text-right">
                          {fmtK(bd.assistant)} ({ct.assistant})
                        </span>
                        <span>{t('commander.contextBreakdown.toolCalls')}</span>
                        <span className="text-right">
                          {fmtK(bd.toolCalls)} ({ct.toolCalls})
                        </span>
                        <span>{t('commander.contextBreakdown.toolResults')}</span>
                        <span className="text-right">{fmtK(bd.toolResults)}</span>
                        {contextUsage.cache.entries > 0 && (
                          <>
                            <span>{t('commander.contextBreakdown.cache')}</span>
                            <span className="text-right">
                              {fmtK(Math.round(contextUsage.cache.chars / 3.5))} (
                              {contextUsage.cache.entries})
                            </span>
                          </>
                        )}
                        {contextUsage.historyTrimmed > 0 && (
                          <>
                            <span>{t('commander.contextBreakdown.trimmed')}</span>
                            <span className="text-right">
                              {contextUsage.historyTrimmed} {t('commander.contextBreakdown.msgs')}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="mt-1 text-[10px] text-primary-foreground/50">
                        {t('commander.slashCommand.compact')}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })()}

          {/* Model picker */}
          <div className="relative" data-dropdown-menu>
            <button
              type="button"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setModelPickerOpen(!modelPickerOpen)}
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
              onClick={() => setPermPickerOpen(!permPickerOpen)}
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
            <button
              className="flex h-6 items-center gap-1 rounded-md bg-primary px-2 text-[10px] text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
              onClick={handleAddToQueue}
              title={t('commander.addToQueue')}
              disabled={!isBackendReady}
            >
              <Play className="h-3 w-3" />
              {t('commander.addToQueue')}
            </button>
          ) : isStreaming ? (
            <button
              className="flex h-6 w-6 items-center justify-center rounded-md bg-destructive/20 text-destructive hover:bg-destructive/30"
              onClick={() => void cancel()}
              title={t('commander.cancel')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              className="flex h-6 items-center gap-1 rounded-md bg-primary px-2 text-[10px] text-primary-foreground hover:bg-primary/90 disabled:opacity-30"
              onClick={() => void handleSendNow()}
              disabled={!isBackendReady || (!inputHasText && messageQueue.length === 0)}
              title={isBackendReady ? t('commander.sendNow') : t('commander.backendNotReady')}
            >
              <Play className="h-3 w-3" />
              {t('commander.sendNow')}
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}
