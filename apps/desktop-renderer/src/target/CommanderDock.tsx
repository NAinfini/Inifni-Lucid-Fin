import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  Clapperboard,
  Circle,
  CircleStop,
  Focus,
  FolderOpen,
  LoaderCircle,
  MessageSquarePlus,
  Paperclip,
  Pause,
  Play,
  Search,
  Send,
  Sparkles,
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
} from '@lucid-fin/target-contracts';
import { targetCopy } from './copy.js';
import { useTargetEnvironment } from './environment.js';
import type { TargetSharedSelection, TargetWorkspace } from './shared-selection.js';

interface CommanderDockProps {
  readonly project: Project;
  readonly settings: ProjectSettings;
  readonly chats: readonly Chat[];
  readonly activeChat: Chat | null;
  readonly messages: readonly Message[];
  readonly projectSearchMessages: readonly Message[];
  readonly run: Run | null;
  readonly events: readonly PublicRunEvent[];
  readonly taskList: TaskList | null;
  readonly selection: TargetSharedSelection;
  readonly labelForRef: (ref: DomainObjectRef) => string;
  readonly focus: boolean;
  readonly composerDraft: string;
  readonly pendingAttachments: readonly MessageAttachment[];
  readonly conversationScroll: { current: number };
  readonly onFocus: () => void;
  readonly onExitFocus: () => void;
  readonly onSwitchChat: (chatId: string) => void;
  readonly onCreateChat: () => void;
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
  readonly onOpenWorkspace: (workspace: TargetWorkspace) => void;
}

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
    <section className="target-task-list" aria-label={taskList.title}>
      <header>{taskList.title}</header>
      <ol>
        {[...taskList.items]
          .sort((left, right) => left.order - right.order)
          .map((item) => (
            <li key={item.id} data-state={item.state}>
              <span className="target-task-icon" aria-hidden="true">
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
  const { locale } = useTargetEnvironment();
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  if (event.payloadState.state !== 'available' || event.payloadState.payload.type !== 'question')
    return null;
  const payload = event.payloadState.payload;
  return (
    <form
      className="target-inline-interaction"
      onSubmit={(submitEvent) => {
        submitEvent.preventDefault();
        if (answer.trim().length === 0) return;
        setSending(true);
        void onAnswer(payload.interactionId, answer.trim()).finally(() => setSending(false));
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
    </form>
  );
}

function ConfirmationEvent({
  event,
  onAnswer,
}: {
  readonly event: PublicRunEvent;
  readonly onAnswer: CommanderDockProps['onAnswerConfirmation'];
}) {
  const { locale } = useTargetEnvironment();
  const [sending, setSending] = useState(false);
  if (
    event.payloadState.state !== 'available' ||
    event.payloadState.payload.type !== 'confirmation_requested'
  )
    return null;
  const payload = event.payloadState.payload;
  const decide = (decision: 'approved' | 'denied') => {
    setSending(true);
    void onAnswer(payload.interactionId, payload.immutableInputHash, decision).finally(() =>
      setSending(false),
    );
  };
  return (
    <section
      className="target-inline-confirmation"
      aria-label={locale === 'zh-CN' ? '受保护确认' : 'Protected confirmation'}
    >
      <AlertCircle size={16} />
      <div>
        <strong>{payload.summary}</strong>
        <small>{payload.target.kind.replaceAll('_', ' ')}</small>
        <div>
          <button type="button" onClick={() => decide('denied')} disabled={sending}>
            {locale === 'zh-CN' ? '拒绝' : 'Deny'}
          </button>
          <button type="button" onClick={() => decide('approved')} disabled={sending}>
            {locale === 'zh-CN' ? '确认' : 'Approve'}
          </button>
        </div>
      </div>
    </section>
  );
}

function RunEvents({
  events,
  onAnswerInteraction,
  onAnswerConfirmation,
  onOpenWorkspace,
}: Pick<
  CommanderDockProps,
  'events' | 'onAnswerInteraction' | 'onAnswerConfirmation' | 'onOpenWorkspace'
>) {
  const { locale } = useTargetEnvironment();
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
    <div className="target-run-events">
      {available.map((event) => {
        const payload = event.payloadState.payload;
        if (payload.type === 'progress')
          return (
            <p className="target-progress-line" key={event.eventId}>
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
            <article className="target-result-card" key={event.eventId}>
              <span className="target-result-preview">
                <Sparkles size={22} />
              </span>
              <div>
                <strong>{payload.summary}</strong>
                <small>{payload.resultId}</small>
                <div>
                  <button
                    type="button"
                    aria-disabled="true"
                    title={targetCopy(locale, 'unsupported')}
                  >
                    {locale === 'zh-CN' ? '选择' : 'Select'}
                  </button>
                  <button
                    type="button"
                    aria-disabled="true"
                    title={targetCopy(locale, 'unsupported')}
                  >
                    {locale === 'zh-CN' ? '精修' : 'Refine'}
                  </button>
                  <button type="button" onClick={() => onOpenWorkspace('media')}>
                    {locale === 'zh-CN' ? '在媒体中打开' : 'Open in Media'}
                  </button>
                </div>
              </div>
            </article>
          );
        if (payload.type === 'blocker')
          return (
            <p className="target-blocker" key={event.eventId}>
              <AlertCircle size={14} />
              <span>
                <strong>{payload.message}</strong>
                <small>{payload.code.replaceAll('_', ' ')}</small>
              </span>
            </p>
          );
        if (payload.type === 'terminal_summary')
          return (
            <section className="target-terminal-summary" key={event.eventId}>
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
            <details className="target-child-run" key={event.eventId}>
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
            <p className="target-purpose-summary" key={event.eventId}>
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
        <details className="target-execution-details">
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

export function CommanderDock(props: CommanderDockProps) {
  const { locale } = useTargetEnvironment();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
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

  return (
    <div className={`target-commander${props.focus ? ' is-focus' : ''}`}>
      <header className="target-commander-header">
        <label>
          <span className="sr-only">{locale === 'zh-CN' ? '当前对话' : 'Current Chat'}</span>
          <select
            value={props.activeChat?.id ?? ''}
            onChange={(event) => props.onSwitchChat(event.currentTarget.value)}
            disabled={props.chats.length === 0}
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
        <button
          type="button"
          onClick={props.onCreateChat}
          aria-label={targetCopy(locale, 'newChat')}
          title={targetCopy(locale, 'newChat')}
        >
          <MessageSquarePlus size={15} />
          <span>{targetCopy(locale, 'newChat')}</span>
        </button>
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
          aria-label={targetCopy(locale, 'search')}
          title={targetCopy(locale, 'search')}
        >
          <Search size={15} />
          <span>{targetCopy(locale, 'search')}</span>
        </button>
        <button
          type="button"
          onClick={props.focus ? props.onExitFocus : props.onFocus}
          aria-label={props.focus ? targetCopy(locale, 'exitFocus') : targetCopy(locale, 'focus')}
        >
          <Focus size={15} />
          <span>{props.focus ? targetCopy(locale, 'exitFocus') : targetCopy(locale, 'focus')}</span>
        </button>
      </header>
      {searchOpen && (
        <div className="target-chat-search">
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
            <div className="target-chat-search-results">
              {searchResults.length === 0 ? (
                <span>{locale === 'zh-CN' ? '没有匹配项' : 'No matches'}</span>
              ) : (
                searchResults.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => props.onSwitchChat(result.chatId)}
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
      <div className="target-commander-context-line">
        <strong>{props.project.name}</strong>
        <span>/</span>
        <span>{props.activeChat?.title ?? targetCopy(locale, 'newChat')}</span>
      </div>

      <div
        className="target-conversation"
        ref={timelineRef}
        aria-live="polite"
        onScroll={(event) => {
          props.conversationScroll.current = event.currentTarget.scrollTop;
        }}
      >
        {props.messages.length === 0 && props.run === null ? (
          <div className="target-conversation-empty">
            <Bot size={21} />
            <p>{targetCopy(locale, 'noConversation')}</p>
          </div>
        ) : (
          props.messages.map((message) => (
            <article className={`target-message is-${message.role}`} key={message.id}>
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
          <article className="target-message is-assistant target-active-response">
            <header>
              <Bot size={14} />
              <strong>Commander</strong>
              <span className={`target-run-state is-${props.run.status}`}>
                {props.run.status.replaceAll('_', ' ')}
              </span>
            </header>
            {props.run.status === 'recovering' && (
              <p className="target-recovering">
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
            />
            {isActiveRun(props.run) && (
              <div className="target-run-controls">
                {props.run.status === 'running' && (
                  <button type="button" onClick={() => void props.onControlRun('pause')}>
                    <Pause size={13} />
                    {targetCopy(locale, 'pause')}
                  </button>
                )}
                {props.run.status === 'paused' && (
                  <button type="button" onClick={() => void props.onControlRun('resume')}>
                    <Play size={13} />
                    {targetCopy(locale, 'resume')}
                  </button>
                )}
                <button
                  type="button"
                  className="is-stop"
                  onClick={() => void props.onControlRun('cancel')}
                >
                  <CircleStop size={13} />
                  {targetCopy(locale, 'stop')}
                </button>
              </div>
            )}
          </article>
        )}
      </div>

      <form className="target-composer" onSubmit={submit}>
        {refs.length > 0 && (
          <div className="target-context-chips" aria-label={targetCopy(locale, 'context')}>
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
          <p className="target-inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="target-composer-actions">
          <button
            type="button"
            aria-label={targetCopy(locale, 'attachReference')}
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
            className="target-send-button"
            type="submit"
            disabled={sending || props.composerDraft.trim().length === 0}
          >
            <Send size={15} />
            {targetCopy(locale, 'send')}
          </button>
        </div>
      </form>
      <footer className="target-commander-status">
        <span>
          <small>{targetCopy(locale, 'model')}</small>
          <strong>
            {props.run?.model.model ?? props.settings.defaultProviderProfileId ?? '—'}
          </strong>
        </span>
        <span>
          <small>{targetCopy(locale, 'permission')}</small>
          <strong>{props.run?.permissionMode ?? props.settings.permission}</strong>
        </span>
        <span>
          <small>{targetCopy(locale, 'budget')}</small>
          <strong>{formatBudget(props.settings)}</strong>
        </span>
      </footer>
    </div>
  );
}
