import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Bot,
  Check,
  ChevronDown,
  Clapperboard,
  Circle,
  CircleStop,
  Focus,
  FolderOpen,
  LoaderCircle,
  MoreHorizontal,
  MessageSquarePlus,
  Paperclip,
  Pause,
  Play,
  Search,
  Send,
  Sparkles,
  Trash2,
  User,
  X,
} from 'lucide-react';
import type {
  Chat,
  DomainObjectRef,
  Message,
  MessageAttachment,
  Project,
  ProjectSettings,
  PublicRunEvent,
  Run,
  TaskList,
} from '@lucid-fin/contracts';
import { appCopy } from './copy.js';
import { useDesktopEnvironment } from './environment.js';
import {
  ResultDecisionControls,
  type ResultDecisionAction,
  type ResultDecisionState,
} from './ResultDecisionControls.js';
import type { SharedSelection, Workspace } from './shared-selection.js';

interface CommanderDockProps {
  readonly project: Project;
  readonly settings: ProjectSettings;
  readonly chats: readonly Chat[];
  readonly chatsHaveMore: boolean;
  readonly activeChat: Chat | null;
  readonly messages: readonly Message[];
  readonly messagesHaveMore: boolean;
  readonly projectSearchMessages: readonly Message[];
  readonly run: Run | null;
  readonly events: readonly PublicRunEvent[];
  readonly eventsHaveMore: boolean;
  readonly taskList: TaskList | null;
  readonly selection: SharedSelection;
  readonly labelForRef: (ref: DomainObjectRef) => string;
  readonly focus: boolean;
  readonly composerDraft: string;
  readonly pendingAttachments: readonly MessageAttachment[];
  readonly conversationScroll: { current: number };
  readonly focusButtonRef: React.RefObject<HTMLButtonElement | null>;
  readonly onFocus: () => void;
  readonly onExitFocus: () => void;
  readonly onSwitchChat: (chatId: string) => Promise<void>;
  readonly onCreateChat: () => Promise<void>;
  readonly onLoadMoreChats: () => Promise<void>;
  readonly onLoadEarlierMessages: () => Promise<void>;
  readonly onLoadMoreRunEvents: () => Promise<void>;
  readonly onArchiveChat: (chatId: string) => Promise<void>;
  readonly onDeleteChat: (chatId: string) => Promise<void>;
  readonly onPrepareSearch: () => Promise<void>;
  readonly onComposerDraftChange: (draft: string) => void;
  readonly onAttachReference: () => Promise<void>;
  readonly onSend: (text: string) => Promise<void>;
  readonly onControlRun: (action: 'pause' | 'resume' | 'cancel') => Promise<void>;
  readonly onAnswerInteraction: (interactionId: string, text: string) => Promise<void>;
  readonly onAnswerConfirmation: (
    confirmationId: string,
    immutableInputHash: string,
    decision: 'approved' | 'denied',
  ) => Promise<void>;
  readonly onRemoveContext: (ref: DomainObjectRef) => void;
  readonly onOpenWorkspace: (workspace: Workspace) => void;
  readonly onOpenResult: (resultId: string) => void;
  readonly resultDecisionStateForId: (resultId: string) => ResultDecisionState;
  readonly resultDecisionDisabledReasonForId: (resultId: string) => string | null;
  readonly onResultDecision: (
    resultId: string,
    action: ResultDecisionAction,
    detail: string,
  ) => Promise<void>;
}

type ConfirmationTarget = Extract<
  Extract<PublicRunEvent['payloadState'], { readonly state: 'available' }>['payload'],
  { readonly type: 'confirmation_requested' }
>['target'];
type DeliveryExportConfirmationTarget = Extract<
  ConfirmationTarget,
  { readonly kind: 'delivery_export' }
>;

