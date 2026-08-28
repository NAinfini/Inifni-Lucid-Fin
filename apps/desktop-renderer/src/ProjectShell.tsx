import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  Archive,
  ChevronLeft,
  CircleEllipsis,
  Clapperboard,
  Film,
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
  DeliveryDestinationGrantV1,
  DeliveryRef,
  DomainObjectRef,
  Message,
  MessageAttachment,
  Project,
  ProjectSettings,
  PublicRunEvent,
  Run,
  SelectedContextRef,
  DesktopCallV1,
} from '@lucid-fin/contracts';
import { DesktopApiError, wireResult, type WireResult } from './api.js';
import { appCopy } from './copy.js';
import { CommanderDock } from './CommanderDock.js';
import { useDesktopEnvironment } from './environment.js';
import { GlobalRail } from './GlobalRail.js';
import { ProjectSettingsPanel } from './ProjectSettingsPanel.js';
import { ProtectionControl, type PendingProtectionConfirmation } from './ProtectionControl.js';
import type { ResultDecisionAction, ResultDecisionState } from './ResultDecisionControls.js';
import { ResultDecisionControls } from './ResultDecisionControls.js';
import {
  EMPTY_SELECTION,
  WORKSPACES,
  selectionToRunContext,
  selectionReducer,
  type Workspace,
} from './shared-selection.js';
import { ProjectWorkspace, type WorkspaceData } from './Workspaces.js';

type Overview = WireResult<'overview.get'>;
const OPERATION_GET_BATCH_SIZE = 100;

const WORKSPACE_ICONS = {
  overview: LayoutDashboard,
  canvas: Clapperboard,
  media: Images,
  production: SlidersHorizontal,
  delivery: Upload,
} as const;

function summary(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The Project could not be loaded.';
}

function terminal(run: Run | null): boolean {
  return run !== null && ['completed', 'blocked', 'failed', 'cancelled'].includes(run.status);
}

function aggregateRefreshFor(
  event: PublicRunEvent,
): { readonly scope: 'overview' | 'workspace'; readonly publishedResultId: string | null } | null {
  if (event.payloadState.state !== 'available') return null;
  switch (event.payloadState.payload.type) {
    case 'result_published':
      return { scope: 'workspace', publishedResultId: event.payloadState.payload.resultId };
    case 'operation_state_changed':
      return { scope: 'workspace', publishedResultId: null };
    case 'run_state_changed':
    case 'terminal_summary':
    case 'task_list_changed':
    case 'child_run_delegated':
      return { scope: 'overview', publishedResultId: null };
    default:
      return null;
  }
}

function emptyWorkspaceData(): WorkspaceData {
  return {
    canvas: null,
    media: [],
    mediaNextCursor: null,
    production: [],
    productionNextCursor: null,
    results: [],
    resultNextCursor: null,
    history: [],
    historyNextCursor: null,
    delivery: null,
    deliveryOperations: [],
  };
}

function mediaProjectListInput(
  projectId: string,
  cursor: string | null,
): DesktopCallV1<'media.project.list'>['input'] {
  return { projectId, roles: [], query: '', page: { cursor, limit: 200 } };
}

function productionQueryInput(
  projectId: string,
  cursor: string | null,
): DesktopCallV1<'production.query'>['input'] {
  return {
    projectId,
    ids: [],
    types: [],
    includeArchived: true,
    includeFactSources: true,
    page: { cursor, limit: 200 },
  };
}

function historyQueryInput(
  projectId: string,
  cursor: string | null,
): DesktopCallV1<'history.query'>['input'] {
  return {
    projectId,
    query: {
      sources: ['project_event', 'generated_result', 'user_choice'],
      eventTypes: [],
      subjects: [],
      actors: [],
      time: { from: null, to: null },
      page: { cursor, limit: 50 },
    },
    order: 'reverse_chronological',
  };
}

function deliveryQueryInput(
  projectId: string,
  cursor: string | null,
): DesktopCallV1<'delivery.query'>['input'] {
  return { projectId, deliveryPlanIds: [], page: { cursor, limit: 200 } };
}

function resultQueryInput(
  projectId: string,
  cursor: string | null,
  resultIds: readonly string[] = [],
): DesktopCallV1<'result.query'>['input'] {
  return {
    projectId,
    query: {
      resultIds: [...resultIds],
      requestIds: [],
      targetRefs: [],
      include: ['artifact', 'prompt', 'references', 'provider', 'assessments'],
      page: { cursor, limit: resultIds.length === 0 ? 100 : Math.max(1, resultIds.length) },
    },
  };
}

function mergeResults(
  ...groups: ReadonlyArray<WorkspaceData['results']>
): WorkspaceData['results'] {
  const ids: string[] = [];
  const byId = new Map<string, WorkspaceData['results'][number]>();
  for (const group of groups) {
    for (const result of group) {
      const id = result.resultRef.id;
      if (!byId.has(id)) ids.push(id);
      byId.set(id, result);
    }
  }
  return ids.map((id) => byId.get(id)!);
}

function mergePageItems<Item>(
  current: readonly Item[],
  page: readonly Item[],
  keyFor: (item: Item) => string,
): Item[] {
  const keys: string[] = [];
  const byKey = new Map<string, Item>();
  for (const item of [...current, ...page]) {
    const key = keyFor(item);
    if (!byKey.has(key)) keys.push(key);
    byKey.set(key, item);
  }
  return keys.map((key) => byKey.get(key)!);
}

function mergeDeliveryPages(
  current: WorkspaceData['delivery'],
  page: WireResult<'delivery.query'>,
): WireResult<'delivery.query'> {
  if (current === null) return page;
  return {
    ...page,
    plans: mergePageItems(current.plans, page.plans, (plan) => plan.id),
    manifests: mergePageItems(current.manifests, page.manifests, (manifest) => manifest.id),
    operations: mergePageItems(current.operations, page.operations, (operation) => operation.id),
  };
}

type HistoryEntry = WorkspaceData['history'][number];
type ProtectionCommand = DesktopCallV1<'decision.protect'>['input'];

function historyEntryKey(entry: HistoryEntry): string {
  if (entry.source === 'message') return `message:${entry.messageId}`;
  if (entry.source === 'run_event') return `run_event:${entry.eventId}`;
  if (entry.source === 'project_event') return `project_event:${entry.eventId}`;
  if (entry.source === 'generated_result') return `generated_result:${entry.resultId}`;
  return `user_choice:${entry.choiceId}`;
}

function recentHistoryResultIds(history: readonly HistoryEntry[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of history) {
    if (entry.source !== 'generated_result' || seen.has(entry.resultId)) continue;
    seen.add(entry.resultId);
    ids.push(entry.resultId);
    if (ids.length === 4) break;
  }
  return ids;
}

interface FocusProtectionTarget {
  readonly active: boolean;
  readonly label: string;
  readonly command: (mode: 'protect' | 'unprotect', reason: string) => ProtectionCommand;
}

