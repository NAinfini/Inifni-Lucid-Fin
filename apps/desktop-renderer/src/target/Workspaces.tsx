import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Box,
  CheckCircle2,
  Clapperboard,
  CircleStop,
  Clock3,
  Film,
  Image,
  Layers3,
  Link2,
  Map as MapIcon,
  Play,
  Sparkles,
} from 'lucide-react';
import type { DeliveryRef, DomainObjectRef } from '@lucid-fin/target-contracts';
import type { TargetResult } from './api.js';
import { targetCopy } from './copy.js';
import { useTargetEnvironment } from './environment.js';
import {
  TargetMediaPreview,
  UnsupportedMediaPreview,
  useSynchronizedPlayback,
  type SynchronizedPlaybackGroup,
} from './MediaPreview.js';
import {
  ResultDecisionControls,
  type TargetResultDecisionAction,
  type TargetResultDecisionState,
} from './ResultDecisionControls.js';
import type { TargetSharedSelection, TargetWorkspace } from './shared-selection.js';

export interface TargetWorkspaceData {
  readonly canvas: TargetResult<'canvas.get'> | null;
  readonly media: TargetResult<'media.project.list'>['items'];
  readonly mediaNextCursor: TargetResult<'media.project.list'>['nextCursor'];
  readonly production: TargetResult<'production.query'>['items'];
  readonly productionNextCursor: TargetResult<'production.query'>['nextCursor'];
  readonly results: TargetResult<'result.query'>['items'];
  readonly resultNextCursor: TargetResult<'result.query'>['nextCursor'];
  readonly history: TargetResult<'history.query'>['items'];
  readonly historyNextCursor: TargetResult<'history.query'>['nextCursor'];
  readonly delivery: TargetResult<'delivery.query'> | null;
  readonly deliveryOperations: TargetResult<'operation.get'>['operations'];
}

interface ProjectWorkspaceProps {
  readonly workspace: TargetWorkspace;
  readonly overview: TargetResult<'overview.get'>;
  readonly data: TargetWorkspaceData;
  readonly selection: TargetSharedSelection;
  readonly onSelect: (ref: DomainObjectRef) => void;
  readonly onOpenWorkspace: (workspace: TargetWorkspace) => void;
  readonly onOpenCommander: () => void;
  readonly onInspectHistory: (entry: TargetWorkspaceData['history'][number]) => void;
  readonly canvasMutationPending: boolean;
  readonly mediaPagePending: boolean;
  readonly productionPagePending: boolean;
  readonly resultPagePending: boolean;
  readonly historyPagePending: boolean;
  readonly deliveryPagePending: boolean;
  readonly onMoveCanvasPlacement: (
    placementId: string,
    position: { readonly x: number; readonly y: number },
  ) => Promise<void>;
  readonly onResultDecision: (
    resultId: string,
    action: TargetResultDecisionAction,
    detail: string,
  ) => Promise<void>;
  readonly onLoadMoreMedia: () => Promise<void>;
  readonly onLoadMoreProduction: () => Promise<void>;
  readonly onLoadMoreResults: () => Promise<void>;
  readonly onLoadMoreHistory: () => Promise<void>;
  readonly onLoadMoreDelivery: () => Promise<void>;
  readonly onRequestCommander: (text: string, context: DomainObjectRef | null) => Promise<void>;
  readonly onRequestDeliveryExport: (input: {
    readonly text: string;
    readonly context: DeliveryRef;
    readonly suggestedFileName: string;
    readonly allowedExtensions: readonly string[];
  }) => Promise<'selected' | 'cancelled'>;
  readonly onCancelOperation: (
    operation: TargetWorkspaceData['deliveryOperations'][number],
  ) => Promise<void>;
}

function selected(selection: TargetSharedSelection, ref: DomainObjectRef): boolean {
  return selection.primary?.authority === ref.authority && selection.primary.id === ref.id;
}

function productionLabel(view: TargetWorkspaceData['production'][number]): string {
  const object = view.object;
  if ('title' in object.content) return object.content.title;
  if ('name' in object.content) return object.content.name;
  if ('summary' in object.content) return object.content.summary;
  return object.type;
}

function refForProduction(view: TargetWorkspaceData['production'][number]): DomainObjectRef {
  return {
    authority: 'production',
    id: view.object.id,
    revision: view.object.revision,
    contentHash: view.object.contentHash,
  };
}

function historyKey(entry: TargetWorkspaceData['history'][number]): string {
  if (entry.source === 'message') return `message:${entry.messageId}`;
  if (entry.source === 'run_event') return `run_event:${entry.eventId}`;
  if (entry.source === 'project_event') return `project_event:${entry.eventId}`;
  if (entry.source === 'generated_result') return `generated_result:${entry.resultId}`;
  return `user_choice:${entry.choiceId}`;
}

function recentOverviewResults(data: TargetWorkspaceData): TargetWorkspaceData['results'] {
  const resultsById = new Map(data.results.map((result) => [result.resultRef.id, result] as const));
  const seen = new Set<string>();
  const recent: TargetWorkspaceData['results'][number][] = [];
  for (const entry of data.history) {
    if (entry.source !== 'generated_result' || seen.has(entry.resultId)) continue;
    seen.add(entry.resultId);
    const result = resultsById.get(entry.resultId);
    if (result !== undefined) recent.push(result);
    if (recent.length === 4) return recent;
  }
  return recent;
}