function messageText(message: Message): string {
  return message.blocks
    .map((block) => {
      if (block.type === 'text') return block.text;
      if (block.type === 'generated_result') return `Result ${block.resultId}`;
      if (block.type === 'project_media') return `Media ${block.projectMediaRefId}`;
      return `${block.authority} ${block.objectId}`;
    })
    .join('\n');
}

function isActiveRun(run: Run | null): boolean {
  return run !== null && !['completed', 'blocked', 'failed', 'cancelled'].includes(run.status);
}

function formatBudget(settings: ProjectSettings): string {
  const cost = settings.budget.costUsd;
  const amount = cost.state === 'unknown' ? '—' : `${cost.currency} ${cost.value}`;
  return `${amount} · ${settings.budget.maxGenerationCount} gen`;
}

function TaskListSurface({ taskList }: { readonly taskList: TaskList }) {
  return (
    <section className="lucid-task-list" aria-label={taskList.title}>
      <header>{taskList.title}</header>
      <ol>
        {[...taskList.items]
          .sort((left, right) => left.order - right.order)
          .map((item) => (
            <li key={item.id} data-state={item.state}>
              <span className="lucid-task-icon" aria-hidden="true">
                {item.state === 'completed' ? (
                  <Check size={13} />
                ) : item.state === 'in_progress' ? (
                  <LoaderCircle size={13} />
                ) : (
                  <Circle size={11} />
                )}
              </span>
              <span>
                <strong>{item.title}</strong>
                {item.publicNote.length > 0 && <small>{item.publicNote}</small>}
              </span>
            </li>
          ))}
      </ol>
    </section>
  );
}

function QuestionEvent({
  event,
  onAnswer,
}: {
  readonly event: PublicRunEvent;
  readonly onAnswer: (interactionId: string, text: string) => Promise<void>;
}) {
  const { locale } = useDesktopEnvironment();
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (event.payloadState.state !== 'available' || event.payloadState.payload.type !== 'question')
    return null;
  const payload = event.payloadState.payload;
  const submit = async () => {
    if (answer.trim().length === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      await onAnswer(payload.interactionId, answer.trim());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : locale === 'zh-CN'
            ? '无法提交此回答。'
            : 'The answer could not be submitted.',
      );
    } finally {
      setSending(false);
    }
  };
  return (
    <form
      className="lucid-inline-interaction"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        void submit();
      }}
    >
      <strong>{payload.prompt}</strong>
      <div>
        <input
          value={answer}
          onChange={(changeEvent) => setAnswer(changeEvent.currentTarget.value)}
          aria-label={locale === 'zh-CN' ? '回答 Commander' : 'Answer Commander'}
        />
        <button type="submit" disabled={sending || answer.trim().length === 0}>
          {locale === 'zh-CN' ? '回答' : 'Answer'}
        </button>
      </div>
      {error !== null && (
        <p className="lucid-inline-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function DeliveryExportConfirmationPreview({
  target,
}: {
  readonly target: DeliveryExportConfirmationTarget;
}) {
  const { locale } = useDesktopEnvironment();
  return (
    <dl className="lucid-delivery-confirmation-preview">
      <div>
        <dt>{locale === 'zh-CN' ? '冻结清单' : 'Frozen manifest'}</dt>
        <dd>{target.manifest.id}</dd>
      </div>
      <div>
        <dt>{locale === 'zh-CN' ? '格式' : 'Format'}</dt>
        <dd>
          {target.formatIntent.container.toUpperCase()} · {target.formatIntent.videoCodec} ·{' '}
          {target.formatIntent.width}×{target.formatIntent.height} · {target.formatIntent.frameRate}{' '}
          fps
        </dd>
      </div>
      <div>
        <dt>{locale === 'zh-CN' ? '项目' : 'Items'}</dt>
        <dd>{target.itemCount}</dd>
      </div>
      <div>
        <dt>{locale === 'zh-CN' ? '目标位置' : 'Destination'}</dt>
        <dd>
          {target.destination.displayLabel} · {target.destination.kind.replaceAll('_', ' ')}
        </dd>
      </div>
      <div>
        <dt>{locale === 'zh-CN' ? '覆盖现有文件' : 'Overwrite existing'}</dt>
        <dd>
          {target.overwriteExisting
            ? locale === 'zh-CN'
              ? '是'
              : 'Yes'
            : locale === 'zh-CN'
              ? '否'
              : 'No'}
        </dd>
      </div>
      <div>
        <dt>{locale === 'zh-CN' ? '已知成本' : 'Known cost'}</dt>
        <dd>
          {target.cost.currency} {target.cost.value}
        </dd>
      </div>
    </dl>
  );
}