function FocusInspector({
  entry,
  selection,
  data,
  resultDecisionStateForId,
  resultDecisionDisabledReasonForId,
  onResultDecision,
  protection,
  onRequestProtection,
  onRespondProtection,
}: {
  readonly entry: HistoryEntry | null;
  readonly selection: DomainObjectRef | null;
  readonly data: WorkspaceData;
  readonly resultDecisionStateForId: (resultId: string) => ResultDecisionState;
  readonly resultDecisionDisabledReasonForId: (resultId: string) => string | null;
  readonly onResultDecision: (
    resultId: string,
    action: ResultDecisionAction,
    detail: string,
  ) => Promise<void>;
  readonly protection: FocusProtectionTarget | null;
  readonly onRequestProtection: (
    command: ProtectionCommand,
  ) => Promise<PendingProtectionConfirmation | null>;
  readonly onRespondProtection: (
    confirmation: PendingProtectionConfirmation,
    decision: 'approved' | 'denied',
  ) => Promise<void>;
}) {
  const { locale } = useDesktopEnvironment();
  if (entry !== null) {
    const actor = 'actor' in entry ? entry.actor : null;
    return (
      <div className="lucid-focus-inspector-content">
        <span className="lucid-inspector-kicker">
          {entry.source === 'user_choice'
            ? locale === 'zh-CN'
              ? '用户决定'
              : 'User decision'
            : locale === 'zh-CN'
              ? '项目变更'
              : 'Project change'}
        </span>
        <h2>{entry.summary}</h2>
        <dl>
          <div>
            <dt>{locale === 'zh-CN' ? '来源' : 'Source'}</dt>
            <dd>{entry.source.replaceAll('_', ' ')}</dd>
          </div>
          {actor !== null && (
            <div>
              <dt>{locale === 'zh-CN' ? '执行者' : 'Actor'}</dt>
              <dd>{actor}</dd>
            </div>
          )}
          <div>
            <dt>{locale === 'zh-CN' ? '时间' : 'Occurred'}</dt>
            <dd>
              {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
                new Date(entry.occurredAt),
              )}
            </dd>
          </div>
        </dl>
        <code>
          {entry.source === 'project_event'
            ? entry.eventId
            : entry.source === 'user_choice'
              ? entry.choiceId
              : entry.source === 'generated_result'
                ? entry.resultId
                : entry.source === 'run_event'
                  ? entry.eventId
                  : entry.messageId}
        </code>
      </div>
    );
  }

  const result =
    selection?.authority === 'generated_result'
      ? data.results.find((candidate) => candidate.resultRef.id === selection.id)
      : undefined;
  if (result !== undefined) {
    return (
      <div className="lucid-focus-inspector-content">
        <span className="lucid-inspector-kicker">
          {locale === 'zh-CN' ? '生成结果' : 'Generated result'}
        </span>
        <h2>{result.resultRef.id}</h2>
        <p>
          {result.submittedPrompt ??
            (locale === 'zh-CN' ? '未保留公开提示。' : 'No public prompt retained.')}
        </p>
        <dl>
          <div>
            <dt>{locale === 'zh-CN' ? '提供方' : 'Provider'}</dt>
            <dd>{result.provider?.model ?? '—'}</dd>
          </div>
          <div>
            <dt>{locale === 'zh-CN' ? '验证' : 'Validation'}</dt>
            <dd>{result.technicalValidation.state}</dd>
          </div>
          <div>
            <dt>{locale === 'zh-CN' ? '版本' : 'Revision'}</dt>
            <dd>{result.resultRef.revision}</dd>
          </div>
        </dl>
        <ResultDecisionControls
          resultId={result.resultRef.id}
          state={resultDecisionStateForId(result.resultRef.id)}
          disabledReason={resultDecisionDisabledReasonForId(result.resultRef.id)}
          onDecide={(action, detail) => onResultDecision(result.resultRef.id, action, detail)}
        />
        {protection !== null && (
          <ProtectionControl
            active={protection.active}
            label={protection.label}
            onRequest={(mode, reason) => onRequestProtection(protection.command(mode, reason))}
            onRespond={onRespondProtection}
          />
        )}
      </div>
    );
  }

  const production =
    selection?.authority === 'production'
      ? data.production.find((view) => view.object.id === selection.id)?.object
      : undefined;
  const delivery =
    selection?.authority === 'delivery'
      ? data.delivery?.plans.find((plan) => plan.id === selection.id)
      : undefined;
  const selectedLabel = production === undefined ? delivery?.name : production.type;
  if (selection !== null) {
    return (
      <div className="lucid-focus-inspector-content">
        <span className="lucid-inspector-kicker">
          {locale === 'zh-CN' ? '项目对象' : 'Project object'}
        </span>
        <h2>{selectedLabel ?? selection.id}</h2>
        <dl>
          <div>
            <dt>{locale === 'zh-CN' ? '权威域' : 'Authority'}</dt>
            <dd>{selection.authority}</dd>
          </div>
          <div>
            <dt>{locale === 'zh-CN' ? '版本' : 'Revision'}</dt>
            <dd>{selection.revision}</dd>
          </div>
        </dl>
        <code>{selection.id}</code>
        {protection !== null && (
          <ProtectionControl
            active={protection.active}
            label={protection.label}
            onRequest={(mode, reason) => onRequestProtection(protection.command(mode, reason))}
            onRespond={onRespondProtection}
          />
        )}
      </div>
    );
  }

  return (
    <div className="lucid-inspector-empty">
      <Film size={20} />
      <strong>{locale === 'zh-CN' ? '选择结果以检查' : 'Select a result to inspect'}</strong>
      <span>
        {locale === 'zh-CN'
          ? '检查器在选择前保持折叠语义。'
          : 'Project changes and result detail appear here only when selected.'}
      </span>
    </div>
  );
}

function readStoredNumber(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

function readStoredString(key: string): string | null {
  try {
    const value = localStorage.getItem(key);
    return value === null || value.trim().length === 0 ? null : value;
  } catch {
    return null;
  }
}

type ViewportMode = 'wide' | 'medium' | 'narrow';

function readViewportMode(): ViewportMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'wide';
  if (window.matchMedia('(max-width: 959px)').matches) return 'narrow';
  if (window.matchMedia('(max-width: 1279px)').matches) return 'medium';
  return 'wide';
}

interface ProjectShellProps {
  readonly projectId: string;
  readonly workspace: Workspace;
  readonly onWorkspaceChange: (workspace: Workspace) => void;
  readonly onBack: () => void;
}

function ProjectSettingsTrigger({ onOpen }: { readonly onOpen: () => void }) {
  const { locale } = useDesktopEnvironment();

  return (
    <button className="lucid-project-settings-trigger" type="button" onClick={onOpen}>
      <CircleEllipsis size={15} />
      {appCopy(locale, 'projectMenu')}
    </button>
  );
}

