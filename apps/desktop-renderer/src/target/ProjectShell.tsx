import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Archive,
  ChevronLeft,
  CircleEllipsis,
  Clapperboard,
  Film,
  FolderOpen,
  Images,
  LayoutDashboard,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  SlidersHorizontal,
  Upload,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import type {
  Chat,
  Message,
  MessageAttachment,
  Project,
  ProjectSettings,
  PublicRunEvent,
  Run,
} from '@lucid-fin/target-contracts';
import { targetResult, type TargetResult } from './api.js';
import { targetCopy } from './copy.js';
import { CommanderDock } from './CommanderDock.js';
import { useTargetEnvironment } from './environment.js';
import {
  EMPTY_TARGET_SELECTION,
  TARGET_WORKSPACES,
  selectionToRunContext,
  targetSelectionReducer,
  type TargetWorkspace,
} from './shared-selection.js';
import { ProjectWorkspace, type TargetWorkspaceData } from './Workspaces.js';

type Overview = TargetResult<'overview.get'>;

const WORKSPACE_ICONS = {
  overview: LayoutDashboard,
  canvas: Clapperboard,
  media: Images,
  production: SlidersHorizontal,
  delivery: Upload,
} as const;

function summary(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The target Project could not be loaded.';
}

function terminal(run: Run | null): boolean {
  return run !== null && ['completed', 'blocked', 'failed', 'cancelled'].includes(run.status);
}

function emptyWorkspaceData(): TargetWorkspaceData {
  return { canvas: null, media: [], production: [], delivery: null };
}