function OverviewWorkspace({
  overview,
  data,
  selection,
  onSelect,
  onResultDecision,
  onOpenWorkspace,
  onOpenCommander,
  onInspectHistory,
  historyPagePending,
  onLoadMoreHistory,
}: Pick<
  ProjectWorkspaceProps,
  | 'overview'
  | 'data'
  | 'selection'
  | 'onSelect'
  | 'onResultDecision'
  | 'onOpenWorkspace'
  | 'onOpenCommander'
  | 'onInspectHistory'
  | 'historyPagePending'
  | 'onLoadMoreHistory'
>) {
  const { locale } = useTargetEnvironment();
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [historyPageError, setHistoryPageError] = useState<string | null>(null);
  const waiting = overview.activeRuns.filter((run) =>
    ['waiting_question', 'waiting_confirmation', 'blocked'].includes(run.status),
  );
  const recentResults = recentOverviewResults(data);
  const direction = data.production.find((view) => view.object.type === 'direction');
  const recent = showAllHistory ? data.history : data.history.slice(0, 8);
  const loadMoreHistory = async () => {
    setHistoryPageError(null);
    try {
      await onLoadMoreHistory();
    } catch (cause) {
      setHistoryPageError(
        cause instanceof Error
          ? cause.message
          : locale === 'zh-CN'
            ? '无法加载更多项目历史。'
            : 'More Project History could not be loaded.',
      );
    }
  };

  return (
    <div className="target-workspace target-overview-workspace">
      <header className="target-surface-heading">
        <div>
          <h2>{targetCopy(locale, 'overview')}</h2>
          <p>
            {locale === 'zh-CN'
              ? '先处理需要你的决定，再继续制作。'
              : 'Decisions first, then the work shaping the film.'}
          </p>
        </div>
      </header>

      {waiting.length > 0 && (
        <section
          className="target-feed-section target-decision-section"
          aria-labelledby="target-decisions-heading"
        >
          <header>
            <AlertCircle size={15} />
            <h3 id="target-decisions-heading">{targetCopy(locale, 'decisions')}</h3>
          </header>
          {waiting.map((run) => (
            <button key={run.id} type="button" onClick={onOpenCommander}>
              <span>
                <strong>
                  {run.status === 'waiting_confirmation'
                    ? locale === 'zh-CN'
                      ? '确认后继续'
                      : 'Confirmation needed'
                    : locale === 'zh-CN'
                      ? 'Commander 正在等待'
                      : 'Commander is waiting'}
                </strong>
                <small>{run.id}</small>
              </span>
              <ArrowRight size={15} />
            </button>
          ))}
        </section>
      )}

      {recentResults.length > 0 && (
        <section
          className="target-feed-section target-overview-results-section"
          aria-labelledby="target-overview-results-heading"
        >
          <header>
            <Sparkles size={15} />
            <h3 id="target-overview-results-heading">
              {locale === 'zh-CN' ? '最近生成结果' : 'Recent generated results'}
            </h3>
            <button type="button" onClick={() => onOpenWorkspace('media')}>
              {locale === 'zh-CN' ? '在媒体中查看全部' : 'Review all in Media'}
              <ArrowRight size={13} />
            </button>
          </header>
          <div className="target-overview-results-strip">
            {recentResults.map((result) => (
              <GeneratedResultCard
                key={result.resultRef.id}
                projectId={overview.project.id}
                result={result}
                data={data}
                selection={selection}
                compare={false}
                compact
                onSelect={onSelect}
                onResultDecision={onResultDecision}
              />
            ))}
          </div>
        </section>
      )}

      <section className="target-feed-section" aria-labelledby="target-direction-heading">
        <header>
          <Sparkles size={15} />
          <h3 id="target-direction-heading">
            {locale === 'zh-CN' ? '当前方向' : 'Current direction'}
          </h3>
        </header>
        {direction?.object.type === 'direction' ? (
          <div className="target-direction-copy">
            <strong>{direction.object.content.summary}</strong>
            <p>{direction.object.content.visualLanguage}</p>
            <span>{direction.object.content.tone}</span>
            <button type="button" onClick={() => onOpenWorkspace('production')}>
              {locale === 'zh-CN' ? '在制作中查看' : 'Open in Production'}
              <ArrowRight size={13} />
            </button>
          </div>
        ) : (
          <div className="target-inline-empty">
            {locale === 'zh-CN'
              ? 'Commander 将从你的首个请求建立方向。'
              : 'Commander will derive direction from your first request.'}
          </div>
        )}
      </section>

      <section className="target-feed-section" aria-labelledby="target-active-heading">
        <header>
          <Clock3 size={15} />
          <h3 id="target-active-heading">{targetCopy(locale, 'activeWork')}</h3>
        </header>
        {overview.activeRuns.length === 0 ? (
          <div className="target-inline-empty">
            {locale === 'zh-CN'
              ? '当前没有活动 Run。'
              : 'No active Run. Start from Commander when ready.'}
          </div>
        ) : (
          overview.activeRuns.map((run) => (
            <div className="target-active-row" key={run.id}>
              <span className="target-active-icon">
                <Clapperboard size={17} />
              </span>
              <span>
                <strong>
                  {run.status === 'recovering'
                    ? locale === 'zh-CN'
                      ? '正在恢复已记录工作'
                      : 'Recovering recorded work'
                    : locale === 'zh-CN'
                      ? 'Commander 正在制作'
                      : 'Commander is producing'}
                </strong>
                <small>
                  {run.model.model} · {run.permissionMode}
                </small>
              </span>
              <span className="target-live-label">
                <span />
                {run.status}
              </span>
            </div>
          ))
        )}
      </section>

      <section className="target-feed-section" aria-labelledby="target-recent-heading">
        <header>
          <Layers3 size={15} />
          <h3 id="target-recent-heading">{targetCopy(locale, 'recentChanges')}</h3>
        </header>
        {recent.length === 0 ? (
          <div className="target-inline-empty">{targetCopy(locale, 'noWorkspaceData')}</div>
        ) : (
          recent.map((item) => (
            <button
              type="button"
              className="target-change-row"
              key={historyKey(item)}
              onClick={() => onInspectHistory(item)}
            >
              <span>
                {item.source === 'generated_result' ? <Image size={14} /> : <Film size={14} />}
                {item.summary}
              </span>
              <small>
                {new Intl.DateTimeFormat(locale, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                }).format(new Date(item.occurredAt))}
              </small>
            </button>
          ))
        )}
        {!showAllHistory && data.history.length > recent.length && (
          <button
            className="target-workspace-pager-button"
            type="button"
            onClick={() => setShowAllHistory(true)}
          >
            {locale === 'zh-CN'
              ? `查看全部 ${data.history.length} 条变更`
              : `View all ${data.history.length} changes`}
          </button>
        )}
        {data.historyNextCursor !== null && (
          <div className="target-workspace-pager">
            <button
              type="button"
              disabled={historyPagePending}
              onClick={() => void loadMoreHistory()}
            >
              {historyPagePending
                ? locale === 'zh-CN'
                  ? '正在加载…'
                  : 'Loading…'
                : locale === 'zh-CN'
                  ? '加载更多历史'
                  : 'Load more History'}
            </button>
            {historyPageError !== null && (
              <p className="target-inline-error" role="alert">
                {historyPageError}
              </p>
            )}
          </div>
        )}
      </section>

      <section
        className="target-readiness-strip"
        aria-label={locale === 'zh-CN' ? '制作与交付状态' : 'Production and delivery readiness'}
      >
        <span>
          <CheckCircle2 size={15} />
          {overview.counts.productionObjects}{' '}
          {locale === 'zh-CN' ? '个制作对象' : 'production objects'}
        </span>
        <span>
          <Film size={15} />
          {overview.counts.media} {locale === 'zh-CN' ? '项媒体' : 'media items'}
        </span>
        <button type="button" onClick={() => onOpenWorkspace('delivery')}>
          {locale === 'zh-CN' ? '检查交付' : 'Check Delivery'}
          <ArrowRight size={13} />
        </button>
      </section>
    </div>
  );
}