function ConfirmationEvent({
  event,
  onAnswer,
}: {
  readonly event: PublicRunEvent;
  readonly onAnswer: CommanderDockProps['onAnswerConfirmation'];
}) {
  const { locale } = useDesktopEnvironment();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (
    event.payloadState.state !== 'available' ||
    event.payloadState.payload.type !== 'confirmation_requested'
  )
    return null;
  const payload = event.payloadState.payload;
  const decide = async (decision: 'approved' | 'denied') => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      await onAnswer(payload.confirmationId, payload.immutableInputHash, decision);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : locale === 'zh-CN'
            ? '无法提交此确认。'
            : 'The confirmation could not be submitted.',
      );
    } finally {
      setSending(false);
    }
  };
  return (
    <section
      className="lucid-inline-confirmation"
      aria-label={locale === 'zh-CN' ? '受保护确认' : 'Protected confirmation'}
    >
      <AlertCircle size={16} />
      <div>
        <strong>{payload.summary}</strong>
        <small>{payload.target.kind.replaceAll('_', ' ')}</small>
        {payload.target.kind === 'delivery_export' && (
          <DeliveryExportConfirmationPreview target={payload.target} />
        )}
        <div>
          <button type="button" onClick={() => void decide('denied')} disabled={sending}>
            {locale === 'zh-CN' ? '拒绝' : 'Deny'}
          </button>
          <button type="button" onClick={() => void decide('approved')} disabled={sending}>
            {locale === 'zh-CN' ? '确认' : 'Approve'}
          </button>
        </div>
        {error !== null && (
          <p className="lucid-inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function RunEvents({
  events,
  onAnswerInteraction,
  onAnswerConfirmation,
  onOpenWorkspace,
  onOpenResult,
  resultDecisionStateForId,
  resultDecisionDisabledReasonForId,
  onResultDecision,
}: Pick<
  CommanderDockProps,
  | 'events'
  | 'onAnswerInteraction'
  | 'onAnswerConfirmation'
  | 'onOpenWorkspace'
  | 'onOpenResult'
  | 'resultDecisionStateForId'
  | 'resultDecisionDisabledReasonForId'
  | 'onResultDecision'
>) {
  const { locale } = useDesktopEnvironment();
  const available = events.filter(
    (
      event,
    ): event is PublicRunEvent & {
      payloadState: {
        state: 'available';
        payload: NonNullable<
          Extract<PublicRunEvent['payloadState'], { state: 'available' }>['payload']
        >;
      };
    } => event.payloadState.state === 'available',
  );
  return (
    <div className="lucid-run-events">
      {available.map((event) => {
        const payload = event.payloadState.payload;
        if (payload.type === 'progress')
          return (
            <p className="lucid-progress-line" key={event.eventId}>
              <LoaderCircle size={13} />
              {payload.summary}
            </p>
          );
        if (payload.type === 'question')
          return <QuestionEvent key={event.eventId} event={event} onAnswer={onAnswerInteraction} />;
        if (payload.type === 'confirmation_requested')
          return (
            <ConfirmationEvent key={event.eventId} event={event} onAnswer={onAnswerConfirmation} />
          );
        if (payload.type === 'result_published')
          return (
            <article className="lucid-result-card" key={event.eventId}>
              <span className="lucid-result-preview">
                <Sparkles size={22} />
              </span>
              <div>
                <strong>{payload.summary}</strong>
                <small>{payload.resultId}</small>
                <ResultDecisionControls
                  resultId={payload.resultId}
                  state={resultDecisionStateForId(payload.resultId)}
                  disabledReason={resultDecisionDisabledReasonForId(payload.resultId)}
                  onDecide={(action, detail) => onResultDecision(payload.resultId, action, detail)}
                />
                <div className="lucid-result-open-row">
                  <button type="button" onClick={() => onOpenResult(payload.resultId)}>
                    {locale === 'zh-CN' ? '在媒体中打开' : 'Open in Media'}
                  </button>
                </div>
              </div>
            </article>
          );
        if (payload.type === 'blocker')
          return (
            <p className="lucid-blocker" key={event.eventId}>
              <AlertCircle size={14} />
              <span>
                <strong>{payload.message}</strong>
                <small>{payload.code.replaceAll('_', ' ')}</small>
              </span>
            </p>
          );
        if (payload.type === 'terminal_summary')
          return (
            <section className="lucid-terminal-summary" key={event.eventId}>
              <strong>
                {payload.status === 'completed'
                  ? locale === 'zh-CN'
                    ? '已完成'
                    : 'Completed'
                  : payload.status}
              </strong>
              <p>{payload.summary}</p>
              {payload.resultIds.length > 0 && (
                <button type="button" onClick={() => onOpenWorkspace('media')}>
                  {locale === 'zh-CN' ? '查看结果' : 'Review results'}
                </button>
              )}
            </section>
          );
        if (payload.type === 'child_run_delegated')
          return (
            <details className="lucid-child-run" key={event.eventId}>
              <summary>
                <Bot size={13} />
                {payload.displayName}
                <ChevronDown size={13} />
              </summary>
              <p>{payload.publicSummary}</p>
            </details>
          );
        if (payload.type === 'tool_summary')
          return (
            <p className="lucid-purpose-summary" key={event.eventId}>
              <Check size={13} />
              {payload.summary}
            </p>
          );
        return null;
      })}
      {available.some((event) =>
        [
          'tool_summary',
          'usage',
          'operation_state_changed',
          'activation_changed',
          'inbox_state_changed',
        ].includes(event.payloadState.payload.type),
      ) && (
        <details className="lucid-execution-details">
          <summary>
            {locale === 'zh-CN' ? '执行详情' : 'Execution details'}
            <ChevronDown size={13} />
          </summary>
          <ul>
            {available
              .filter((event) =>
                [
                  'tool_summary',
                  'usage',
                  'operation_state_changed',
                  'activation_changed',
                  'inbox_state_changed',
                ].includes(event.payloadState.payload.type),
              )
              .map((event) => (
                <li key={event.eventId}>{event.payloadState.payload.type.replaceAll('_', ' ')}</li>
              ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function ChatLifecycleMenu({
  chat,
  onArchive,
  onDelete,
}: {
  readonly chat: Chat | null;
  readonly onArchive: (chatId: string) => Promise<void>;
  readonly onDelete: (chatId: string) => Promise<void>;
}) {
  const { locale } = useDesktopEnvironment();
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chatId = chat?.id ?? null;
  const previousChatId = useRef(chatId);

  useEffect(() => {
    const previous = previousChatId.current;
    previousChatId.current = chatId;
    if (previous === chatId || (previous === null && chatId !== null)) return;
    setOpen(false);
    setConfirmingDelete(false);
    setPending(false);
    setError(null);
  }, [chatId]);

  const perform = async (action: () => Promise<void>, fallback: string) => {
    if (chat === null || pending) return;
    setPending(true);
    setError(null);
    try {
      await action();
      setOpen(false);
      setConfirmingDelete(false);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback,
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="lucid-chat-lifecycle">
      <button
        type="button"
        aria-label={locale === 'zh-CN' ? '对话操作' : 'Chat actions'}
        aria-expanded={open}
        disabled={chat === null || pending}
        onClick={() => {
          setError(null);
          setOpen((value) => !value);
        }}
      >
        <MoreHorizontal size={15} />
      </button>
      {open && chat !== null && (
        <div className="lucid-chat-lifecycle-menu">
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              void perform(
                () => onArchive(chat.id),
                locale === 'zh-CN' ? '无法归档此对话。' : 'The Chat could not be archived.',
              )
            }
          >
            <Archive size={13} />
            {locale === 'zh-CN' ? '归档对话' : 'Archive Chat'}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setOpen(false);
              setConfirmingDelete(true);
            }}
          >
            <Trash2 size={13} />
            {locale === 'zh-CN' ? '删除对话' : 'Delete Chat'}
          </button>
        </div>
      )}
      {confirmingDelete && chat !== null && (
        <section
          className="lucid-chat-delete-confirmation"
          role="alertdialog"
          aria-label={`${locale === 'zh-CN' ? '删除' : 'Delete'} ${chat.title}`}
        >
          <strong>
            {locale === 'zh-CN' ? `删除“${chat.title}”？` : `Delete “${chat.title}”?`}
          </strong>
          <p>
            {locale === 'zh-CN'
              ? '对话会从活动列表中移除；已提交的项目事实和结果会保留。'
              : 'The Chat leaves the active list. Committed Project facts and results remain.'}
          </p>
          <div>
            <button type="button" disabled={pending} onClick={() => setConfirmingDelete(false)}>
              {locale === 'zh-CN' ? '取消' : 'Cancel'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                void perform(
                  () => onDelete(chat.id),
                  locale === 'zh-CN' ? '无法删除此对话。' : 'The Chat could not be deleted.',
                )
              }
            >
              {pending
                ? locale === 'zh-CN'
                  ? '正在删除…'
                  : 'Deleting…'
                : locale === 'zh-CN'
                  ? '删除对话'
                  : 'Delete Chat'}
            </button>
          </div>
        </section>
      )}
      {error !== null && (
        <p className="lucid-inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function CommanderDock(props: CommanderDockProps) {
  const { locale } = useDesktopEnvironment();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [commandPending, setCommandPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const refs = [
    ...(props.selection.primary === null ? [] : [props.selection.primary]),
    ...props.selection.supporting,
  ];
  const searchResults = useMemo(() => {
    const query = search.trim().toLocaleLowerCase(locale);
    if (query.length === 0) return [];
    return [
      ...props.chats
        .filter((chat) => chat.title.toLocaleLowerCase(locale).includes(query))
        .map((chat) => ({
          id: `chat:${chat.id}`,
          label: chat.title,
          kind: 'chat' as const,
          chatId: chat.id,
        })),
      ...props.projectSearchMessages
        .filter((message) => messageText(message).toLocaleLowerCase(locale).includes(query))
        .map((message) => ({
          id: `message:${message.id}`,
          label: messageText(message),
          kind: 'message' as const,
          chatId: message.chatId,
        })),
    ];
  }, [locale, props.chats, props.projectSearchMessages, search]);

  useEffect(() => {
    if (timelineRef.current !== null)
      timelineRef.current.scrollTop = props.conversationScroll.current;
  }, [props.activeChat?.id, props.conversationScroll, props.focus]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = props.composerDraft.trim();
    if (text.length === 0 || sending) return;
    setSending(true);
    setError(null);
    try {
      await props.onSend(text);
      props.onComposerDraftChange('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Commander could not accept the message.');
    } finally {
      setSending(false);
    }
  };

  const executeCommand = async (command: () => Promise<void>, fallback: string) => {
    if (commandPending) return;
    setCommandPending(true);
    setError(null);
    try {
      await command();
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback,
      );
    } finally {
      setCommandPending(false);
    }
  };

  return (
    <div className={`lucid-commander${props.focus ? ' is-focus' : ''}`}>
      <header className="lucid-commander-header">
        <label>
          <span className="sr-only">{locale === 'zh-CN' ? '当前对话' : 'Current Chat'}</span>
          <select
            value={props.activeChat?.id ?? ''}
            onChange={(event) =>
              void executeCommand(
                () => props.onSwitchChat(event.currentTarget.value),
                locale === 'zh-CN' ? '无法切换对话。' : 'The Chat could not be opened.',
              )
            }
            disabled={props.chats.length === 0 || commandPending}
          >
            {props.chats.length === 0 && (
              <option value="">{locale === 'zh-CN' ? '没有对话' : 'No Chats'}</option>
            )}
            {props.chats.map((chat) => (
              <option value={chat.id} key={chat.id}>
                {chat.title}
              </option>
            ))}
          </select>
        </label>
        {props.chatsHaveMore && (
          <button
            type="button"
            disabled={commandPending}
            onClick={() =>
              void executeCommand(
                props.onLoadMoreChats,
                locale === 'zh-CN' ? '无法载入更多对话。' : 'More Chats could not be loaded.',
              )
            }
          >
            <ChevronDown size={15} />
            <span>{locale === 'zh-CN' ? '载入更多对话' : 'Load more Chats'}</span>
          </button>
        )}
        <button
          type="button"
          disabled={commandPending}
          onClick={() =>
            void executeCommand(
              props.onCreateChat,
              locale === 'zh-CN' ? '无法创建对话。' : 'The Chat could not be created.',
            )
          }
          aria-label={appCopy(locale, 'newChat')}
          title={appCopy(locale, 'newChat')}
        >
          <MessageSquarePlus size={15} />
          <span>{appCopy(locale, 'newChat')}</span>
        </button>
        <ChatLifecycleMenu
          chat={props.activeChat}
          onArchive={props.onArchiveChat}
          onDelete={props.onDeleteChat}
        />
        <button
          type="button"
          onClick={() => {
            const opening = !searchOpen;
            setSearchOpen(opening);
            if (opening) {
              setError(null);
              void props.onPrepareSearch().catch((cause: unknown) => {
                setError(
                  cause instanceof Error ? cause.message : 'Project search could not be prepared.',
                );
              });
            }
          }}
          aria-pressed={searchOpen}
          aria-label={appCopy(locale, 'search')}
          title={appCopy(locale, 'search')}
        >
          <Search size={15} />
          <span>{appCopy(locale, 'search')}</span>
        </button>
        <button
          ref={props.focusButtonRef}
          type="button"
          onClick={props.focus ? props.onExitFocus : props.onFocus}
          aria-label={props.focus ? appCopy(locale, 'exitFocus') : appCopy(locale, 'focus')}
        >
          <Focus size={15} />
          <span>{props.focus ? appCopy(locale, 'exitFocus') : appCopy(locale, 'focus')}</span>
        </button>
      </header>
      {searchOpen && (
        <div className="lucid-chat-search">
          <Search size={14} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            placeholder={
              locale === 'zh-CN'
                ? '搜索当前项目的对话与消息'
                : 'Search this Project’s Chats and messages'
            }
            autoFocus
          />
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setSearchOpen(false);
            }}
            aria-label={locale === 'zh-CN' ? '关闭搜索' : 'Close search'}
          >
            <X size={14} />
          </button>
          {search.trim().length > 0 && (
            <div className="lucid-chat-search-results">
              {searchResults.length === 0 ? (
                <span>{locale === 'zh-CN' ? '没有匹配项' : 'No matches'}</span>
              ) : (
                searchResults.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() =>
                      void executeCommand(
                        async () => {
                          await props.onSwitchChat(result.chatId);
                          setSearchOpen(false);
                        },
                        locale === 'zh-CN'
                          ? '无法打开搜索结果。'
                          : 'The search result could not be opened.',
                      )
                    }
                  >
                    <small>{result.kind}</small>
                    {result.label}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
      <div className="lucid-commander-context-line">
        <strong>{props.project.name}</strong>
        <span>/</span>
        <span>{props.activeChat?.title ?? appCopy(locale, 'newChat')}</span>
      </div>

      <div
        className="lucid-conversation"
        ref={timelineRef}
        aria-live="polite"
        onScroll={(event) => {
          props.conversationScroll.current = event.currentTarget.scrollTop;
        }}
      >
        {props.messagesHaveMore && (
          <button
            className="lucid-conversation-pager"
            type="button"
            disabled={commandPending}
            onClick={() =>
              void executeCommand(
                props.onLoadEarlierMessages,
                locale === 'zh-CN' ? '无法载入更早消息。' : 'Earlier Messages could not be loaded.',
              )
            }
          >
            <ChevronDown size={14} />
            {locale === 'zh-CN' ? '载入更早消息' : 'Load earlier Messages'}
          </button>
        )}
        {props.messages.length === 0 && props.run === null ? (
          <div className="lucid-conversation-empty">
            <Bot size={21} />
            <p>{appCopy(locale, 'noConversation')}</p>
          </div>
        ) : (
          props.messages.map((message) => (
            <article className={`lucid-message is-${message.role}`} key={message.id}>
              <header>
                {message.role === 'user' ? <User size={14} /> : <Bot size={14} />}
                <strong>
                  {message.role === 'user' ? (locale === 'zh-CN' ? '你' : 'You') : 'Commander'}
                </strong>
                <time dateTime={message.createdAt}>
                  {new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(
                    new Date(message.createdAt),
                  )}
                </time>
              </header>
              <p>{messageText(message)}</p>
            </article>
          ))
        )}
        {props.run !== null && (
          <article className="lucid-message is-assistant lucid-active-response">
            <header>
              <Bot size={14} />
              <strong>Commander</strong>
              <span className={`lucid-run-state is-${props.run.status}`}>
                {props.run.status.replaceAll('_', ' ')}
              </span>
            </header>
            {props.run.status === 'recovering' && (
              <p className="lucid-recovering">
                <LoaderCircle size={13} />
                {locale === 'zh-CN'
                  ? '正在从已记录的公开状态恢复；不会重复执行。'
                  : 'Recovering recorded public state without duplicate execution.'}
              </p>
            )}
            {props.taskList !== null && <TaskListSurface taskList={props.taskList} />}
            <RunEvents
              events={props.events}
              onAnswerInteraction={props.onAnswerInteraction}
              onAnswerConfirmation={props.onAnswerConfirmation}
              onOpenWorkspace={props.onOpenWorkspace}
              onOpenResult={props.onOpenResult}
              resultDecisionStateForId={props.resultDecisionStateForId}
              resultDecisionDisabledReasonForId={props.resultDecisionDisabledReasonForId}
              onResultDecision={props.onResultDecision}
            />
            {props.eventsHaveMore && (
              <button
                className="lucid-conversation-pager"
                type="button"
                disabled={commandPending}
                onClick={() =>
                  void executeCommand(
                    props.onLoadMoreRunEvents,
                    locale === 'zh-CN'
                      ? '无法载入更多 Run 事件。'
                      : 'More Run events could not be loaded.',
                  )
                }
              >
                <ChevronDown size={14} />
                {locale === 'zh-CN' ? '载入更多 Run 事件' : 'Load more Run events'}
              </button>
            )}
            {isActiveRun(props.run) && (
              <div className="lucid-run-controls">
                {props.run.status === 'running' && (
                  <button
                    type="button"
                    disabled={commandPending}
                    onClick={() =>
                      void executeCommand(
                        () => props.onControlRun('pause'),
                        locale === 'zh-CN' ? '无法暂停 Run。' : 'The Run could not be paused.',
                      )
                    }
                  >
                    <Pause size={13} />
                    {appCopy(locale, 'pause')}
                  </button>
                )}
                {props.run.status === 'paused' && (
                  <button
                    type="button"
                    disabled={commandPending}
                    onClick={() =>
                      void executeCommand(
                        () => props.onControlRun('resume'),
                        locale === 'zh-CN' ? '无法继续 Run。' : 'The Run could not be resumed.',
                      )
                    }
                  >
                    <Play size={13} />
                    {appCopy(locale, 'resume')}
                  </button>
                )}
                <button
                  type="button"
                  className="is-stop"
                  disabled={commandPending}
                  onClick={() =>
                    void executeCommand(
                      () => props.onControlRun('cancel'),
                      locale === 'zh-CN' ? '无法停止 Run。' : 'The Run could not be stopped.',
                    )
                  }
                >
                  <CircleStop size={13} />
                  {appCopy(locale, 'stop')}
                </button>
              </div>
            )}
          </article>
        )}
      </div>

      <form className="lucid-composer" onSubmit={submit}>
        {refs.length > 0 && (
          <div className="lucid-context-chips" aria-label={appCopy(locale, 'context')}>
            {refs.map((ref) => (
              <button
                key={`${ref.authority}:${ref.id}`}
                type="button"
                onClick={() => props.onRemoveContext(ref)}
                aria-label={`${locale === 'zh-CN' ? '移除' : 'Remove'} ${props.labelForRef(ref)}`}
              >
                {ref.authority === 'project_media_ref' ? (
                  <FolderOpen size={13} />
                ) : (
                  <Clapperboard size={13} />
                )}
                <span>{props.labelForRef(ref)}</span>
                <X size={12} />
              </button>
            ))}
          </div>
        )}
        <textarea
          value={props.composerDraft}
          onChange={(event) => props.onComposerDraftChange(event.currentTarget.value)}
          placeholder={locale === 'zh-CN' ? '描述下一项修改…' : 'Describe the next change…'}
          rows={3}
        />
        {error !== null && (
          <p className="lucid-inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="lucid-composer-actions">
          <button
            type="button"
            aria-label={appCopy(locale, 'attachReference')}
            disabled={attaching}
            onClick={() => {
              setAttaching(true);
              setError(null);
              void props
                .onAttachReference()
                .catch((cause: unknown) => {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : 'Reference media could not be attached.',
                  );
                })
                .finally(() => setAttaching(false));
            }}
          >
            {attaching ? <LoaderCircle size={15} /> : <Paperclip size={15} />}
          </button>
          {props.pendingAttachments.length > 0 && (
            <span>
              {props.pendingAttachments.length} {locale === 'zh-CN' ? '个新参考' : 'new reference'}
            </span>
          )}
          {isActiveRun(props.run) && (
            <span>
              {locale === 'zh-CN'
                ? '将作为安全跟进或下一 Run 排队'
                : 'Safe follow-up or queued next Run'}
            </span>
          )}
          <button
            className="lucid-send-button"
            type="submit"
            disabled={sending || props.composerDraft.trim().length === 0}
          >
            <Send size={15} />
            {appCopy(locale, 'send')}
          </button>
        </div>
      </form>
      <footer className="lucid-commander-status">
        <span>
          <small>{appCopy(locale, 'model')}</small>
          <strong>
            {props.run?.model.model ?? props.settings.defaultProviderProfileId ?? '—'}
          </strong>
        </span>
        <span>
          <small>{appCopy(locale, 'permission')}</small>
          <strong>{props.run?.permissionMode ?? props.settings.permission}</strong>
        </span>
        <span>
          <small>{appCopy(locale, 'budget')}</small>
          <strong>{formatBudget(props.settings)}</strong>
        </span>
      </footer>
    </div>
  );
}