function readStoredNumber(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function readStoredBoolean(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

interface ProjectShellProps {
  readonly projectId: string;
  readonly workspace: TargetWorkspace;
  readonly onWorkspaceChange: (workspace: TargetWorkspace) => void;
  readonly onBack: () => void;
}

function ProjectSettingsDisclosure({
  project,
  settings,
  onRename,
  onSettingsChange,
}: {
  readonly project: Project;
  readonly settings: ProjectSettings;
  readonly onRename: (name: string) => Promise<void>;
  readonly onSettingsChange: (settings: ProjectSettings) => Promise<void>;
}) {
  const { locale } = useTargetEnvironment();
  const [name, setName] = useState(project.name);
  const [permission, setPermission] = useState(settings.permission);
  const [generationLimit, setGenerationLimit] = useState(settings.budget.maxGenerationCount);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setName(project.name), [project.name]);
  useEffect(() => {
    setPermission(settings.permission);
    setGenerationLimit(settings.budget.maxGenerationCount);
  }, [settings]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (name.trim() !== project.name) await onRename(name.trim());
      if (
        permission !== settings.permission ||
        generationLimit !== settings.budget.maxGenerationCount
      ) {
        await onSettingsChange({
          ...settings,
          permission,
          budget: { ...settings.budget, maxGenerationCount: generationLimit },
        });
      }
    } catch (cause) {
      setError(summary(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="target-project-settings">
      <summary>
        <CircleEllipsis size={15} />
        {targetCopy(locale, 'projectMenu')}
      </summary>
      <div className="target-project-settings-body">
        <label>
          <span>{locale === 'zh-CN' ? '项目名称' : 'Project name'}</span>
          <input value={name} onChange={(event) => setName(event.currentTarget.value)} />
        </label>
        <label>
          <span>{targetCopy(locale, 'permission')}</span>
          <select
            value={permission}
            onChange={(event) =>
              setPermission(event.currentTarget.value as ProjectSettings['permission'])
            }
          >
            <option value="read_only">{locale === 'zh-CN' ? '只读' : 'Read only'}</option>
            <option value="reversible">{locale === 'zh-CN' ? '可逆变更' : 'Reversible'}</option>
            <option value="full">{locale === 'zh-CN' ? '完整权限' : 'Full'}</option>
          </select>
        </label>
        <label>
          <span>{locale === 'zh-CN' ? '最多生成次数' : 'Generation limit'}</span>
          <input
            type="number"
            min={0}
            value={generationLimit}
            onChange={(event) => setGenerationLimit(Number(event.currentTarget.value))}
          />
        </label>
        <dl className="target-settings-facts">
          <div>
            <dt>{targetCopy(locale, 'model')}</dt>
            <dd>
              {settings.defaultProviderProfileId ??
                (locale === 'zh-CN' ? '项目默认' : 'Project default')}
            </dd>
          </div>
          <div>
            <dt>{locale === 'zh-CN' ? '格式' : 'Format'}</dt>
            <dd>
              {settings.formatPolicy.aspectRatio} · {settings.formatPolicy.frameRate} fps
            </dd>
          </div>
        </dl>
        <div className="target-skill-note">
          <strong>
            {locale === 'zh-CN' ? 'Skills' : 'Skills'} · {settings.enabledSkills.length}
          </strong>
          <span>{targetCopy(locale, 'skillHint')}</span>
        </div>
        {error !== null && (
          <p role="alert" className="target-inline-error">
            {error}
          </p>
        )}
        <button
          className="target-primary-button"
          type="button"
          onClick={() => void save()}
          disabled={saving || name.trim().length === 0}
        >
          {saving
            ? targetCopy(locale, 'loading')
            : locale === 'zh-CN'
              ? '保存项目设置'
              : 'Save Project settings'}
        </button>
      </div>
    </details>
  );
}

export function ProjectShell({
  projectId,
  workspace,
  onWorkspaceChange,
  onBack,
}: ProjectShellProps) {
  const { api, createRequestId, locale } = useTargetEnvironment();
  const location = useLocation();
  const requestedChatId = useMemo(
    () => new URLSearchParams(location.search).get('chat'),
    [location.search],
  );
  const requestedRunId = useMemo(
    () => new URLSearchParams(location.search).get('run'),
    [location.search],
  );
  const requestedRunRef = useRef(requestedRunId);
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [chats, setChats] = useState<readonly Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(requestedChatId);
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<readonly PublicRunEvent[]>([]);
  const [workspaceData, setWorkspaceData] = useState<TargetWorkspaceData>(emptyWorkspaceData);
  const [selection, dispatchSelection] = useReducer(targetSelectionReducer, EMPTY_TARGET_SELECTION);
  const [composerDraft, setComposerDraft] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<readonly MessageAttachment[]>([]);
  const [projectSearchMessages, setProjectSearchMessages] = useState<readonly Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(() =>
    readStoredBoolean(`lucid-fin:target:dock-collapsed:${projectId}`),
  );
  const [dockWidth, setDockWidth] = useState(() =>
    Math.min(480, Math.max(352, readStoredNumber(`lucid-fin:target:dock-width:${projectId}`, 400))),
  );
  const workspaceScrollRef = useRef<HTMLDivElement>(null);
  const restoreScrollRef = useRef(0);
  const conversationScrollRef = useRef(0);
  const searchIndexSignatureRef = useRef('');

  const refreshOverview = useCallback(async () => {
    const next = await targetResult(
      api.overview.get({ requestId: createRequestId(), input: { projectId } }),
    );
    setOverview(next);
    setProject(next.project);
    return next;
  }, [api, createRequestId, projectId]);

  const loadWorkspaceProjections = useCallback(async () => {
    const page = { cursor: null, limit: 200 } as const;
    const [canvas, media, production, delivery] = await Promise.all([
      targetResult(api.canvas.get({ requestId: createRequestId(), input: { projectId } })),
      targetResult(
        api.media.projectList({
          requestId: createRequestId(),
          input: { projectId, roles: [], query: '', page },
        }),
      ),
      targetResult(
        api.production.query({
          requestId: createRequestId(),
          input: {
            projectId,
            ids: [],
            types: [],
            includeArchived: true,
            includeFactSources: true,
            page,
          },
        }),
      ),
      targetResult(
        api.delivery.query({
          requestId: createRequestId(),
          input: { projectId, deliveryPlanIds: [], page },
        }),
      ),
    ]);
    setWorkspaceData({
      canvas,
      media: media.items,
      production: production.items,
      delivery,
    });
  }, [api, createRequestId, projectId]);

  const loadTranscript = useCallback(
    async (chatId: string, activeOverview: Overview | null, preferredRunId?: string | null) => {
      const page = await targetResult(
        api.message.list({
          requestId: createRequestId(),
          input: { chatId, beforeSequence: null, page: { cursor: null, limit: 200 } },
        }),
      );
      setMessages(page.items);
      const runId =
        preferredRunId ??
        activeOverview?.activeRuns.find((candidate) => candidate.chatId === chatId)?.id ??
        [...page.items]
          .reverse()
          .find(
            (message): message is Extract<Message, { role: 'assistant' }> =>
              message.role === 'assistant',
          )?.originatingRunId ??
        null;
      if (runId === null) {
        setCurrentRun(null);
        setEvents([]);
        return;
      }
      try {
        const [run, publicEvents] = await Promise.all([
          targetResult(api.run.get({ requestId: createRequestId(), input: { runId } })),
          targetResult(
            api.run.eventsList({
              requestId: createRequestId(),
              input: { runId, afterSequence: null, page: { cursor: null, limit: 200 } },
            }),
          ),
        ]);
        setCurrentRun(run);
        setEvents(publicEvents.items);
      } catch {
        setCurrentRun(null);
        setEvents([]);
      }
    },
    [api, createRequestId],
  );

  const hydrate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = { cursor: null, limit: 200 } as const;
      const [loadedProject, loadedSettings, loadedOverview, chatPage] = await Promise.all([
        targetResult(api.project.get({ requestId: createRequestId(), input: { projectId } })),
        targetResult(
          api.project.settingsGet({ requestId: createRequestId(), input: { projectId } }),
        ),
        targetResult(api.overview.get({ requestId: createRequestId(), input: { projectId } })),
        targetResult(
          api.chat.list({
            requestId: createRequestId(),
            input: { projectId, lifecycle: ['active'], page },
          }),
        ),
      ]);
      setProject(loadedProject);
      setSettings(loadedSettings);
      setOverview(loadedOverview);
      setChats(chatPage.items);
      const nextChat =
        chatPage.items.find((chat) => chat.id === requestedChatId)?.id ??
        chatPage.items[0]?.id ??
        null;
      setActiveChatId(nextChat);
      await loadWorkspaceProjections();
      if (nextChat !== null) {
        await loadTranscript(nextChat, loadedOverview, requestedRunRef.current);
        requestedRunRef.current = null;
      }
    } catch (cause) {
      setError(summary(cause));
    } finally {
      setLoading(false);
    }
  }, [api, createRequestId, loadTranscript, loadWorkspaceProjections, projectId, requestedChatId]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    try {
      localStorage.setItem(`lucid-fin:target:last-workspace:${projectId}`, workspace);
    } catch {
      // URL remains the route authority when storage is unavailable.
    }
  }, [projectId, workspace]);

  useEffect(() => {
    return api.run.onEventsAppended((push) => {
      const event = push.payload.event;
      if (event.runId !== currentRun?.id) return;
      setEvents((current) =>
        current.some((candidate) => candidate.eventId === event.eventId)
          ? current
          : [...current, event].sort((left, right) => left.sequence - right.sequence),
      );
      if (
        event.payloadState.state === 'available' &&
        (event.payloadState.payload.type === 'run_state_changed' ||
          event.payloadState.payload.type === 'terminal_summary')
      ) {
        void targetResult(
          api.run.get({ requestId: createRequestId(), input: { runId: event.runId } }),
        ).then(setCurrentRun, () => undefined);
        void refreshOverview();
      }
    });
  }, [api, createRequestId, currentRun?.id, refreshOverview]);

  useEffect(() => {
    if (!focus) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      setFocus(false);
      requestAnimationFrame(() => {
        if (workspaceScrollRef.current)
          workspaceScrollRef.current.scrollTop = restoreScrollRef.current;
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [focus]);

  const switchChat = async (chatId: string) => {
    setActiveChatId(chatId);
    conversationScrollRef.current = 0;
    await loadTranscript(chatId, overview);
  };

  const createChat = async () => {
    const chat = await targetResult(
      api.chat.create({
        requestId: createRequestId(),
        input: {
          projectId,
          title:
            locale === 'zh-CN'
              ? `制作对话 ${chats.length + 1}`
              : `Production chat ${chats.length + 1}`,
        },
      }),
    );
    setChats((current) => [...current, chat]);
    setActiveChatId(chat.id);
    setMessages([]);
    setCurrentRun(null);
    setEvents([]);
    setComposerDraft('');
    setPendingAttachments([]);
    conversationScrollRef.current = 0;
    searchIndexSignatureRef.current = '';
  };

  const prepareProjectSearch = async () => {
    const signature = chats.map((chat) => `${chat.id}:${chat.revision}`).join('|');
    if (searchIndexSignatureRef.current === signature) return;
    const pages = await Promise.all(
      chats.map((chat) =>
        targetResult(
          api.message.list({
            requestId: createRequestId(),
            input: {
              chatId: chat.id,
              beforeSequence: null,
              page: { cursor: null, limit: 200 },
            },
          }),
        ),
      ),
    );
    const unique = new Map<string, Message>();
    for (const page of pages) for (const message of page.items) unique.set(message.id, message);
    setProjectSearchMessages([...unique.values()]);
    searchIndexSignatureRef.current = signature;
  };

  const attachReference = async () => {
    const grant = await targetResult(
      api.os.mediaPick({
        requestId: createRequestId(),
        input: { kinds: ['image', 'video', 'audio', 'document'], multiple: false },
      }),
    );
    const imported = await targetResult(
      api.media.globalImport({
        requestId: createRequestId(),
        input: {
          capabilityToken: grant.capabilityToken,
          displayName: null,
          tags: ['reference'],
        },
      }),
    );
    const latestProject = await targetResult(
      api.project.get({ requestId: createRequestId(), input: { projectId } }),
    );
    const existing = workspaceData.media.find((media) => media.globalAssetId === imported.asset.id);
    const attached = await targetResult(
      api.media.projectAttach({
        requestId: createRequestId(),
        input: {
          projectId,
          expectedProjectRevision: latestProject.revision,
          globalAssetId: imported.asset.id,
          expectedExistingRef:
            existing === undefined
              ? null
              : {
                  id: existing.id,
                  expectedRevision: existing.revision,
                  expectedContentHash: existing.contentHash,
                },
          label:
            grant.displayLabel.split(/[\\/]/).filter(Boolean).at(-1)?.slice(0, 240) ??
            imported.asset.displayName,
          collections: [],
          roles: ['reference'],
          notes: '',
        },
      }),
    );
    const attachment: MessageAttachment = {
      projectMediaRefId: attached.object.id,
      globalAssetId: imported.asset.id,
      blobHash: imported.asset.blobHash,
      role: 'attachment',
    };
    setPendingAttachments((current) => [
      ...current.filter((item) => item.projectMediaRefId !== attachment.projectMediaRefId),
      attachment,
    ]);
    dispatchSelection({
      type: 'support',
      ref: {
        authority: 'project_media_ref',
        id: attached.object.id,
        revision: attached.object.revision,
        contentHash: attached.object.contentHash,
      },
    });
    const refreshedProject = await targetResult(
      api.project.get({ requestId: createRequestId(), input: { projectId } }),
    );
    setProject(refreshedProject);
    await loadWorkspaceProjections();
  };

  const send = async (text: string) => {
    if (activeChatId === null) throw new Error('Create a Project Chat before sending.');
    if (currentRun !== null && !terminal(currentRun)) {
      await targetResult(
        api.run.sendFollowup({
          requestId: createRequestId(),
          input: {
            runId: currentRun.id,
            expectedRevision: currentRun.revision,
            text,
            selectedContext: [...selectionToRunContext(selection)],
          },
        }),
      );
      setPendingAttachments([]);
      return;
    }
    const accepted = await targetResult(
      api.message.send({
        requestId: createRequestId(),
        input: {
          chatId: activeChatId,
          blocks: [{ type: 'text', text }],
          attachments: [...pendingAttachments],
          selectedContext: [...selectionToRunContext(selection)],
          supersedesMessageId: null,
        },
      }),
    );
    setMessages((current) => [...current, accepted.message]);
    setCurrentRun(accepted.acceptedRun);
    setEvents([]);
    setPendingAttachments([]);
    await refreshOverview();
  };

  const controlRun = async (action: 'pause' | 'resume' | 'cancel') => {
    if (currentRun === null) return;
    const input =
      action === 'cancel'
        ? {
            runId: currentRun.id,
            expectedRevision: currentRun.revision,
            action,
            expectedStatus: currentRun.status as Extract<
              Run['status'],
              | 'accepted'
              | 'running'
              | 'waiting_question'
              | 'waiting_confirmation'
              | 'paused'
              | 'recovering'
            >,
            terminalSummary:
              locale === 'zh-CN'
                ? '用户从 Commander 停止了此 Run。'
                : 'Stopped by the user from Commander.',
          }
        : action === 'pause'
          ? {
              runId: currentRun.id,
              expectedRevision: currentRun.revision,
              action,
              expectedStatus: 'running' as const,
            }
          : {
              runId: currentRun.id,
              expectedRevision: currentRun.revision,
              action,
              expectedStatus: 'paused' as const,
            };
    const next = await targetResult(api.run.control({ requestId: createRequestId(), input }));
    setCurrentRun(next);
    await refreshOverview();
  };

  const answerInteraction = async (interactionId: string, text: string) => {
    await targetResult(
      api.interaction.answer({
        requestId: createRequestId(),
        input: { interactionId, answer: { kind: 'free_text', text } },
      }),
    );
    await refreshOverview();
  };

  const answerConfirmation = async (
    confirmationId: string,
    immutableInputHash: string,
    decision: 'approved' | 'denied',
  ) => {
    await targetResult(
      api.confirmation.respond({
        requestId: createRequestId(),
        input: { confirmationId, immutableInputHash, decision },
      }),
    );
    await refreshOverview();
  };

  const rename = async (name: string) => {
    if (project === null) return;
    const updated = await targetResult(
      api.project.update({
        requestId: createRequestId(),
        input: {
          projectId,
          expectedRevision: project.revision,
          name,
          lifecycle: null,
        },
      }),
    );
    setProject(updated);
  };

  const updateSettings = async (next: ProjectSettings) => {
    if (settings === null) return;
    const updated = await targetResult(
      api.project.settingsUpdate({
        requestId: createRequestId(),
        input: {
          projectId,
          expectedRevision: settings.revision,
          expectedContentHash: settings.contentHash,
          defaultProviderProfileId: next.defaultProviderProfileId,
          formatPolicy: next.formatPolicy,
          permission: next.permission,
          budget: next.budget,
          enabledSkills: next.enabledSkills,
        },
      }),
    );
    setSettings(updated);
  };

  const enterFocus = () => {
    restoreScrollRef.current = workspaceScrollRef.current?.scrollTop ?? 0;
    setFocus(true);
  };
  const exitFocus = () => {
    setFocus(false);
    requestAnimationFrame(() => {
      if (workspaceScrollRef.current)
        workspaceScrollRef.current.scrollTop = restoreScrollRef.current;
    });
  };

  const setStoredDockWidth = (width: number) => {
    setDockWidth(width);
    try {
      localStorage.setItem(`lucid-fin:target:dock-width:${projectId}`, String(width));
    } catch {
      // The live width remains valid for this session.
    }
  };
  const toggleDock = () => {
    setDockCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(`lucid-fin:target:dock-collapsed:${projectId}`, String(next));
      } catch {
        // The live collapsed state remains valid for this session.
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="target-full-state" role="status">
        <span className="target-spinner" />
        {targetCopy(locale, 'loading')}
      </div>
    );
  }
  if (error !== null || project === null || settings === null || overview === null) {
    return (
      <div className="target-full-state target-state-error" role="alert">
        <strong>{locale === 'zh-CN' ? '无法打开项目' : 'Project could not open'}</strong>
        <span>{error ?? 'Required Project state is unavailable.'}</span>
        <div>
          <button type="button" onClick={() => void hydrate()}>
            {targetCopy(locale, 'retry')}
          </button>
          <button type="button" onClick={onBack}>
            {targetCopy(locale, 'backToProjects')}
          </button>
        </div>
      </div>
    );
  }

  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? null;
  const activeTaskList =
    overview.taskLists.find((taskList) => taskList.runId === currentRun?.id) ?? null;
  const labels = new Map<string, string>();
  for (const view of workspaceData.production) {
    const object = view.object;
    const label =
      'title' in object.content
        ? object.content.title
        : 'name' in object.content
          ? object.content.name
          : object.type;
    labels.set(`${object.authority}:${object.id}`, label);
  }
  for (const media of workspaceData.media)
    labels.set(`${media.authority}:${media.id}`, media.label);

  const commander = (
    <CommanderDock
      project={project}
      settings={settings}
      chats={chats}
      activeChat={activeChat}
      messages={messages}
      projectSearchMessages={projectSearchMessages}
      run={currentRun}
      events={events}
      taskList={activeTaskList}
      selection={selection}
      composerDraft={composerDraft}
      pendingAttachments={pendingAttachments}
      conversationScroll={conversationScrollRef}
      labelForRef={(ref) => labels.get(`${ref.authority}:${ref.id}`) ?? ref.id}
      focus={focus}
      onFocus={enterFocus}
      onExitFocus={exitFocus}
      onSwitchChat={(chatId) => void switchChat(chatId)}
      onCreateChat={() => void createChat()}
      onPrepareSearch={prepareProjectSearch}
      onComposerDraftChange={setComposerDraft}
      onAttachReference={attachReference}
      onSend={send}
      onControlRun={controlRun}
      onAnswerInteraction={answerInteraction}
      onAnswerConfirmation={answerConfirmation}
      onRemoveContext={(ref) =>
        dispatchSelection({ type: 'remove', authority: ref.authority, id: ref.id })
      }
      onOpenWorkspace={(next) => {
        setFocus(false);
        onWorkspaceChange(next);
      }}
    />
  );

  if (focus) {
    return (
      <div className="target-focus-shell">
        <aside
          className="target-focus-chats"
          aria-label={locale === 'zh-CN' ? '项目对话' : 'Project Chats'}
        >
          <strong>{project.name}</strong>
          <div className="target-focus-chat-list">
            {chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className={chat.id === activeChatId ? 'is-active' : ''}
                onClick={() => void switchChat(chat.id)}
              >
                {chat.title}
              </button>
            ))}
          </div>
        </aside>
        <section className="target-focus-conversation">{commander}</section>
        <aside
          className="target-focus-inspector"
          aria-label={locale === 'zh-CN' ? '结果检查器' : 'Result inspector'}
        >
          <div className="target-inspector-empty">
            <Film size={20} />
            <strong>{locale === 'zh-CN' ? '选择结果以检查' : 'Select a result to inspect'}</strong>
            <span>
              {locale === 'zh-CN'
                ? '检查器在选择前保持折叠语义。'
                : 'Project changes and result detail appear here only when selected.'}
            </span>
          </div>
        </aside>
      </div>
    );
  }

  const counts = {
    overview: overview.activeRuns.length,
    canvas: workspaceData.canvas?.placements.length ?? 0,
    media: workspaceData.media.length,
    production: workspaceData.production.length,
    delivery: workspaceData.delivery?.plans.length ?? 0,
  };

  return (
    <div
      className={`target-project-shell${dockCollapsed ? ' is-dock-collapsed' : ''}`}
      style={{ '--target-dock-width': `${dockWidth}px` } as React.CSSProperties}
    >
      <nav
        className="target-global-rail"
        aria-label={locale === 'zh-CN' ? '全局导航' : 'Global navigation'}
      >
        <button
          className="target-rail-button"
          type="button"
          onClick={onBack}
          aria-label={targetCopy(locale, 'projects')}
          title={targetCopy(locale, 'projects')}
        >
          <FolderOpen size={19} />
        </button>
        <button
          className="target-rail-button"
          type="button"
          aria-disabled="true"
          aria-label={targetCopy(locale, 'globalMedia')}
          title={targetCopy(locale, 'unsupported')}
        >
          <Film size={19} />
        </button>
        <span className="target-rail-spacer" />
        <button
          className="target-rail-button"
          type="button"
          aria-disabled="true"
          aria-label={targetCopy(locale, 'settings')}
          title={targetCopy(locale, 'unsupported')}
        >
          <Settings size={19} />
        </button>
      </nav>
      <aside className="target-project-navigation">
        <header>
          <div>
            <span>{locale === 'zh-CN' ? '项目' : 'Project'}</span>
            <strong>{project.name}</strong>
          </div>
          <button
            type="button"
            aria-label={targetCopy(locale, 'projectMenu')}
            onClick={() =>
              document
                .querySelector<HTMLDetailsElement>('.target-project-settings')
                ?.toggleAttribute('open')
            }
          >
            <CircleEllipsis size={16} />
          </button>
        </header>
        <nav aria-label={locale === 'zh-CN' ? '项目工作区' : 'Project workspace'}>
          {TARGET_WORKSPACES.map((item) => {
            const Icon = WORKSPACE_ICONS[item];
            return (
              <button
                key={item}
                type="button"
                className={workspace === item ? 'is-active' : ''}
                aria-current={workspace === item ? 'page' : undefined}
                onClick={() => onWorkspaceChange(item)}
              >
                <Icon size={16} />
                <span>{targetCopy(locale, item)}</span>
                <small>{counts[item]}</small>
              </button>
            );
          })}
        </nav>
        <div className="target-project-navigation-footer">
          <ProjectSettingsDisclosure
            project={project}
            settings={settings}
            onRename={rename}
            onSettingsChange={updateSettings}
          />
          <button
            className="target-archive-button"
            type="button"
            aria-disabled="true"
            title={targetCopy(locale, 'unsupported')}
          >
            <Archive size={14} />
            {locale === 'zh-CN' ? '归档项目' : 'Archive Project'}
          </button>
        </div>
      </aside>
      <section className="target-workspace-column">
        <header className="target-workspace-header">
          <button className="target-narrow-back" type="button" onClick={onBack}>
            <ChevronLeft size={15} />
            {targetCopy(locale, 'projects')}
          </button>
          <div>
            <h1>{project.name}</h1>
            <span className="target-status-dot" />
            {currentRun === null || terminal(currentRun)
              ? locale === 'zh-CN'
                ? '就绪'
                : 'Ready'
              : locale === 'zh-CN'
                ? '进行中'
                : 'In progress'}
          </div>
          <button
            className="target-dock-toggle"
            type="button"
            onClick={toggleDock}
            aria-label={
              dockCollapsed
                ? targetCopy(locale, 'openCommander')
                : locale === 'zh-CN'
                  ? '收起 Commander'
                  : 'Collapse Commander'
            }
          >
            {dockCollapsed ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}
          </button>
        </header>
        <div className="target-workspace-scroll" ref={workspaceScrollRef}>
          <ProjectWorkspace
            workspace={workspace}
            overview={overview}
            data={workspaceData}
            selection={selection}
            onSelect={(ref) => dispatchSelection({ type: 'select', ref })}
            onOpenWorkspace={onWorkspaceChange}
          />
        </div>
      </section>
      {!dockCollapsed && (
        <>
          <DockResizeHandle width={dockWidth} onWidthChange={setStoredDockWidth} />
          <aside className="target-commander-column" aria-label={targetCopy(locale, 'commander')}>
            {commander}
          </aside>
        </>
      )}
      {dockCollapsed && (
        <button
          className="target-collapsed-dock"
          type="button"
          onClick={toggleDock}
          aria-label={targetCopy(locale, 'openCommander')}
        >
          <PanelRightOpen size={18} />
          <span>{targetCopy(locale, 'commander')}</span>
        </button>
      )}
    </div>
  );
}

function DockResizeHandle({
  width,
  onWidthChange,
}: {
  readonly width: number;
  readonly onWidthChange: (width: number) => void;
}) {
  const startWidth = useRef(width);
  const startX = useRef(0);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    startWidth.current = width;
    startX.current = event.clientX;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    onWidthChange(
      Math.min(480, Math.max(352, startWidth.current + startX.current - event.clientX)),
    );
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') onWidthChange(Math.min(480, width + 16));
    if (event.key === 'ArrowRight') onWidthChange(Math.max(352, width - 16));
  };
  return (
    <div
      className="target-dock-resizer"
      role="separator"
      aria-label="Resize Commander"
      aria-orientation="vertical"
      aria-valuemin={352}
      aria-valuemax={480}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    />
  );
}