type CanvasPlacement = NonNullable<TargetWorkspaceData['canvas']>['placements'][number];

function CanvasPlacementNode({
  placement,
  label,
  targetRef,
  isSelected,
  mutationPending,
  onSelect,
  onMove,
}: {
  readonly placement: CanvasPlacement;
  readonly label: string;
  readonly targetRef: DomainObjectRef;
  readonly isSelected: boolean;
  readonly mutationPending: boolean;
  readonly onSelect: () => void;
  readonly onMove: (position: { readonly x: number; readonly y: number }) => Promise<void>;
}) {
  const { locale } = useTargetEnvironment();
  const drag = useRef<{
    readonly pointerId: number;
    readonly clientX: number;
    readonly clientY: number;
    readonly position: CanvasPlacement['position'];
  } | null>(null);
  const [preview, setPreview] = useState<CanvasPlacement['position'] | null>(null);
  const position = preview ?? placement.position;

  const commit = async (next: CanvasPlacement['position']) => {
    try {
      await onMove(next);
    } finally {
      setPreview(null);
    }
  };

  const nextPointerPosition = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = drag.current;
    if (active === null || active.pointerId !== event.pointerId) return null;
    return {
      x: Math.round(active.position.x + event.clientX - active.clientX),
      y: Math.round(active.position.y + event.clientY - active.clientY),
    };
  };

  return (
    <button
      type="button"
      className={`target-canvas-node${isSelected ? ' is-selected' : ''}${preview ? ' is-dragging' : ''}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        width: `${placement.size.width}px`,
        minHeight: `${placement.size.height}px`,
        zIndex: placement.zIndex,
      }}
      disabled={mutationPending}
      aria-describedby="target-canvas-move-help"
      aria-label={`${locale === 'zh-CN' ? '选择并移动' : 'Select and move'} ${label}`}
      onClick={onSelect}
      onPointerDown={(event) => {
        if (event.button !== 0 || mutationPending) return;
        onSelect();
        drag.current = {
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          position: placement.position,
        };
        if (typeof event.currentTarget.setPointerCapture === 'function')
          event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const next = nextPointerPosition(event);
        if (next !== null) setPreview(next);
      }}
      onPointerUp={(event) => {
        const next = nextPointerPosition(event);
        drag.current = null;
        if (
          typeof event.currentTarget.hasPointerCapture === 'function' &&
          event.currentTarget.hasPointerCapture(event.pointerId)
        )
          event.currentTarget.releasePointerCapture(event.pointerId);
        if (next !== null && (next.x !== placement.position.x || next.y !== placement.position.y))
          void commit(next);
        else setPreview(null);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setPreview(null);
      }}
      onKeyDown={(event) => {
        const offsets = {
          ArrowLeft: { x: -10, y: 0 },
          ArrowRight: { x: 10, y: 0 },
          ArrowUp: { x: 0, y: -10 },
          ArrowDown: { x: 0, y: 10 },
        } as const;
        const offset = offsets[event.key as keyof typeof offsets];
        if (offset === undefined || mutationPending) return;
        event.preventDefault();
        void commit({ x: placement.position.x + offset.x, y: placement.position.y + offset.y });
      }}
    >
      <span className="target-canvas-node-media">
        <Film size={24} />
      </span>
      <span>
        <strong>{label}</strong>
        <small>{targetRef.authority.replaceAll('_', ' ')}</small>
      </span>
    </button>
  );
}

function CanvasWorkspace({
  data,
  selection,
  onSelect,
  canvasMutationPending,
  onMoveCanvasPlacement,
}: Pick<
  ProjectWorkspaceProps,
  'data' | 'selection' | 'onSelect' | 'canvasMutationPending' | 'onMoveCanvasPlacement'
>) {
  const { locale } = useTargetEnvironment();
  const canvas = data.canvas;
  const [mutationError, setMutationError] = useState<string | null>(null);
  const move = async (placementId: string, position: CanvasPlacement['position']) => {
    setMutationError(null);
    try {
      await onMoveCanvasPlacement(placementId, position);
    } catch (cause) {
      setMutationError(
        cause instanceof Error
          ? cause.message
          : locale === 'zh-CN'
            ? '无法移动 Canvas 对象。'
            : 'The Canvas placement could not be moved.',
      );
    }
  };
  return (
    <div className="target-workspace target-canvas-workspace">
      <header className="target-surface-heading is-compact">
        <div>
          <h2>{targetCopy(locale, 'canvas')}</h2>
          <p>
            {locale === 'zh-CN'
              ? '空间工作区 · 只拥有位置、分组和连线'
              : 'Spatial workspace · placement, grouping, and edges only'}
          </p>
        </div>
        <span>
          {canvas?.placements.length ?? 0} {locale === 'zh-CN' ? '个放置对象' : 'placements'}
        </span>
      </header>
      <div
        className="target-canvas-field"
        aria-label={locale === 'zh-CN' ? '空间工作区' : 'Spatial workspace'}
      >
        {canvas === null || canvas.placements.length === 0 ? (
          <div className="target-canvas-empty">
            <MapIcon size={24} />
            <strong>
              {locale === 'zh-CN' ? '把项目对象放在这里' : 'Place Project objects here'}
            </strong>
            <span>
              {locale === 'zh-CN'
                ? '选择现有对象，或让 Commander 整理当前工作。'
                : 'Select existing objects, attach media, or ask Commander to arrange the work.'}
            </span>
          </div>
        ) : (
          canvas.placements.map((placement) => {
            const ref: DomainObjectRef = {
              authority: placement.target.targetType,
              id: placement.target.targetId,
              revision: placement.target.targetRevision,
              contentHash: placement.target.targetContentHash,
            };
            const label = data.production.find((view) => view.object.id === ref.id);
            return (
              <CanvasPlacementNode
                key={placement.id}
                placement={placement}
                label={label ? productionLabel(label) : ref.id}
                targetRef={ref}
                isSelected={selected(selection, ref)}
                mutationPending={canvasMutationPending}
                onSelect={() => onSelect(ref)}
                onMove={(position) => move(placement.id, position)}
              />
            );
          })
        )}
        <div className="target-canvas-key" id="target-canvas-move-help">
          <Link2 size={13} />
          {locale === 'zh-CN'
            ? '拖动或使用方向键；只改变空间位置'
            : 'Drag or use arrow keys; only spatial placement changes'}
        </div>
        {mutationError !== null && (
          <p className="target-canvas-error" role="alert">
            {mutationError}
          </p>
        )}
      </div>
    </div>
  );
}

type GeneratedResultView = TargetWorkspaceData['results'][number];

function resultDecisionState(
  data: TargetWorkspaceData,
  result: GeneratedResultView,
): TargetResultDecisionState {
  const shot = data.production.find(
    (view) => view.object.type === 'shot' && view.object.id === result.targetRef.id,
  );
  if (shot?.object.type !== 'shot') return null;
  return (
    shot.object.resultDecisions.find((decision) => decision.result.id === result.resultRef.id)
      ?.value.state ?? null
  );
}

function GeneratedResultCard({
  projectId,
  result,
  data,
  selection,
  compare,
  compact = false,
  playback,
  onSelect,
  onResultDecision,
}: {
  readonly projectId: string;
  readonly result: GeneratedResultView;
  readonly data: TargetWorkspaceData;
  readonly selection: TargetSharedSelection;
  readonly compare: boolean;
  readonly compact?: boolean;
  readonly playback?: SynchronizedPlaybackGroup;
  readonly onSelect: (ref: DomainObjectRef) => void;
  readonly onResultDecision: ProjectWorkspaceProps['onResultDecision'];
}) {
  const { locale } = useTargetEnvironment();
  const shot = data.production.find(
    (view) => view.object.type === 'shot' && view.object.id === result.targetRef.id,
  );
  const exactShotAvailable = shot?.object.type === 'shot';
  const disabledReason = exactShotAvailable
    ? null
    : locale === 'zh-CN'
      ? '当前权威 Shot 引用不可用；请刷新项目。'
      : 'The current authoritative Shot reference is unavailable. Refresh the Project.';
  const shotLabel = exactShotAvailable ? productionLabel(shot) : result.targetRef.id;
  const validation = result.technicalValidation.state;
  const artifact = result.artifact;
  const previewable =
    artifact !== null &&
    (artifact.kind === 'image' || artifact.kind === 'video' || artifact.kind === 'audio');
  return (
    <article
      className={`target-generated-result${compare ? ' is-compare' : ''}${compact ? ' is-compact' : ''}${selected(selection, result.resultRef) ? ' is-selected' : ''}`}
    >
      {previewable ? (
        <TargetMediaPreview
          projectId={projectId}
          source={{ kind: 'generated_result', result: result.resultRef, artifact }}
          label={`${shotLabel} · ${result.resultRef.id}`}
          syncId={compare ? result.resultRef.id : undefined}
          sync={compare ? playback : undefined}
        />
      ) : (
        <UnsupportedMediaPreview label={`${shotLabel} · ${result.resultRef.id}`} />
      )}
      <button
        className="target-result-select-surface"
        type="button"
        onClick={() => onSelect(result.resultRef)}
        aria-label={`${locale === 'zh-CN' ? '检查候选' : 'Inspect candidate'} ${result.resultRef.id}`}
      >
        <span className="target-result-copy">
          <strong>{shotLabel}</strong>
          <small>{result.resultRef.id}</small>
          <em className={`is-${validation}`}>
            {validation === 'valid'
              ? locale === 'zh-CN'
                ? '技术检查通过'
                : 'Technical checks passed'
              : validation === 'invalid'
                ? locale === 'zh-CN'
                  ? '技术检查失败'
                  : 'Technical checks failed'
                : locale === 'zh-CN'
                  ? '技术检查待定'
                  : 'Technical checks pending'}
          </em>
        </span>
      </button>
      {!compact && (
        <dl className="target-result-facts">
          <div>
            <dt>{locale === 'zh-CN' ? '提供方' : 'Provider'}</dt>
            <dd>
              {result.provider === null
                ? locale === 'zh-CN'
                  ? '未请求'
                  : 'Not requested'
                : `${result.provider.providerId} · ${result.provider.model}`}
            </dd>
          </div>
          <div>
            <dt>{locale === 'zh-CN' ? '请求' : 'Request'}</dt>
            <dd>{result.requestId}</dd>
          </div>
        </dl>
      )}
      {!compact && result.submittedPrompt !== null && <p>{result.submittedPrompt}</p>}
      <ResultDecisionControls
        resultId={result.resultRef.id}
        state={resultDecisionState(data, result)}
        disabledReason={disabledReason}
        onDecide={(action, detail) => onResultDecision(result.resultRef.id, action, detail)}
      />
    </article>
  );
}

function MediaWorkspace({
  overview,
  data,
  selection,
  onSelect,
  onResultDecision,
  mediaPagePending,
  onLoadMoreMedia,
  resultPagePending,
  onLoadMoreResults,
}: Pick<
  ProjectWorkspaceProps,
  | 'overview'
  | 'data'
  | 'selection'
  | 'onSelect'
  | 'onResultDecision'
  | 'mediaPagePending'
  | 'onLoadMoreMedia'
  | 'resultPagePending'
  | 'onLoadMoreResults'
>) {
  const { locale } = useTargetEnvironment();
  const playback = useSynchronizedPlayback();
  const [mediaPageError, setMediaPageError] = useState<string | null>(null);
  const [resultPageError, setResultPageError] = useState<string | null>(null);
  const [view, setView] = useState<'library' | 'candidates' | 'compare'>(() =>
    selection.primary?.authority === 'generated_result' ? 'candidates' : 'library',
  );
  useEffect(() => {
    if (selection.primary?.authority === 'generated_result') setView('candidates');
  }, [selection.primary?.authority, selection.primary?.id, selection.primary?.revision]);
  const loadMoreMedia = async () => {
    setMediaPageError(null);
    try {
      await onLoadMoreMedia();
    } catch (cause) {
      setMediaPageError(
        cause instanceof Error
          ? cause.message
          : locale === 'zh-CN'
            ? '无法加载更多项目媒体。'
            : 'More Project media could not be loaded.',
      );
    }
  };
  const loadMoreResults = async () => {
    setResultPageError(null);
    try {
      await onLoadMoreResults();
    } catch (cause) {
      setResultPageError(
        cause instanceof Error
          ? cause.message
          : locale === 'zh-CN'
            ? '无法加载更多候选。'
            : 'More candidates could not be loaded.',
      );
    }
  };
  const mediaPager = data.mediaNextCursor !== null && (
    <div className="target-workspace-pager">
      <button type="button" disabled={mediaPagePending} onClick={() => void loadMoreMedia()}>
        {mediaPagePending
          ? locale === 'zh-CN'
            ? '正在加载…'
            : 'Loading…'
          : locale === 'zh-CN'
            ? '加载更多媒体'
            : 'Load more media'}
      </button>
      {mediaPageError !== null && (
        <p className="target-inline-error" role="alert">
          {mediaPageError}
        </p>
      )}
    </div>
  );
  const resultPager = data.resultNextCursor !== null && (
    <div className="target-results-more">
      <button type="button" disabled={resultPagePending} onClick={() => void loadMoreResults()}>
        {resultPagePending
          ? locale === 'zh-CN'
            ? '正在加载…'
            : 'Loading…'
          : locale === 'zh-CN'
            ? '加载更多候选'
            : 'Load more candidates'}
      </button>
      {resultPageError !== null && (
        <p className="target-inline-error" role="alert">
          {resultPageError}
        </p>
      )}
    </div>
  );
  return (
    <div className="target-workspace target-media-workspace">
      <header className="target-surface-heading">
        <div>
          <h2>{targetCopy(locale, 'media')}</h2>
          <p>
            {locale === 'zh-CN'
              ? '项目媒体、候选结果、比较与来源'
              : 'Project Library, candidates, comparison, and provenance'}
          </p>
        </div>
        <div className="target-view-tabs" role="tablist" aria-label={targetCopy(locale, 'media')}>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'library'}
            aria-controls="target-media-library"
            onClick={() => setView('library')}
          >
            {locale === 'zh-CN' ? '项目媒体' : 'Library'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'candidates'}
            aria-controls="target-media-candidates"
            onClick={() => setView('candidates')}
          >
            {locale === 'zh-CN' ? '候选' : 'Candidates'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'compare'}
            aria-controls="target-media-compare"
            onClick={() => setView('compare')}
          >
            {locale === 'zh-CN' ? '比较' : 'Compare'}
          </button>
        </div>
      </header>
      {view === 'library' && (
        <div id="target-media-library" role="tabpanel">
          {data.media.length === 0 ? (
            <div className="target-workspace-empty">
              <Image size={24} />
              <strong>
                {locale === 'zh-CN'
                  ? '添加源媒体或请求生成'
                  : 'Attach source media or request generation'}
              </strong>
              <span>{targetCopy(locale, 'noWorkspaceData')}</span>
            </div>
          ) : (
            <div className="target-media-grid">
              {data.media.map((media, index) => {
                const ref = {
                  authority: 'project_media_ref',
                  id: media.id,
                  revision: media.revision,
                  contentHash: media.contentHash,
                } as const satisfies DomainObjectRef;
                return (
                  <article key={media.id} className={selected(selection, ref) ? 'is-selected' : ''}>
                    <div className="target-media-thumbnail">
                      <TargetMediaPreview
                        projectId={overview.project.id}
                        source={{ kind: 'project_media_ref', ref }}
                        label={media.label}
                      />
                      <small>{String(index + 1).padStart(2, '0')}</small>
                    </div>
                    <button
                      type="button"
                      className="target-media-copy"
                      onClick={() => onSelect(ref)}
                      aria-label={`${locale === 'zh-CN' ? '选择' : 'Select'} ${media.label}`}
                    >
                      <strong>{media.label}</strong>
                      <small>{media.roles.join(' · ')}</small>
                      <em>
                        {media.productionLinks.length}{' '}
                        {locale === 'zh-CN' ? '个制作关联' : 'production links'}
                      </em>
                    </button>
                  </article>
                );
              })}
            </div>
          )}
          {mediaPager}
        </div>
      )}
      {view === 'candidates' && (
        <div id="target-media-candidates" className="target-results-grid" role="tabpanel">
          {data.results.length === 0 ? (
            <div className="target-workspace-empty">
              <Sparkles size={24} />
              <strong>
                {locale === 'zh-CN' ? '还没有生成候选' : 'No generated candidates yet'}
              </strong>
              <span>{targetCopy(locale, 'noWorkspaceData')}</span>
            </div>
          ) : (
            data.results.map((result) => (
              <GeneratedResultCard
                key={result.resultRef.id}
                projectId={overview.project.id}
                result={result}
                data={data}
                selection={selection}
                compare={false}
                onSelect={onSelect}
                onResultDecision={onResultDecision}
              />
            ))
          )}
          {resultPager}
        </div>
      )}
      {view === 'compare' && (
        <div id="target-media-compare" className="target-results-compare" role="tabpanel">
          {data.results.length < 2 && (
            <p className="target-compare-note">
              {locale === 'zh-CN'
                ? '比较会并列显示所有当前候选；至少两个候选时最有用。'
                : 'Compare shows every current candidate side by side and is most useful with two or more.'}
            </p>
          )}
          {playback.error !== null && (
            <p className="target-inline-error target-compare-sync-error" role="alert">
              {locale === 'zh-CN' ? '无法同步播放所有候选。' : playback.error}
            </p>
          )}
          {data.results.length === 0 ? (
            <div className="target-workspace-empty">
              <Film size={24} />
              <strong>{locale === 'zh-CN' ? '没有可比较的候选' : 'Nothing to compare yet'}</strong>
            </div>
          ) : (
            data.results.map((result) => (
              <GeneratedResultCard
                key={result.resultRef.id}
                projectId={overview.project.id}
                result={result}
                data={data}
                selection={selection}
                compare
                playback={playback}
                onSelect={onSelect}
                onResultDecision={onResultDecision}
              />
            ))
          )}
          {resultPager}
        </div>
      )}
    </div>
  );
}

function ProductionWorkspace({
  data,
  selection,
  onSelect,
  productionPagePending,
  onLoadMoreProduction,
}: Pick<
  ProjectWorkspaceProps,
  'data' | 'selection' | 'onSelect' | 'productionPagePending' | 'onLoadMoreProduction'
>) {
  const { locale } = useTargetEnvironment();
  const [pageError, setPageError] = useState<string | null>(null);
  const groups = [
    { key: 'direction', label: locale === 'zh-CN' ? '方向' : 'Direction', types: ['direction'] },
    {
      key: 'story',
      label: locale === 'zh-CN' ? '故事' : 'Story',
      types: ['story', 'sequence', 'scene', 'beat'],
    },
    {
      key: 'world',
      label: locale === 'zh-CN' ? '世界' : 'World',
      types: ['character', 'location', 'equipment', 'prop', 'wardrobe', 'world_fact'],
    },
    { key: 'shots', label: locale === 'zh-CN' ? '镜头' : 'Shots', types: ['shot'] },
  ];
  const loadMoreProduction = async () => {
    setPageError(null);
    try {
      await onLoadMoreProduction();
    } catch (cause) {
      setPageError(
        cause instanceof Error
          ? cause.message
          : locale === 'zh-CN'
            ? '无法加载更多制作对象。'
            : 'More Production objects could not be loaded.',
      );
    }
  };
  return (
    <div className="target-workspace target-production-workspace">
      <header className="target-surface-heading">
        <div>
          <h2>{targetCopy(locale, 'production')}</h2>
          <p>
            {locale === 'zh-CN'
              ? '影片的创意事实、结构和来源'
              : 'Creative truth, shot structure, and provenance'}
          </p>
        </div>
      </header>
      {data.production.length === 0 ? (
        <div className="target-workspace-empty">
          <Clapperboard size={24} />
          <strong>
            {locale === 'zh-CN' ? '从证据建立制作结构' : 'Build only the structure the film needs'}
          </strong>
          <span>{targetCopy(locale, 'noWorkspaceData')}</span>
        </div>
      ) : (
        groups.map((group) => {
          const objects = data.production.filter((view) => group.types.includes(view.object.type));
          if (objects.length === 0) return null;
          return (
            <section className="target-production-section" key={group.key}>
              <header>
                <h3>{group.label}</h3>
                <span>{objects.length}</span>
              </header>
              {objects.map((view) => {
                const ref = refForProduction(view);
                const object = view.object;
                const description =
                  'description' in object.content
                    ? object.content.description
                    : 'summary' in object.content
                      ? object.content.summary
                      : 'premise' in object.content
                        ? object.content.premise
                        : '';
                return (
                  <button
                    key={object.id}
                    type="button"
                    className={selected(selection, ref) ? 'is-selected' : ''}
                    onClick={() => onSelect(ref)}
                    aria-label={`${locale === 'zh-CN' ? '选择' : 'Select'} ${productionLabel(view)}`}
                  >
                    <span className="target-object-icon">
                      {object.type === 'shot' ? <Clapperboard size={16} /> : <Box size={16} />}
                    </span>
                    <span>
                      <strong>{productionLabel(view)}</strong>
                      <small>{description}</small>
                    </span>
                    <em>{object.type.replaceAll('_', ' ')}</em>
                  </button>
                );
              })}
            </section>
          );
        })
      )}
      {data.productionNextCursor !== null && (
        <div className="target-workspace-pager">
          <button
            type="button"
            disabled={productionPagePending}
            onClick={() => void loadMoreProduction()}
          >
            {productionPagePending
              ? locale === 'zh-CN'
                ? '正在加载…'
                : 'Loading…'
              : locale === 'zh-CN'
                ? '加载更多制作对象'
                : 'Load more Production'}
          </button>
          {pageError !== null && (
            <p className="target-inline-error" role="alert">
              {pageError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function amountLabel(amount: {
  readonly state: 'known' | 'estimated' | 'unknown';
  readonly value?: string | number;
  readonly currency?: string;
}): string {
  if (amount.state === 'unknown') return '—';
  return amount.currency === undefined ? `${amount.value}` : `${amount.currency} ${amount.value}`;
}

function DeliveryOperationCard({
  operation,
  onCancel,
}: {
  readonly operation: TargetWorkspaceData['deliveryOperations'][number];
  readonly onCancel: (
    operation: TargetWorkspaceData['deliveryOperations'][number],
  ) => Promise<void>;
}) {
  const { locale } = useTargetEnvironment();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terminal = ['succeeded', 'failed', 'cancelled'].includes(operation.state);
  const reviewArtifact =
    operation.artifacts.find((artifact) => artifact.kind === 'review_cut') ?? null;
  const exportArtifact =
    operation.artifacts.find((artifact) => artifact.kind === 'delivery_export') ?? null;
  const cancel = async () => {
    if (terminal || operation.cancelRequested || cancelling) return;
    setCancelling(true);
    setError(null);
    try {
      await onCancel(operation);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : locale === 'zh-CN'
            ? '无法取消该交付操作。'
            : 'The Delivery operation could not be cancelled.',
      );
    } finally {
      setCancelling(false);
    }
  };
  const usage = operation.usage;
  const kind =
    operation.ref.kind === 'review_cut_attempt'
      ? locale === 'zh-CN'
        ? '审看片'
        : 'Review Cut'
      : locale === 'zh-CN'
        ? '交付导出'
        : 'Delivery Export';
  return (
    <article className="target-delivery-operation">
      <header>
        <span>
          <strong>{kind}</strong>
          <small>{operation.state.replaceAll('_', ' ')}</small>
        </span>
        {operation.progressPercent !== null && <em>{operation.progressPercent}%</em>}
      </header>
      {usage !== null && (
        <p>
          {locale === 'zh-CN' ? '用量' : 'Usage'} · {amountLabel(usage.inputTokens)} in ·{' '}
          {amountLabel(usage.outputTokens)} out · {amountLabel(usage.generatedUnits)} units ·{' '}
          {amountLabel(usage.cost)}
        </p>
      )}
      {operation.publicErrorCode !== null && (
        <p className="target-inline-error" role="alert">
          {operation.publicErrorCode.replaceAll('_', ' ')}
        </p>
      )}
      {operation.ref.kind === 'review_cut_attempt' && reviewArtifact !== null && (
        <p>
          {locale === 'zh-CN' ? '审看片成品' : 'Review Cut artifact'} · {reviewArtifact.id}
        </p>
      )}
      {operation.ref.kind === 'delivery_export' && (
        <p>
          {locale === 'zh-CN' ? '导出回执' : 'Export receipt'} · {operation.ref.ownerRef.id}
          {exportArtifact === null
            ? ''
            : ` · ${locale === 'zh-CN' ? '成品' : 'artifact'} ${exportArtifact.id}`}
        </p>
      )}
      {!terminal && (
        <button
          type="button"
          disabled={cancelling || operation.cancelRequested}
          onClick={() => void cancel()}
          aria-label={`${locale === 'zh-CN' ? '取消' : 'Cancel'} ${kind} ${operation.ref.id}`}
        >
          <CircleStop size={13} />
          {operation.cancelRequested
            ? locale === 'zh-CN'
              ? '已请求取消'
              : 'Cancellation requested'
            : cancelling
              ? locale === 'zh-CN'
                ? '正在取消…'
                : 'Cancelling…'
              : locale === 'zh-CN'
                ? '取消'
                : 'Cancel'}
        </button>
      )}
      {error !== null && (
        <p className="target-inline-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

function DeliveryWorkspace({
  data,
  selection,
  onSelect,
  onRequestCommander,
  onRequestDeliveryExport,
  onCancelOperation,
  deliveryPagePending,
  onLoadMoreDelivery,
}: Pick<
  ProjectWorkspaceProps,
  | 'data'
  | 'selection'
  | 'onSelect'
  | 'onRequestCommander'
  | 'onRequestDeliveryExport'
  | 'onCancelOperation'
  | 'deliveryPagePending'
  | 'onLoadMoreDelivery'
>) {
  const { locale } = useTargetEnvironment();
  const plans = data.delivery?.plans ?? [];
  const operations = data.deliveryOperations;
  const [requesting, setRequesting] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const requestCommander = async (key: string, text: string, ref: DomainObjectRef | null) => {
    if (requesting !== null) return;
    setRequesting(key);
    setRequestError(null);
    try {
      await onRequestCommander(text, ref);
    } catch (cause) {
      setRequestError(
        cause instanceof Error
          ? cause.message
          : locale === 'zh-CN'
            ? 'Commander 无法接受交付请求。'
            : 'Commander could not accept the Delivery request.',
      );
    } finally {
      setRequesting(null);
    }
  };
  const requestDeliveryExport = async (
    key: string,
    input: Parameters<ProjectWorkspaceProps['onRequestDeliveryExport']>[0],
  ) => {
    if (requesting !== null) return;
    setRequesting(key);
    setRequestError(null);
    try {
      await onRequestDeliveryExport(input);
    } catch (cause) {
      setRequestError(
        cause instanceof Error
          ? cause.message
          : locale === 'zh-CN'
            ? '无法选择导出目标位置。'
            : 'The export destination could not be selected.',
      );
    } finally {
      setRequesting(null);
    }
  };
  const loadMoreDelivery = async () => {
    setPageError(null);
    try {
      await onLoadMoreDelivery();
    } catch (cause) {
      setPageError(
        cause instanceof Error
          ? cause.message
          : locale === 'zh-CN'
            ? '无法加载更多交付计划。'
            : 'More Delivery plans could not be loaded.',
      );
    }
  };
  return (
    <div className="target-workspace target-delivery-workspace">
      <header className="target-surface-heading">
        <div>
          <h2>{targetCopy(locale, 'delivery')}</h2>
          <p>
            {locale === 'zh-CN'
              ? '排序、审看、检查并导出已选择的源素材'
              : 'Sequence, review, check, and export selected source media'}
          </p>
        </div>
      </header>
      {plans.length === 0 ? (
        <div className="target-workspace-empty">
          <Play size={25} />
          <strong>
            {locale === 'zh-CN'
              ? '交付由已选择的项目结果组装'
              : 'Delivery is assembled from selected Project results'}
          </strong>
          <span>
            {locale === 'zh-CN'
              ? '选择镜头结果后，可让 Commander 准备可逆的初始序列。'
              : 'Select Shot results, then ask Commander to prepare a reversible draft sequence.'}
          </span>
          <button
            type="button"
            disabled={requesting !== null}
            onClick={() =>
              void requestCommander(
                'draft',
                locale === 'zh-CN'
                  ? '请从已选择的镜头结果创建一个可逆的交付草稿，并准备审看片。列出缺失或无效的决定；未经明确确认不要导出。'
                  : 'Create a reversible draft Delivery plan from selected Shot results and prepare a Review Cut. List missing or invalid decisions, and do not export without explicit confirmation.',
                null,
              )
            }
          >
            {requesting === 'draft'
              ? locale === 'zh-CN'
                ? '正在请求…'
                : 'Requesting…'
              : locale === 'zh-CN'
                ? '准备审看片'
                : 'Prepare Review Cut'}
          </button>
        </div>
      ) : (
        plans.map((plan) => {
          const ref: DeliveryRef = {
            authority: 'delivery',
            id: plan.id,
            revision: plan.revision,
            contentHash: plan.contentHash,
          };
          const activeItems = plan.items
            .filter((item) => item.lifecycle === 'active')
            .sort((left, right) => left.order - right.order);
          const manifests = (data.delivery?.manifests ?? []).filter(
            (manifest) => manifest.sourcePlan.id === plan.id,
          );
          return (
            <section
              className={`target-delivery-plan${selected(selection, ref) ? ' is-selected' : ''}`}
              key={plan.id}
            >
              <header>
                <button type="button" onClick={() => onSelect(ref)}>
                  <strong>{plan.name}</strong>
                  <small>
                    {plan.formatIntent.width}×{plan.formatIntent.height} ·{' '}
                    {plan.formatIntent.frameRate} fps
                  </small>
                </button>
                <span>
                  {activeItems.length} {locale === 'zh-CN' ? '项' : 'items'}
                </span>
              </header>
              <div className="target-delivery-sequence">
                {activeItems.map((item) => (
                  <div key={item.id}>
                    <span>{String(item.order + 1).padStart(2, '0')}</span>
                    <Film size={16} />
                    <strong>{item.shot.id}</strong>
                    <small>
                      {item.trimStartMs}–{item.trimEndMs} ms · {item.audioPolicy}
                    </small>
                  </div>
                ))}
              </div>
              {manifests.length > 0 && (
                <div className="target-delivery-manifests">
                  {manifests.map((manifest) => (
                    <span key={manifest.id}>
                      <CheckCircle2 size={13} />
                      {locale === 'zh-CN' ? '冻结清单' : 'Frozen manifest'} ·{' '}
                      {manifest.items.length} {locale === 'zh-CN' ? '项' : 'items'} ·{' '}
                      {new Intl.DateTimeFormat(locale, {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date(manifest.frozenAt))}
                    </span>
                  ))}
                </div>
              )}
              <div className="target-delivery-actions">
                <button
                  type="button"
                  disabled={requesting !== null}
                  onClick={() =>
                    void requestCommander(
                      `review:${plan.id}`,
                      locale === 'zh-CN'
                        ? `请为交付计划“${plan.name}”准备审看片。使用当前权威计划修订，显示所有缺失或无效项目。`
                        : `Prepare a Review Cut for Delivery plan “${plan.name}”. Use the current authoritative plan revision and show every missing or invalid item.`,
                      ref,
                    )
                  }
                >
                  <Play size={13} />
                  {requesting === `review:${plan.id}`
                    ? locale === 'zh-CN'
                      ? '正在请求…'
                      : 'Requesting…'
                    : locale === 'zh-CN'
                      ? '通过 Commander 准备审看片'
                      : 'Prepare Review Cut via Commander'}
                </button>
                <button
                  type="button"
                  disabled={requesting !== null}
                  onClick={() =>
                    void requestDeliveryExport(`export:${plan.id}`, {
                      text:
                        locale === 'zh-CN'
                          ? `请将交付计划“${plan.name}”导出到此请求绑定的目标位置。先展示冻结清单和目标位置，在写入任何文件前要求与不可变输入严格绑定的明确确认。`
                          : `Export Delivery plan “${plan.name}” to the destination bound to this request. First present the frozen manifest and destination, then require explicit confirmation bound to the immutable input before writing any file.`,
                      context: ref,
                      suggestedFileName: `${plan.id}.${plan.formatIntent.container}`,
                      allowedExtensions: [plan.formatIntent.container],
                    })
                  }
                >
                  <ArrowRight size={13} />
                  {requesting === `export:${plan.id}`
                    ? locale === 'zh-CN'
                      ? '正在请求…'
                      : 'Requesting…'
                    : locale === 'zh-CN'
                      ? '选择目标并通过 Commander 导出'
                      : 'Choose destination & export'}
                </button>
              </div>
            </section>
          );
        })
      )}
      {data.delivery !== null && data.delivery.nextCursor !== null && (
        <div className="target-workspace-pager">
          <button
            type="button"
            disabled={deliveryPagePending}
            onClick={() => void loadMoreDelivery()}
          >
            {deliveryPagePending
              ? locale === 'zh-CN'
                ? '正在加载…'
                : 'Loading…'
              : locale === 'zh-CN'
                ? '加载更多交付计划'
                : 'Load more Delivery plans'}
          </button>
          {pageError !== null && (
            <p className="target-inline-error" role="alert">
              {pageError}
            </p>
          )}
        </div>
      )}
      {requestError !== null && (
        <p className="target-inline-error" role="alert">
          {requestError}
        </p>
      )}
      {operations.length > 0 && (
        <section
          className="target-delivery-operations"
          aria-label={locale === 'zh-CN' ? '交付操作' : 'Delivery operations'}
        >
          <h3>{locale === 'zh-CN' ? '交付操作' : 'Delivery operations'}</h3>
          {operations.map((operation) => (
            <DeliveryOperationCard
              key={operation.ref.id}
              operation={operation}
              onCancel={onCancelOperation}
            />
          ))}
        </section>
      )}
    </div>
  );
}

export function ProjectWorkspace(props: ProjectWorkspaceProps) {
  if (props.workspace === 'overview') return <OverviewWorkspace {...props} />;
  if (props.workspace === 'canvas') return <CanvasWorkspace {...props} />;
  if (props.workspace === 'media') return <MediaWorkspace {...props} />;
  if (props.workspace === 'production') return <ProductionWorkspace {...props} />;
  return <DeliveryWorkspace {...props} />;
}