export function ProjectShell({
  projectId,
  workspace,
  onWorkspaceChange,
  onBack,
}: ProjectShellProps) {
  const { api, createRequestId, locale } = useDesktopEnvironment();
  const location = useLocation();
  const requestedChatId = useMemo(
    () => new URLSearchParams(location.search).get('chat'),
    [location.search],
  );
  const requestedRunId = useMemo(
    () => new URLSearchParams(location.search).get('run'),
    [location.search],
  );
  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<ProjectSettings | null>(null);
  const [capabilities, setCapabilities] = useState<WireResult<'project.capabilities.get'> | null>(
    null,
  );
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null);
  const [pluginPackages, setPluginPackages] = useState<WireResult<'plugin.query'> | null>(null);
  const [pluginPackagesError, setPluginPackagesError] = useState<string | null>(null);
  const [pluginPending, setPluginPending] = useState<string | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [chats, setChats] = useState<readonly Chat[]>([]);
  const [chatNextCursor, setChatNextCursor] = useState<string | null>(null);
  const [activeChatId, setActiveChatIdState] = useState<string | null>(requestedChatId);
  const transcriptRequestRef = useRef(0);
  const activeChatIdRef = useRef<string | null>(requestedChatId);
  const setActiveChatId = useCallback((chatId: string | null) => {
    transcriptRequestRef.current += 1;
    activeChatIdRef.current = chatId;
    setActiveChatIdState(chatId);
  }, []);
  const [messages, setMessages] = useState<readonly Message[]>([]);
  const [messageNextCursor, setMessageNextCursor] = useState<string | null>(null);
  const [currentRun, setCurrentRunState] = useState<Run | null>(null);
  const currentRunRef = useRef<Run | null>(null);
  const setCurrentRun = useCallback((run: Run | null) => {
    currentRunRef.current = run;
    setCurrentRunState(run);
  }, []);
  const [events, setEvents] = useState<readonly PublicRunEvent[]>([]);
  const [eventNextCursor, setEventNextCursor] = useState<string | null>(null);
  const [workspaceData, setWorkspaceData] = useState<WorkspaceData>(emptyWorkspaceData);
  const [selection, dispatchSelection] = useReducer(selectionReducer, EMPTY_SELECTION);
  const [inspectedHistory, setInspectedHistory] = useState<HistoryEntry | null>(null);
  const [composerDraft, setComposerDraft] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<readonly MessageAttachment[]>([]);
  const [projectSearchMessages, setProjectSearchMessages] = useState<readonly Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [pendingTranscriptRefresh, setPendingTranscriptRefresh] = useState<{
    readonly chatId: string;
    readonly runId: string;
  } | null>(null);
  const [focus, setFocus] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectLifecyclePending, setProjectLifecyclePending] = useState(false);
  const [viewportMode, setViewportMode] = useState<ViewportMode>(readViewportMode);
  const [canvasMutationPending, setCanvasMutationPending] = useState(false);
  const [resultPagePending, setResultPagePending] = useState(false);
  const [workspacePagePending, setWorkspacePagePending] = useState<
    'media' | 'production' | 'history' | 'delivery' | null
  >(null);
  const [dockCollapsed, setDockCollapsed] = useState(() => {
    const initialViewportMode = readViewportMode();
    return initialViewportMode === 'narrow'
      ? true
      : readStoredBoolean(
          `lucid-fin:dock-collapsed:${projectId}`,
          initialViewportMode === 'medium',
        );
  });
  const [dockWidth, setDockWidth] = useState(() =>
    Math.min(480, Math.max(352, readStoredNumber(`lucid-fin:dock-width:${projectId}`, 400))),
  );
  const workspaceScrollRef = useRef<HTMLDivElement>(null);
  const focusButtonRef = useRef<HTMLButtonElement>(null);
  const workspaceCommanderButtonRef = useRef<HTMLButtonElement>(null);
  const focusReturnTargetRef = useRef<'commander' | 'workspace'>('commander');
  const restoreFocusAfterExitRef = useRef(false);
  const previousViewportModeRef = useRef(viewportMode);
  const restoreScrollRef = useRef(0);
  const conversationScrollRef = useRef(0);
  const searchIndexSignatureRef = useRef('');
  const pluginPendingRef = useRef<string | null>(null);
  const overviewRequestRef = useRef(0);
  const capabilitiesRequestRef = useRef(0);
  const pluginPackagesRequestRef = useRef(0);
  const workspaceRequestRef = useRef(0);
  const hydrateRequestRef = useRef(0);
  const refreshRequestRef = useRef(0);

  useEffect(() => {
    if (focus || !restoreFocusAfterExitRef.current) return;
    restoreFocusAfterExitRef.current = false;
    if (workspaceScrollRef.current) workspaceScrollRef.current.scrollTop = restoreScrollRef.current;
    const returnButton =
      focusReturnTargetRef.current === 'workspace'
        ? workspaceCommanderButtonRef.current
        : focusButtonRef.current;
    returnButton?.focus();
  }, [focus]);

  const exitFocus = useCallback(() => {
    restoreFocusAfterExitRef.current = true;
    setFocus(false);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mediumQuery = window.matchMedia('(max-width: 1279px)');
    const narrowQuery = window.matchMedia('(max-width: 959px)');
    const updateViewportMode = () => setViewportMode(readViewportMode());
    mediumQuery.addEventListener('change', updateViewportMode);
    narrowQuery.addEventListener('change', updateViewportMode);
    return () => {
      mediumQuery.removeEventListener('change', updateViewportMode);
      narrowQuery.removeEventListener('change', updateViewportMode);
    };
  }, []);

  useEffect(() => {
    const previousViewportMode = previousViewportModeRef.current;
    previousViewportModeRef.current = viewportMode;
    if (
      (previousViewportMode === 'wide' && viewportMode !== 'wide') ||
      (previousViewportMode === 'medium' && viewportMode === 'narrow')
    ) {
      setDockCollapsed(true);
    }
  }, [viewportMode]);

  const refreshOverview = useCallback(async () => {
    const request = ++overviewRequestRef.current;
    const next = await wireResult(
      api.overview.get({ requestId: createRequestId(), input: { projectId } }),
    );
    if (request === overviewRequestRef.current) {
      setOverview(next);
      setProject(next.project);
    }
    return next;
  }, [api, createRequestId, projectId]);

  const loadCapabilities = useCallback(async () => {
    const request = ++capabilitiesRequestRef.current;
    setCapabilitiesError(null);
    try {
      const next = await wireResult(
        api.project.capabilitiesGet({ requestId: createRequestId(), input: { projectId } }),
      );
      if (request === capabilitiesRequestRef.current) setCapabilities(next);
    } catch (cause) {
      if (request === capabilitiesRequestRef.current) setCapabilitiesError(summary(cause));
    }
  }, [api, createRequestId, projectId]);

  const loadPluginPackages = useCallback(async () => {
    const request = ++pluginPackagesRequestRef.current;
    setPluginPackagesError(null);
    try {
      const next = await wireResult(api.plugin.query({ requestId: createRequestId(), input: {} }));
      if (request === pluginPackagesRequestRef.current) setPluginPackages(next);
    } catch (cause) {
      if (request === pluginPackagesRequestRef.current) {
        setPluginPackagesError(summary(cause));
      }
    }
  }, [api, createRequestId]);

  const loadDeliveryOperationViews = useCallback(
    async (operations: WireResult<'delivery.query'>['operations']) => {
      const operationPages = await Promise.all(
        Array.from(
          { length: Math.ceil(operations.length / OPERATION_GET_BATCH_SIZE) },
          (_, index) =>
            wireResult(
              api.operation.get({
                requestId: createRequestId(),
                input: {
                  operations: operations.slice(
                    index * OPERATION_GET_BATCH_SIZE,
                    (index + 1) * OPERATION_GET_BATCH_SIZE,
                  ),
                },
              }),
            ),
        ),
      );
      const viewsById = new Map(
        operationPages.flatMap((page) =>
          page.operations.map((operation) => [operation.ref.id, operation] as const),
        ),
      );
      return operations.map((operation) => {
        const view = viewsById.get(operation.id);
        if (view === undefined) {
          throw new Error(`Delivery operation ${operation.id} was not returned by operation.get.`);
        }
        return view;
      });
    },
    [api, createRequestId],
  );

  const loadWorkspaceProjections = useCallback(
    async (publishedResultId: string | null = null) => {
      const request = ++workspaceRequestRef.current;
      const publishedResultPage =
        publishedResultId === null
          ? Promise.resolve(null)
          : wireResult(
              api.result.query({
                requestId: createRequestId(),
                input: resultQueryInput(projectId, null, [publishedResultId]),
              }),
            );
      const [canvas, media, production, results, history, delivery, publishedResult] =
        await Promise.all([
          wireResult(api.canvas.get({ requestId: createRequestId(), input: { projectId } })),
          wireResult(
            api.media.projectList({
              requestId: createRequestId(),
              input: mediaProjectListInput(projectId, null),
            }),
          ),
          wireResult(
            api.production.query({
              requestId: createRequestId(),
              input: productionQueryInput(projectId, null),
            }),
          ),
          wireResult(
            api.result.query({
              requestId: createRequestId(),
              input: resultQueryInput(projectId, null),
            }),
          ),
          wireResult(
            api.history.query({
              requestId: createRequestId(),
              input: historyQueryInput(projectId, null),
            }),
          ),
          wireResult(
            api.delivery.query({
              requestId: createRequestId(),
              input: deliveryQueryInput(projectId, null),
            }),
          ),
          publishedResultPage,
        ]);
      const loadedResultIds = new Set(
        [...results.items, ...(publishedResult?.items ?? [])].map((result) => result.resultRef.id),
      );
      const missingRecentResultIds = recentHistoryResultIds(history.items).filter(
        (resultId) => !loadedResultIds.has(resultId),
      );
      const [deliveryOperations, recentResultPage] = await Promise.all([
        loadDeliveryOperationViews(delivery.operations),
        missingRecentResultIds.length === 0
          ? Promise.resolve(null)
          : wireResult(
              api.result.query({
                requestId: createRequestId(),
                input: resultQueryInput(projectId, null, missingRecentResultIds),
              }),
            ),
      ]);
      if (request !== workspaceRequestRef.current) return;
      if (recentResultPage !== null) {
        const returnedIds = new Set(recentResultPage.items.map((result) => result.resultRef.id));
        const unresolvedIds = missingRecentResultIds.filter(
          (resultId) => !returnedIds.has(resultId),
        );
        if (unresolvedIds.length > 0) {
          throw new Error(
            `Recent Generated Results were not returned: ${unresolvedIds.join(', ')}.`,
          );
        }
      }
      setWorkspaceData((current) => {
        const deliveryData = mergeDeliveryPages(current.delivery, delivery);
        return {
          canvas,
          media: mergePageItems(current.media, media.items, (item) => item.id),
          mediaNextCursor: current.media.length === 0 ? media.nextCursor : current.mediaNextCursor,
          production: mergePageItems(
            current.production,
            production.items,
            (item) => item.object.id,
          ),
          productionNextCursor:
            current.production.length === 0 ? production.nextCursor : current.productionNextCursor,
          results: mergeResults(
            current.results,
            results.items,
            recentResultPage?.items ?? [],
            publishedResult?.items ?? [],
          ),
          resultNextCursor:
            current.results.length === 0 ? results.nextCursor : current.resultNextCursor,
          history: mergePageItems(current.history, history.items, historyEntryKey),
          historyNextCursor:
            current.history.length === 0 ? history.nextCursor : current.historyNextCursor,
          delivery:
            current.delivery === null
              ? deliveryData
              : { ...deliveryData, nextCursor: current.delivery.nextCursor },
          deliveryOperations: mergePageItems(
            current.deliveryOperations,
            deliveryOperations,
            (operation) => operation.ref.id,
          ),
        };
      });
    },
    [api, createRequestId, loadDeliveryOperationViews, projectId],
  );

  const refreshAfterAcceptedChange = useCallback(
    async (
      scope: 'overview' | 'workspace' = 'workspace',
      publishedResultId: string | null = null,
    ) => {
      const request = ++refreshRequestRef.current;
      try {
        if (scope === 'overview') await refreshOverview();
        else await Promise.all([loadWorkspaceProjections(publishedResultId), refreshOverview()]);
        if (request === refreshRequestRef.current) setRefreshWarning(null);
      } catch (cause) {
        if (request === refreshRequestRef.current) {
          setRefreshWarning(
            locale === 'zh-CN'
              ? `权威层已接受变更，但本地视图刷新失败。请重试以重新同步。${summary(cause)}`
              : `The authority accepted the change, but this view could not refresh. Retry to reconcile it. ${summary(cause)}`,
          );
        }
      }
    },
    [loadWorkspaceProjections, locale, refreshOverview],
  );

  const loadTranscript = useCallback(
    async (
      chatId: string,
      activeOverview: Overview | null,
      preferredRunId?: string | null,
    ): Promise<boolean> => {
      const request = ++transcriptRequestRef.current;
      const page: WireResult<'message.list'> = await wireResult(
        api.message.list({
          requestId: createRequestId(),
          input: { chatId, beforeSequence: null, page: { cursor: null, limit: 200 } },
        }),
      );
      if (request !== transcriptRequestRef.current) return false;
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
      let run: Run | null = null;
      let publicEvents: WireResult<'run.events.list'> = { items: [], nextCursor: null };
      let clearPendingRunId: string | null = null;
      let ownershipWarning: string | null = null;
      if (runId !== null) {
        try {
          const loadedRun = await wireResult(
            api.run.get({ requestId: createRequestId(), input: { runId } }),
          );
          if (request !== transcriptRequestRef.current) return false;
          if (loadedRun.projectId !== projectId || loadedRun.chatId !== chatId) {
            ownershipWarning =
              locale === 'zh-CN'
                ? '请求的 Run 不属于当前项目或对话。'
                : 'The requested Run does not belong to this Project Chat.';
          } else {
            publicEvents = await wireResult(
              api.run.eventsList({
                requestId: createRequestId(),
                input: { runId, afterSequence: null, page: { cursor: null, limit: 200 } },
              }),
            );
            if (request !== transcriptRequestRef.current) return false;
            run = loadedRun;
            clearPendingRunId = loadedRun.id;
          }
        } catch (cause) {
          if (request !== transcriptRequestRef.current) return false;
          if (cause instanceof DesktopApiError && cause.code === 'not_found') {
            clearPendingRunId = runId;
          } else {
            throw cause;
          }
        }
      }
      if (request !== transcriptRequestRef.current) return false;
      setMessages(page.items);
      setMessageNextCursor(page.nextCursor);
      setCurrentRun(run);
      setEvents(publicEvents.items);
      setEventNextCursor(publicEvents.nextCursor);
      if (clearPendingRunId !== null) {
        setPendingTranscriptRefresh((pending) =>
          pending?.chatId === chatId && pending.runId === clearPendingRunId ? null : pending,
        );
      }
      if (ownershipWarning !== null) setRefreshWarning(ownershipWarning);
      return true;
    },
    [api, createRequestId, locale, projectId, setCurrentRun],
  );

  const hydrate = useCallback(async () => {
    const request = ++hydrateRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = { cursor: null, limit: 200 } as const;
      const [loadedProject, loadedSettings, loadedOverview, chatPage] = await Promise.all([
        wireResult(api.project.get({ requestId: createRequestId(), input: { projectId } })),
        wireResult(api.project.settingsGet({ requestId: createRequestId(), input: { projectId } })),
        wireResult(api.overview.get({ requestId: createRequestId(), input: { projectId } })),
        wireResult(
          api.chat.list({
            requestId: createRequestId(),
            input: { projectId, lifecycle: ['active'], page },
          }),
        ),
      ]);
      if (request !== hydrateRequestRef.current) return;
      setProject(loadedProject);
      setSettings(loadedSettings);
      setOverview(loadedOverview);
      setChats(chatPage.items);
      setChatNextCursor(chatPage.nextCursor);
      const storedChatId = readStoredString(`lucid-fin:last-chat:${projectId}`);
      const nextChat =
        chatPage.items.find((chat) => chat.id === requestedChatId)?.id ??
        chatPage.items.find((chat) => chat.id === storedChatId)?.id ??
        chatPage.items[0]?.id ??
        null;
      await Promise.all([loadWorkspaceProjections(), loadCapabilities(), loadPluginPackages()]);
      if (request !== hydrateRequestRef.current) return;
      if (nextChat !== null) {
        const loaded = await loadTranscript(nextChat, loadedOverview, requestedRunId);
        if (request !== hydrateRequestRef.current || !loaded) return;
        if (activeChatIdRef.current !== nextChat) setActiveChatId(nextChat);
      } else {
        setActiveChatId(null);
        setMessages([]);
        setMessageNextCursor(null);
        setCurrentRun(null);
        setEvents([]);
        setEventNextCursor(null);
      }
    } catch (cause) {
      if (request === hydrateRequestRef.current) setError(summary(cause));
    } finally {
      if (request === hydrateRequestRef.current) setLoading(false);
    }
  }, [
    api,
    createRequestId,
    loadCapabilities,
    loadPluginPackages,
    loadTranscript,
    loadWorkspaceProjections,
    projectId,
    requestedChatId,
    requestedRunId,
    setActiveChatId,
    setCurrentRun,
  ]);

  useEffect(() => {
    void hydrate();
    return () => {
      hydrateRequestRef.current += 1;
      overviewRequestRef.current += 1;
      capabilitiesRequestRef.current += 1;
      pluginPackagesRequestRef.current += 1;
      workspaceRequestRef.current += 1;
      transcriptRequestRef.current += 1;
      refreshRequestRef.current += 1;
    };
  }, [hydrate]);

  useEffect(() => {
    try {
      localStorage.setItem(`lucid-fin:last-workspace:${projectId}`, workspace);
    } catch {
      // URL remains the route authority when storage is unavailable.
    }
  }, [projectId, workspace]);

  useEffect(() => {
    if (loading) return;
    const key = `lucid-fin:last-chat:${projectId}`;
    try {
      if (activeChatId === null) localStorage.removeItem(key);
      else localStorage.setItem(key, activeChatId);
    } catch {
      // The active in-memory Chat remains authoritative when browser storage is unavailable.
    }
  }, [activeChatId, loading, projectId]);

  useEffect(() => {
    let active = true;
    const dispose = api.run.onEventsAppended((push) => {
      const event = push.payload.event;
      const aggregateRefresh = aggregateRefreshFor(event);
      const current = event.runId === currentRunRef.current?.id;
      const updateCurrentRun =
        event.payloadState.state === 'available' &&
        (event.payloadState.payload.type === 'run_state_changed' ||
          event.payloadState.payload.type === 'terminal_summary');
      if (current) {
        setEvents((events) =>
          events.some((candidate) => candidate.eventId === event.eventId)
            ? events
            : [...events, event].sort((left, right) => left.sequence - right.sequence),
        );
        if (aggregateRefresh === null) return;
        if (updateCurrentRun) {
          void wireResult(
            api.run.get({ requestId: createRequestId(), input: { runId: event.runId } }),
          ).then(
            (run) => {
              if (active) setCurrentRun(run);
            },
            () => undefined,
          );
        }
        void refreshAfterAcceptedChange(aggregateRefresh.scope, aggregateRefresh.publishedResultId);
        return;
      }
      if (aggregateRefresh === null) return;
      void wireResult(
        api.run.get({ requestId: createRequestId(), input: { runId: event.runId } }),
      ).then(
        (run) => {
          if (active && run.projectId === projectId)
            void refreshAfterAcceptedChange(
              aggregateRefresh.scope,
              aggregateRefresh.publishedResultId,
            );
        },
        (cause) => {
          if (active)
            setRefreshWarning(
              locale === 'zh-CN'
                ? `权威层已记录项目变更，但无法核对其项目归属。${summary(cause)}`
                : `A Project change was recorded, but its Project ownership could not be verified. ${summary(cause)}`,
            );
        },
      );
    });
    return () => {
      active = false;
      dispose();
    };
  }, [api, createRequestId, locale, projectId, refreshAfterAcceptedChange, setCurrentRun]);

  useEffect(() => {
    if (!focus || settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      exitFocus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [exitFocus, focus, settingsOpen]);

  const switchChat = async (chatId: string) => {
    const loaded = await loadTranscript(chatId, overview);
    if (!loaded) return;
    setActiveChatId(chatId);
    conversationScrollRef.current = 0;
  };

  const createChat = async () => {
    const chat = await wireResult(
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
    setMessageNextCursor(null);
    setCurrentRun(null);
    setEvents([]);
    setEventNextCursor(null);
    setComposerDraft('');
    setPendingAttachments([]);
    conversationScrollRef.current = 0;
    searchIndexSignatureRef.current = '';
  };

  const closeChat = async (chatId: string, action: 'archive' | 'delete') => {
    const chat = chats.find((candidate) => candidate.id === chatId);
    if (chat === undefined) throw new Error('The current Chat is no longer available.');
    await wireResult(
      action === 'archive'
        ? api.chat.archive({
            requestId: createRequestId(),
            input: { chatId: chat.id, expectedRevision: chat.revision },
          })
        : api.chat.delete({
            requestId: createRequestId(),
            input: { chatId: chat.id, expectedRevision: chat.revision },
          }),
    );
    const remaining = chats.filter((candidate) => candidate.id !== chat.id);
    setChats(remaining);
    searchIndexSignatureRef.current = '';
    if (activeChatId === chat.id) {
      const nextChat = remaining[0] ?? null;
      setActiveChatId(nextChat?.id ?? null);
      setMessages([]);
      setMessageNextCursor(null);
      setCurrentRun(null);
      setEvents([]);
      setEventNextCursor(null);
      setComposerDraft('');
      setPendingAttachments([]);
      conversationScrollRef.current = 0;
      if (nextChat !== null) {
        try {
          await loadTranscript(nextChat.id, overview);
        } catch (cause) {
          setRefreshWarning(
            locale === 'zh-CN'
              ? `对话已${action === 'archive' ? '归档' : '删除'}，但无法载入下一条对话。${summary(cause)}`
              : `The Chat was ${action === 'archive' ? 'archived' : 'deleted'}, but the next Chat could not be loaded. ${summary(cause)}`,
          );
        }
      }
    }
    await refreshAfterAcceptedChange('overview');
  };

  const loadMoreChats = async () => {
    const cursor = chatNextCursor;
    if (cursor === null) return;
    const page = await wireResult(
      api.chat.list({
        requestId: createRequestId(),
        input: {
          projectId,
          lifecycle: ['active'],
          page: { cursor, limit: 200 },
        },
      }),
    );
    setChats((current) => {
      const byId = new Map(current.map((chat) => [chat.id, chat] as const));
      for (const chat of page.items) byId.set(chat.id, chat);
      return [...byId.values()];
    });
    setChatNextCursor((current) => (current === cursor ? page.nextCursor : current));
    searchIndexSignatureRef.current = '';
  };

  const loadEarlierMessages = async () => {
    const chatId = activeChatId;
    const cursor = messageNextCursor;
    if (chatId === null || cursor === null) return;
    const transcriptRequest = transcriptRequestRef.current;
    const page = await wireResult(
      api.message.list({
        requestId: createRequestId(),
        input: { chatId, beforeSequence: null, page: { cursor, limit: 200 } },
      }),
    );
    if (activeChatIdRef.current !== chatId || transcriptRequest !== transcriptRequestRef.current)
      return;
    setMessages((current) => {
      const byId = new Map([...page.items, ...current].map((message) => [message.id, message]));
      return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
    });
    setMessageNextCursor((current) => (current === cursor ? page.nextCursor : current));
  };

  const loadMoreRunEvents = async () => {
    const runId = currentRun?.id ?? null;
    const cursor = eventNextCursor;
    if (runId === null || cursor === null) return;
    const transcriptRequest = transcriptRequestRef.current;
    const page = await wireResult(
      api.run.eventsList({
        requestId: createRequestId(),
        input: { runId, afterSequence: null, page: { cursor, limit: 200 } },
      }),
    );
    if (currentRunRef.current?.id !== runId || transcriptRequest !== transcriptRequestRef.current)
      return;
    setEvents((current) => {
      const byId = new Map([...current, ...page.items].map((event) => [event.eventId, event]));
      return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
    });
    setEventNextCursor((current) => (current === cursor ? page.nextCursor : current));
  };

  const prepareProjectSearch = async () => {
    const allChats = new Map(chats.map((chat) => [chat.id, chat] as const));
    let nextChatCursor = chatNextCursor;
    const seenChatCursors = new Set<string>();
    while (nextChatCursor !== null) {
      if (seenChatCursors.has(nextChatCursor)) {
        throw new Error('Chat pagination returned a repeated cursor.');
      }
      seenChatCursors.add(nextChatCursor);
      const page: WireResult<'chat.list'> = await wireResult(
        api.chat.list({
          requestId: createRequestId(),
          input: {
            projectId,
            lifecycle: ['active'],
            page: { cursor: nextChatCursor, limit: 200 },
          },
        }),
      );
      for (const chat of page.items) allChats.set(chat.id, chat);
      nextChatCursor = page.nextCursor;
    }

    const searchableChats = [...allChats.values()];
    const signature = searchableChats.map((chat) => `${chat.id}:${chat.revision}`).join('|');
    if (searchIndexSignatureRef.current === signature) return;
    const pages = await Promise.all(
      searchableChats.map(async (chat) => {
        const chatMessages: Message[] = [];
        let nextMessageCursor: string | null = null;
        const seenMessageCursors = new Set<string>();
        do {
          if (nextMessageCursor !== null) {
            if (seenMessageCursors.has(nextMessageCursor)) {
              throw new Error(`Message pagination repeated a cursor for Chat ${chat.id}.`);
            }
            seenMessageCursors.add(nextMessageCursor);
          }
          const page: WireResult<'message.list'> = await wireResult(
            api.message.list({
              requestId: createRequestId(),
              input: {
                chatId: chat.id,
                beforeSequence: null,
                page: { cursor: nextMessageCursor, limit: 200 },
              },
            }),
          );
          chatMessages.push(...page.items);
          nextMessageCursor = page.nextCursor;
        } while (nextMessageCursor !== null);
        return chatMessages;
      }),
    );
    const unique = new Map<string, Message>();
    for (const page of pages) for (const message of page) unique.set(message.id, message);
    setChats(searchableChats);
    setChatNextCursor(null);
    setProjectSearchMessages([...unique.values()]);
    searchIndexSignatureRef.current = signature;
  };

  const attachReference = async () => {
    const grant = await wireResult(
      api.os.mediaPick({
        requestId: createRequestId(),
        input: { kinds: ['image', 'video', 'audio', 'document'], multiple: false },
      }),
    );
    const imported = await wireResult(
      api.media.globalImport({
        requestId: createRequestId(),
        input: {
          capabilityToken: grant.capabilityToken,
          displayName: null,
          tags: ['reference'],
        },
      }),
    );
    const latestProject = await wireResult(
      api.project.get({ requestId: createRequestId(), input: { projectId } }),
    );
    const existing = workspaceData.media.find((media) => media.globalAssetId === imported.asset.id);
    const attached = await wireResult(
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
          label: grant.displayLabel,
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
    await refreshAfterAcceptedChange();
  };

  const send = async (
    text: string,
    options?: {
      readonly selectedContext?: readonly SelectedContextRef[];
      readonly attachments?: readonly MessageAttachment[];
      readonly exportDestinationGrant?: DeliveryDestinationGrantV1 | null;
      readonly preservePendingAttachments?: boolean;
    },
  ) => {
    if (activeChatId === null) throw new Error('Create a Project Chat before sending.');
    if (pendingTranscriptRefresh?.chatId === activeChatId) {
      throw new Error(
        locale === 'zh-CN'
          ? '已接受的跟进消息尚未完成权威刷新。请先重试刷新。'
          : 'The accepted follow-up has not refreshed from the authority yet. Retry refresh first.',
      );
    }
    const selectedContext = options?.selectedContext ?? selectionToRunContext(selection);
    const attachments = options?.attachments ?? pendingAttachments;
    if (currentRun !== null && !terminal(currentRun)) {
      const activeRun = currentRun;
      const activeChat = activeChatId;
      const transcriptRequest = transcriptRequestRef.current;
      await wireResult(
        api.run.sendFollowup({
          requestId: createRequestId(),
          input: {
            runId: activeRun.id,
            expectedRevision: activeRun.revision,
            text,
            selectedContext: [...selectedContext],
            exportDestinationGrant: options?.exportDestinationGrant ?? null,
          },
        }),
      );
      if (options?.preservePendingAttachments !== true) setPendingAttachments([]);
      if (
        activeChatIdRef.current === activeChat &&
        currentRunRef.current?.id === activeRun.id &&
        transcriptRequestRef.current === transcriptRequest
      ) {
        try {
          await loadTranscript(activeChat, overview, activeRun.id);
        } catch (cause) {
          setCurrentRun(null);
          setEvents([]);
          setEventNextCursor(null);
          setPendingTranscriptRefresh({ chatId: activeChat, runId: activeRun.id });
          setRefreshWarning(
            locale === 'zh-CN'
              ? `跟进消息已接受，但无法刷新对话。${summary(cause)}`
              : `The follow-up was accepted, but the Chat could not refresh. ${summary(cause)}`,
          );
        }
      }
      return;
    }
    const rootChatId = activeChatId;
    const transcriptRequest = transcriptRequestRef.current;
    const accepted = await wireResult(
      api.message.send({
        requestId: createRequestId(),
        input: {
          chatId: rootChatId,
          blocks: [{ type: 'text', text }],
          attachments: [...attachments],
          selectedContext: [...selectedContext],
          exportDestinationGrant: options?.exportDestinationGrant ?? null,
          supersedesMessageId: null,
        },
      }),
    );
    if (accepted.chat.id === rootChatId) {
      setChats((current) => current.map((chat) => (chat.id === rootChatId ? accepted.chat : chat)));
    }
    if (
      activeChatIdRef.current === rootChatId &&
      transcriptRequestRef.current === transcriptRequest
    ) {
      setMessages((current) => [...current, accepted.message]);
      setCurrentRun(accepted.acceptedRun);
      setEvents([]);
      setEventNextCursor(null);
      if (options?.preservePendingAttachments !== true) setPendingAttachments([]);
    }
    await refreshAfterAcceptedChange('overview');
  };

  const retryRefresh = async () => {
    const pending = pendingTranscriptRefresh;
    if (pending === null) {
      await refreshAfterAcceptedChange();
      return;
    }
    if (activeChatIdRef.current !== pending.chatId) {
      setRefreshWarning(
        locale === 'zh-CN'
          ? '请先返回已接受跟进消息的对话，再重试刷新。'
          : 'Return to the Chat with the accepted follow-up before retrying refresh.',
      );
      return;
    }
    try {
      const loaded = await loadTranscript(pending.chatId, overview, pending.runId);
      if (loaded) setRefreshWarning(null);
    } catch (cause) {
      setRefreshWarning(
        locale === 'zh-CN'
          ? `跟进消息已接受，但无法刷新对话。${summary(cause)}`
          : `The follow-up was accepted, but the Chat could not refresh. ${summary(cause)}`,
      );
    }
  };

  const loadMoreResults = async () => {
    const cursor = workspaceData.resultNextCursor;
    if (cursor === null || resultPagePending) return;
    setResultPagePending(true);
    try {
      const page = await wireResult(
        api.result.query({
          requestId: createRequestId(),
          input: resultQueryInput(projectId, cursor),
        }),
      );
      setWorkspaceData((current) =>
        current.resultNextCursor !== cursor
          ? current
          : {
              ...current,
              results: mergeResults(current.results, page.items),
              resultNextCursor: page.nextCursor,
            },
      );
    } finally {
      setResultPagePending(false);
    }
  };

  const loadMoreMedia = async () => {
    const cursor = workspaceData.mediaNextCursor;
    if (cursor === null || workspacePagePending !== null) return;
    setWorkspacePagePending('media');
    try {
      const page = await wireResult(
        api.media.projectList({
          requestId: createRequestId(),
          input: mediaProjectListInput(projectId, cursor),
        }),
      );
      setWorkspaceData((current) =>
        current.mediaNextCursor !== cursor
          ? current
          : {
              ...current,
              media: mergePageItems(current.media, page.items, (item) => item.id),
              mediaNextCursor: page.nextCursor,
            },
      );
    } finally {
      setWorkspacePagePending(null);
    }
  };

  const loadMoreProduction = async () => {
    const cursor = workspaceData.productionNextCursor;
    if (cursor === null || workspacePagePending !== null) return;
    setWorkspacePagePending('production');
    try {
      const page = await wireResult(
        api.production.query({
          requestId: createRequestId(),
          input: productionQueryInput(projectId, cursor),
        }),
      );
      setWorkspaceData((current) =>
        current.productionNextCursor !== cursor
          ? current
          : {
              ...current,
              production: mergePageItems(current.production, page.items, (item) => item.object.id),
              productionNextCursor: page.nextCursor,
            },
      );
    } finally {
      setWorkspacePagePending(null);
    }
  };

  const loadMoreHistory = async () => {
    const cursor = workspaceData.historyNextCursor;
    if (cursor === null || workspacePagePending !== null) return;
    setWorkspacePagePending('history');
    try {
      const page = await wireResult(
        api.history.query({
          requestId: createRequestId(),
          input: historyQueryInput(projectId, cursor),
        }),
      );
      setWorkspaceData((current) =>
        current.historyNextCursor !== cursor
          ? current
          : {
              ...current,
              history: mergePageItems(current.history, page.items, historyEntryKey),
              historyNextCursor: page.nextCursor,
            },
      );
    } finally {
      setWorkspacePagePending(null);
    }
  };

  const loadMoreDelivery = async () => {
    const cursor = workspaceData.delivery?.nextCursor ?? null;
    if (cursor === null || workspacePagePending !== null) return;
    setWorkspacePagePending('delivery');
    try {
      const page = await wireResult(
        api.delivery.query({
          requestId: createRequestId(),
          input: deliveryQueryInput(projectId, cursor),
        }),
      );
      const deliveryOperations = await loadDeliveryOperationViews(page.operations);
      setWorkspaceData((current) => {
        if (current.delivery?.nextCursor !== cursor) return current;
        return {
          ...current,
          delivery: mergeDeliveryPages(current.delivery, page),
          deliveryOperations: mergePageItems(
            current.deliveryOperations,
            deliveryOperations,
            (operation) => operation.ref.id,
          ),
        };
      });
    } finally {
      setWorkspacePagePending(null);
    }
  };

  const moveCanvasPlacement = async (
    placementId: string,
    position: { readonly x: number; readonly y: number },
  ) => {
    const canvas = workspaceData.canvas;
    if (canvas === null) throw new Error('The authoritative Canvas is unavailable.');
    if (canvasMutationPending) throw new Error('A Canvas change is already in progress.');
    setCanvasMutationPending(true);
    try {
      const updated = await wireResult(
        api.canvas.apply({
          requestId: createRequestId(),
          input: {
            projectId,
            expectedCanvasRevision: canvas.revision,
            command: { action: 'move', placementId, position },
          },
        }),
      );
      setWorkspaceData((current) => ({ ...current, canvas: updated }));
      await refreshAfterAcceptedChange();
    } finally {
      setCanvasMutationPending(false);
    }
  };

  const cancelDeliveryOperation = async (
    operation: WorkspaceData['deliveryOperations'][number],
  ) => {
    const cancelled = await wireResult(
      api.operation.cancel({
        requestId: createRequestId(),
        input: {
          operations: [
            {
              ref: operation.ref,
              expectedRevision: operation.ref.revision,
              expectedState: operation.state,
            },
          ],
        },
      }),
    );
    setWorkspaceData((current) => {
      const updates = new Map(cancelled.operations.map((view) => [view.ref.id, view] as const));
      const existingIds = new Set(current.deliveryOperations.map((view) => view.ref.id));
      return {
        ...current,
        deliveryOperations: [
          ...current.deliveryOperations.map((view) => updates.get(view.ref.id) ?? view),
          ...cancelled.operations.filter((view) => !existingIds.has(view.ref.id)),
        ],
      };
    });
    await refreshAfterAcceptedChange();
  };

  const resultContextForId = (resultId: string) => {
    const result = workspaceData.results.find((candidate) => candidate.resultRef.id === resultId);
    if (result === undefined) return null;
    const shotView = workspaceData.production.find(
      (view) => view.object.type === 'shot' && view.object.id === result.targetRef.id,
    );
    if (shotView?.object.type !== 'shot') return null;
    const decision = shotView.object.resultDecisions.find(
      (entry) => entry.result.id === result.resultRef.id,
    );
    return {
      result,
      shot: shotView.object,
      decision,
      currentChoice:
        decision === undefined
          ? null
          : (shotView.currentChoices.find((choice) => choice.id === decision.currentChoiceId) ??
            null),
    };
  };

  const resultDecisionStateForId = (resultId: string): ResultDecisionState => {
    const context = resultContextForId(resultId);
    if (context === null) return null;
    return context.decision?.value.state ?? null;
  };

  const resultDecisionDisabledReasonForId = (resultId: string): string | null => {
    const context = resultContextForId(resultId);
    if (context === null)
      return locale === 'zh-CN'
        ? '当前权威 Result 或 Shot 引用不可用；请刷新项目。'
        : 'The current authoritative Result or Shot reference is unavailable. Refresh the Project.';
    if (context.decision !== undefined && context.currentChoice === null)
      return locale === 'zh-CN'
        ? '当前决定缺少精确的 Choice 引用；请刷新项目。'
        : 'The current decision is missing its exact Choice ref. Refresh the Project.';
    return null;
  };

  const recordResultDecision = async (
    resultId: string,
    action: ResultDecisionAction,
    detail: string,
  ) => {
    const context = resultContextForId(resultId);
    if (context === null)
      throw new Error('The exact Result and current Shot references are unavailable.');
    const shot = {
      authority: 'production' as const,
      id: context.shot.id,
      revision: context.shot.revision,
      contentHash: context.shot.contentHash,
    };
    let input: DesktopCallV1<'decision.record'>['input'];
    if (action === 'undo') {
      if (context.currentChoice === null)
        throw new Error('The exact current Choice reference is unavailable.');
      input = { action, targetChoice: context.currentChoice, currentOwner: shot };
    } else if (action === 'refine') {
      input = { action, shot, result: context.result.resultRef, instruction: detail };
    } else {
      input = { action, shot, result: context.result.resultRef, feedback: detail };
    }
    const choice = await wireResult(api.decision.record({ requestId: createRequestId(), input }));
    dispatchSelection({ type: 'refresh', ref: choice.ownerAfter });
    await refreshAfterAcceptedChange();
  };

  const protectionTargetForRef = (ref: DomainObjectRef | null): FocusProtectionTarget | null => {
    if (ref?.authority === 'generated_result') {
      const context = resultContextForId(ref.id);
      if (context === null) return null;
      const field = {
        owner: 'production' as const,
        objectId: context.shot.id,
        field: 'resultDecision' as const,
        resultId: context.result.resultRef.id,
      };
      return {
        active: context.shot.protections.some(
          (protection) =>
            protection.field.owner === 'production' &&
            protection.field.objectId === field.objectId &&
            protection.field.field === 'resultDecision' &&
            protection.field.resultId === field.resultId,
        ),
        label: locale === 'zh-CN' ? '结果决定保护' : 'Result decision protection',
        command: (mode, reason) => ({
          mode,
          owner: {
            authority: 'production',
            id: context.shot.id,
            revision: context.shot.revision,
            contentHash: context.shot.contentHash,
          },
          field,
          reason,
        }),
      };
    }
    if (ref?.authority === 'production') {
      const object = workspaceData.production.find((view) => view.object.id === ref.id)?.object;
      if (object === undefined) return null;
      const field = {
        owner: 'production' as const,
        objectId: object.id,
        field: 'content' as const,
      };
      return {
        active: object.protections.some(
          (protection) =>
            protection.field.owner === 'production' &&
            protection.field.objectId === object.id &&
            protection.field.field === 'content',
        ),
        label: locale === 'zh-CN' ? '内容事实保护' : 'Content fact protection',
        command: (mode, reason) => ({
          mode,
          owner: {
            authority: 'production',
            id: object.id,
            revision: object.revision,
            contentHash: object.contentHash,
          },
          field,
          reason,
        }),
      };
    }
    if (ref?.authority === 'delivery') {
      const plan = workspaceData.delivery?.plans.find((candidate) => candidate.id === ref.id);
      if (plan === undefined) return null;
      const field = {
        owner: 'delivery' as const,
        deliveryId: plan.id,
        itemId: null,
        field: 'order' as const,
      };
      return {
        active: plan.protections.some(
          (protection) =>
            protection.field.owner === 'delivery' &&
            protection.field.deliveryId === plan.id &&
            protection.field.itemId === null &&
            protection.field.field === 'order',
        ),
        label: locale === 'zh-CN' ? '交付顺序保护' : 'Delivery order protection',
        command: (mode, reason) => ({
          mode,
          owner: {
            authority: 'delivery',
            id: plan.id,
            revision: plan.revision,
            contentHash: plan.contentHash,
          },
          field,
          reason,
        }),
      };
    }
    return null;
  };

  const requestProtection = async (
    command: ProtectionCommand,
  ): Promise<PendingProtectionConfirmation | null> => {
    try {
      const choice = await wireResult(
        api.decision.protect({ requestId: createRequestId(), input: command }),
      );
      dispatchSelection({ type: 'refresh', ref: choice.ownerAfter });
      await refreshAfterAcceptedChange();
      return null;
    } catch (cause) {
      if (cause instanceof DesktopApiError && cause.confirmation !== null) {
        return {
          id: cause.confirmation.id,
          immutableInputHash: cause.confirmation.immutableInputHash,
          summary: cause.message,
        };
      }
      throw cause;
    }
  };

  const respondProtection = async (
    confirmation: PendingProtectionConfirmation,
    decision: 'approved' | 'denied',
  ) => {
    const response = await wireResult(
      api.confirmation.respond({
        requestId: createRequestId(),
        input: {
          confirmationId: confirmation.id,
          immutableInputHash: confirmation.immutableInputHash,
          decision,
        },
      }),
    );
    if (response.effect?.kind === 'decision_protection_changed') {
      dispatchSelection({ type: 'refresh', ref: response.effect.owner });
      await refreshAfterAcceptedChange();
    }
  };

  const requestCommander = async (
    text: string,
    context: DomainObjectRef | null,
    exportDestinationGrant: DeliveryDestinationGrantV1 | null = null,
  ) => {
    const selectedContext =
      context === null
        ? selectionToRunContext(selection)
        : [{ ref: context, role: 'selected' as const }];
    if (context !== null) {
      setInspectedHistory(null);
      dispatchSelection({ type: 'select', ref: context });
    }
    await send(text, {
      selectedContext,
      attachments: [],
      exportDestinationGrant,
      preservePendingAttachments: true,
    });
    if (viewportMode === 'narrow') enterFocus('workspace');
    else setDockCollapsed(false);
  };

  const requestDeliveryExport = async (input: {
    readonly text: string;
    readonly context: DeliveryRef;
    readonly suggestedFileName: string;
    readonly allowedExtensions: readonly string[];
  }): Promise<'selected' | 'cancelled'> => {
    if (activeChatId === null) throw new Error('Create a Project Chat before exporting.');
    if (project === null) throw new Error('The current Project is not loaded.');
    const result = await wireResult(
      api.os.exportPick({
        requestId: createRequestId(),
        input: {
          chatId: activeChatId,
          projectId: project.id,
          deliveryPlan: input.context,
          destination: 'file',
          suggestedFileName: input.suggestedFileName,
          allowedExtensions: [...input.allowedExtensions],
        },
      }),
    );
    if (result.state === 'cancelled') return 'cancelled';
    await requestCommander(input.text, input.context, result.grant);
    return 'selected';
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
    const next = await wireResult(api.run.control({ requestId: createRequestId(), input }));
    setCurrentRun(next);
    await refreshAfterAcceptedChange('overview');
  };

  const answerInteraction = async (interactionId: string, text: string) => {
    await wireResult(
      api.interaction.answer({
        requestId: createRequestId(),
        input: { interactionId, answer: { kind: 'free_text', text } },
      }),
    );
    await refreshAfterAcceptedChange('overview');
  };

  const answerConfirmation = async (
    confirmationId: string,
    immutableInputHash: string,
    decision: 'approved' | 'denied',
  ) => {
    await wireResult(
      api.confirmation.respond({
        requestId: createRequestId(),
        input: { confirmationId, immutableInputHash, decision },
      }),
    );
    await refreshAfterAcceptedChange('overview');
  };

  const rename = async (name: string) => {
    if (project === null) return;
    const updated = await wireResult(
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

  const archiveProject = async () => {
    if (project === null || projectLifecyclePending) return;
    setProjectLifecyclePending(true);
    setRefreshWarning(null);
    try {
      await wireResult(
        api.project.update({
          requestId: createRequestId(),
          input: {
            projectId,
            expectedRevision: project.revision,
            name: null,
            lifecycle: 'archived',
          },
        }),
      );
      onBack();
    } catch (cause) {
      setRefreshWarning(
        cause instanceof Error && cause.message.trim().length > 0
          ? cause.message
          : locale === 'zh-CN'
            ? '无法归档项目。'
            : 'The Project could not be archived.',
      );
    } finally {
      setProjectLifecyclePending(false);
    }
  };

  const updateSettings = async (next: ProjectSettings) => {
    if (settings === null) return;
    const updated = await wireResult(
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

  const applyPlugin = async (input: DesktopCallV1<'plugin.apply'>['input']) => {
    if (pluginPendingRef.current !== null) return;
    pluginPendingRef.current = input.packageId;
    setPluginPending(input.packageId);
    try {
      await wireResult(api.plugin.apply({ requestId: createRequestId(), input }));
      await Promise.all([loadPluginPackages(), loadCapabilities()]);
    } finally {
      pluginPendingRef.current = null;
      setPluginPending(null);
    }
  };

  const enterFocus = (returnTarget: 'commander' | 'workspace' = 'commander') => {
    focusReturnTargetRef.current = returnTarget;
    restoreScrollRef.current = workspaceScrollRef.current?.scrollTop ?? 0;
    setFocus(true);
  };
  const setStoredDockWidth = (width: number) => {
    setDockWidth(width);
    try {
      localStorage.setItem(`lucid-fin:dock-width:${projectId}`, String(width));
    } catch {
      // The live width remains valid for this session.
    }
  };
  const toggleDock = () => {
    setDockCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(`lucid-fin:dock-collapsed:${projectId}`, String(next));
      } catch {
        // The live collapsed state remains valid for this session.
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="lucid-full-state" role="status">
        <span className="lucid-spinner" />
        {appCopy(locale, 'loading')}
      </div>
    );
  }
  if (error !== null || project === null || settings === null || overview === null) {
    return (
      <div className="lucid-full-state lucid-state-error" role="alert">
        <strong>{locale === 'zh-CN' ? '无法打开项目' : 'Project could not open'}</strong>
        <span>{error ?? 'Required Project state is unavailable.'}</span>
        <div>
          <button type="button" onClick={() => void hydrate()}>
            {appCopy(locale, 'retry')}
          </button>
          <button type="button" onClick={onBack}>
            {appCopy(locale, 'backToProjects')}
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
  for (const result of workspaceData.results) {
    const target = workspaceData.production.find((view) => view.object.id === result.targetRef.id);
    const targetLabel =
      target === undefined
        ? result.resultRef.id
        : 'title' in target.object.content
          ? target.object.content.title
          : 'name' in target.object.content
            ? target.object.content.name
            : target.object.type;
    labels.set(
      `${result.resultRef.authority}:${result.resultRef.id}`,
      target === undefined ? result.resultRef.id : `${targetLabel} · ${result.resultRef.id}`,
    );
  }

  const settingsPanel = (
    <ProjectSettingsPanel
      open={settingsOpen}
      project={project}
      settings={settings}
      capabilities={capabilities}
      capabilitiesError={capabilitiesError}
      pluginPackages={pluginPackages}
      pluginPackagesError={pluginPackagesError}
      pluginPending={pluginPending}
      onClose={() => setSettingsOpen(false)}
      onRetryCapabilities={loadCapabilities}
      onRetryPluginPackages={loadPluginPackages}
      onPluginApply={applyPlugin}
      onRename={rename}
      onSettingsChange={updateSettings}
    />
  );
  const refreshNotice =
    refreshWarning === null ? null : (
      <div className="lucid-refresh-warning" role="alert">
        <span>{refreshWarning}</span>
        <button type="button" onClick={() => void retryRefresh()}>
          {locale === 'zh-CN' ? '重试刷新' : 'Retry refresh'}
        </button>
      </div>
    );

  const commander = (
    <CommanderDock
      project={project}
      settings={settings}
      chats={chats}
      chatsHaveMore={chatNextCursor !== null}
      activeChat={activeChat}
      messages={messages}
      messagesHaveMore={messageNextCursor !== null}
      projectSearchMessages={projectSearchMessages}
      run={currentRun}
      events={events}
      eventsHaveMore={eventNextCursor !== null}
      taskList={activeTaskList}
      selection={selection}
      composerDraft={composerDraft}
      pendingAttachments={pendingAttachments}
      conversationScroll={conversationScrollRef}
      focusButtonRef={focusButtonRef}
      labelForRef={(ref) => labels.get(`${ref.authority}:${ref.id}`) ?? ref.id}
      focus={focus}
      onFocus={() => enterFocus('commander')}
      onExitFocus={exitFocus}
      onOpenProjectSettings={() => setSettingsOpen(true)}
      onSwitchChat={switchChat}
      onCreateChat={createChat}
      onLoadMoreChats={loadMoreChats}
      onLoadEarlierMessages={loadEarlierMessages}
      onLoadMoreRunEvents={loadMoreRunEvents}
      onArchiveChat={(chatId) => closeChat(chatId, 'archive')}
      onDeleteChat={(chatId) => closeChat(chatId, 'delete')}
      onPrepareSearch={prepareProjectSearch}
      onComposerDraftChange={setComposerDraft}
      onAttachReference={attachReference}
      onSend={send}
      onControlRun={controlRun}
      onAnswerInteraction={answerInteraction}
      onAnswerConfirmation={answerConfirmation}
      resultDecisionStateForId={resultDecisionStateForId}
      resultDecisionDisabledReasonForId={resultDecisionDisabledReasonForId}
      onResultDecision={recordResultDecision}
      onOpenResult={(resultId) => {
        const result = workspaceData.results.find(
          (candidate) => candidate.resultRef.id === resultId,
        );
        if (result !== undefined) {
          setInspectedHistory(null);
          dispatchSelection({ type: 'select', ref: result.resultRef });
        }
        setFocus(false);
        onWorkspaceChange('media');
      }}
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
    const hasInspector = inspectedHistory !== null || selection.primary !== null;
    return (
      <div className={`lucid-focus-shell${hasInspector ? ' has-inspector' : ''}`}>
        {refreshNotice}
        <aside
          className="lucid-focus-chats"
          aria-label={locale === 'zh-CN' ? '项目对话' : 'Project Chats'}
        >
          <strong>{project.name}</strong>
          <div className="lucid-focus-chat-list">
            {chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                className={chat.id === activeChatId ? 'is-active' : ''}
                onClick={() =>
                  void switchChat(chat.id).catch((cause: unknown) => {
                    setRefreshWarning(
                      locale === 'zh-CN'
                        ? `无法切换对话。${summary(cause)}`
                        : `The Chat could not be opened. ${summary(cause)}`,
                    );
                  })
                }
              >
                {chat.title}
              </button>
            ))}
          </div>
        </aside>
        <section className="lucid-focus-conversation">{commander}</section>
        <aside
          className="lucid-focus-inspector"
          aria-label={locale === 'zh-CN' ? '结果检查器' : 'Result inspector'}
        >
          <FocusInspector
            entry={inspectedHistory}
            selection={selection.primary}
            data={workspaceData}
            resultDecisionStateForId={resultDecisionStateForId}
            resultDecisionDisabledReasonForId={resultDecisionDisabledReasonForId}
            onResultDecision={recordResultDecision}
            protection={protectionTargetForRef(selection.primary)}
            onRequestProtection={requestProtection}
            onRespondProtection={respondProtection}
          />
        </aside>
        {settingsPanel}
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
      className={`lucid-project-shell${dockCollapsed ? ' is-dock-collapsed' : ''}`}
      style={{ '--lucid-dock-width': `${dockWidth}px` } as React.CSSProperties}
    >
      <GlobalRail active="projects" />
      <aside className="lucid-project-navigation">
        <header>
          <div>
            <span>{locale === 'zh-CN' ? '项目' : 'Project'}</span>
            <strong>{project.name}</strong>
          </div>
          <button
            type="button"
            aria-label={appCopy(locale, 'projectMenu')}
            onClick={() => setSettingsOpen(true)}
          >
            <CircleEllipsis size={16} />
          </button>
        </header>
        <nav aria-label={locale === 'zh-CN' ? '项目工作区' : 'Project workspace'}>
          {WORKSPACES.map((item) => {
            const Icon = WORKSPACE_ICONS[item];
            return (
              <button
                key={item}
                type="button"
                className={workspace === item ? 'is-active' : ''}
                aria-current={workspace === item ? 'page' : undefined}
                aria-label={`${appCopy(locale, item)} ${counts[item]}`}
                onClick={() => onWorkspaceChange(item)}
              >
                <Icon size={16} />
                <span>{appCopy(locale, item)}</span>
                <small>{counts[item]}</small>
              </button>
            );
          })}
        </nav>
        <div className="lucid-project-navigation-footer">
          <ProjectSettingsTrigger onOpen={() => setSettingsOpen(true)} />
          <button
            className="lucid-archive-button"
            type="button"
            disabled={projectLifecyclePending}
            onClick={() => void archiveProject()}
          >
            <Archive size={14} />
            {projectLifecyclePending
              ? locale === 'zh-CN'
                ? '正在归档…'
                : 'Archiving…'
              : locale === 'zh-CN'
                ? '归档项目'
                : 'Archive Project'}
          </button>
        </div>
      </aside>
      <section className="lucid-workspace-column">
        <header className="lucid-workspace-header">
          <button className="lucid-narrow-back" type="button" onClick={onBack}>
            <ChevronLeft size={15} />
            {appCopy(locale, 'projects')}
          </button>
          <div>
            <h1>{project.name}</h1>
            <span className="lucid-project-status">
              <span className="lucid-status-dot" />
              {currentRun === null || terminal(currentRun)
                ? locale === 'zh-CN'
                  ? '就绪'
                  : 'Ready'
                : locale === 'zh-CN'
                  ? '进行中'
                  : 'In progress'}
            </span>
          </div>
          <button
            className="lucid-settings-toggle"
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label={locale === 'zh-CN' ? '项目设置' : 'Project settings'}
            title={locale === 'zh-CN' ? '项目设置' : 'Project settings'}
          >
            <Settings size={16} />
          </button>
          <button
            ref={workspaceCommanderButtonRef}
            className="lucid-dock-toggle"
            type="button"
            onClick={viewportMode === 'narrow' ? () => enterFocus('workspace') : toggleDock}
            aria-label={
              viewportMode === 'narrow' || dockCollapsed
                ? appCopy(locale, 'openCommander')
                : locale === 'zh-CN'
                  ? '收起 Commander'
                  : 'Collapse Commander'
            }
          >
            {viewportMode === 'narrow' || dockCollapsed ? (
              <PanelRightOpen size={17} />
            ) : (
              <PanelRightClose size={17} />
            )}
          </button>
        </header>
        {refreshNotice}
        <div className="lucid-workspace-scroll" ref={workspaceScrollRef}>
          <ProjectWorkspace
            workspace={workspace}
            overview={overview}
            data={workspaceData}
            selection={selection}
            onSelect={(ref) => {
              setInspectedHistory(null);
              dispatchSelection({ type: 'select', ref });
            }}
            onOpenWorkspace={onWorkspaceChange}
            onOpenCommander={() => enterFocus('workspace')}
            onInspectHistory={(entry) => {
              setInspectedHistory(entry);
              enterFocus('workspace');
            }}
            canvasMutationPending={canvasMutationPending}
            onMoveCanvasPlacement={moveCanvasPlacement}
            mediaPagePending={workspacePagePending === 'media'}
            onLoadMoreMedia={loadMoreMedia}
            productionPagePending={workspacePagePending === 'production'}
            onLoadMoreProduction={loadMoreProduction}
            resultPagePending={resultPagePending}
            onLoadMoreResults={loadMoreResults}
            historyPagePending={workspacePagePending === 'history'}
            onLoadMoreHistory={loadMoreHistory}
            deliveryPagePending={workspacePagePending === 'delivery'}
            onLoadMoreDelivery={loadMoreDelivery}
            onResultDecision={recordResultDecision}
            onRequestCommander={requestCommander}
            onRequestDeliveryExport={requestDeliveryExport}
            onCancelOperation={cancelDeliveryOperation}
          />
        </div>
      </section>
      {!dockCollapsed && viewportMode !== 'narrow' && (
        <>
          <DockResizeHandle width={dockWidth} onWidthChange={setStoredDockWidth} />
          <aside className="lucid-commander-column" aria-label={appCopy(locale, 'commander')}>
            {commander}
          </aside>
        </>
      )}
      {dockCollapsed && viewportMode !== 'narrow' && (
        <button
          className="lucid-collapsed-dock"
          type="button"
          onClick={toggleDock}
          aria-label={appCopy(locale, 'openCommander')}
        >
          <PanelRightOpen size={18} />
          <span>{appCopy(locale, 'commander')}</span>
        </button>
      )}
      {settingsPanel}
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
      className="lucid-dock-resizer"
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
