import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Download, Film, FileCode, Package, Play, Loader2 } from 'lucide-react';
import type { WorkflowExportExecution, WorkflowFinalExportContext } from '@lucid-fin/contracts';
import type { AppDispatch, RootState } from '../store/index.js';
import { addLog } from '../store/slices/logger.js';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';

type ExportTab = 'render' | 'nle' | 'assets';
type NLEFormat = 'fcpxml' | 'edl';

const VIDEO_FORMATS = [
  { id: 'h264', labelKey: 'export.formatOptions.h264', ext: '.mp4' },
  { id: 'h265', labelKey: 'export.formatOptions.h265', ext: '.mp4' },
  { id: 'prores', labelKey: 'export.formatOptions.prores', ext: '.mov' },
];

const RESOLUTIONS = [
  { id: '1080p', labelKey: 'export.resolutionOptions.1080p', width: 1920, height: 1080 },
  { id: '4k', labelKey: 'export.resolutionOptions.4k', width: 3840, height: 2160 },
  { id: '720p', labelKey: 'export.resolutionOptions.720p', width: 1280, height: 720 },
];

const FPS_OPTIONS = [24, 25, 30, 60];
const RENDER_STATUS_POLL_INTERVAL_MS = 1000;
const MAX_RENDER_STATUS_POLLS = 600;

type RenderStage =
  'queued' | 'rendering' | 'completed' | 'failed' | 'cancelled' | 'recovery_required';

function clampRenderProgress(value: number): number {
  return Math.max(0, Math.min(99, Math.round(value)));
}

function normalizeRenderStage(stage: string): RenderStage {
  switch (stage) {
    case 'queued':
    case 'rendering':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return stage;
    default:
      return 'recovery_required';
  }
}

function renderStageLabel(stage: RenderStage): string {
  switch (stage) {
    case 'queued':
      return t('export.queued');
    case 'rendering':
      return t('export.rendering');
    case 'completed':
      return t('export.completed');
    case 'failed':
      return t('export.failed');
    case 'cancelled':
      return t('export.cancelled');
    case 'recovery_required':
      return t('export.recoveryRequired');
  }
}

function requireRenderJobId(jobId: string | undefined): string {
  if (!jobId) throw new Error(t('export.recoveryRequiredHint'));
  return jobId;
}

function getMatchingFinalExportExecution(
  context: WorkflowFinalExportContext,
): WorkflowExportExecution | undefined {
  const execution = context.execution;
  if (!execution) return undefined;
  return execution.manifestRevision === context.manifest.revision &&
    execution.manifestHash === context.manifest.contentHash
    ? execution
    : undefined;
}

function getMaxRenderAttempts(context: WorkflowFinalExportContext): number | undefined {
  const maxRenderAttempts = context.manifest.content?.maxRenderAttempts;
  return typeof maxRenderAttempts === 'number' &&
    Number.isInteger(maxRenderAttempts) &&
    maxRenderAttempts > 0
    ? maxRenderAttempts
    : undefined;
}

function isRetryableFinalExportExecution(execution: WorkflowExportExecution): boolean {
  return (
    execution.status === 'failed' ||
    execution.status === 'cancelled' ||
    execution.status === 'recovery_required'
  );
}

function isRunningFinalExportExecution(execution: WorkflowExportExecution): boolean {
  return (
    execution.status === 'queued' ||
    execution.status === 'running' ||
    execution.status === 'ready_to_publish'
  );
}

function renderStageForFinalExportExecution(execution: WorkflowExportExecution): RenderStage {
  switch (execution.status) {
    case 'queued':
      return 'queued';
    case 'running':
    case 'ready_to_publish':
      return 'rendering';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'recovery_required':
      return 'recovery_required';
  }
}

function renderProgressForFinalExportExecution(execution: WorkflowExportExecution): number {
  if (execution.status === 'completed') return 100;
  if (execution.status === 'ready_to_publish') return 90;
  return 0;
}

function executionStatusForRenderStage(
  stage: RenderStage,
): WorkflowExportExecution['status'] | undefined {
  switch (stage) {
    case 'queued':
      return 'queued';
    case 'rendering':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'recovery_required':
      return 'recovery_required';
  }
}

export function ExportEngine() {
  const dispatch = useDispatch<AppDispatch>();
  const activeCanvas = useSelector((state: RootState) => {
    const id = state.canvas.activeCanvasId;
    return id ? state.canvas.canvases.entities[id] : undefined;
  });
  const [activeTab, setActiveTab] = useState<ExportTab>('render');
  const [format, setFormat] = useState<'h264' | 'h265' | 'prores'>('h264');
  const [resolution, setResolution] = useState('1080p');
  const [fps, setFps] = useState(30);
  const [nleFormat, setNleFormat] = useState<NLEFormat>('fcpxml');
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [renderJobId, setRenderJobId] = useState<string | null>(null);
  const [renderStage, setRenderStage] = useState<RenderStage | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [pollingRenderStatus, setPollingRenderStatus] = useState(false);
  const [cancellingRender, setCancellingRender] = useState(false);
  const [finalExportContext, setFinalExportContext] = useState<WorkflowFinalExportContext | null>(
    null,
  );
  const mountedRef = useRef(true);
  const progressRef = useRef(0);

  const NLE_FORMATS: Array<{ id: NLEFormat; labelKey: string; ext: string }> = [
    { id: 'fcpxml', labelKey: 'export.fcpxml', ext: '.fcpxml' },
    { id: 'edl', labelKey: 'export.edl', ext: '.edl' },
  ];

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const updateRenderProgress = useCallback((value: number) => {
    progressRef.current = value;
    setProgress(value);
  }, []);

  const restoreMatchingFinalExportExecution = useCallback(
    (context: WorkflowFinalExportContext): boolean => {
      setFinalExportContext(context);
      const execution = getMatchingFinalExportExecution(context);
      if (!execution) return false;

      const stage = renderStageForFinalExportExecution(execution);
      setRenderJobId(execution.id);
      setRenderStage(stage);
      updateRenderProgress(renderProgressForFinalExportExecution(execution));
      setRenderError(
        execution.error ??
          (stage === 'recovery_required' ? t('export.recoveryRequiredHint') : null),
      );
      const isRunning = isRunningFinalExportExecution(execution);
      setExporting(isRunning);
      setPollingRenderStatus(isRunning);
      return true;
    },
    [updateRenderProgress],
  );

  const updateMatchingFinalExportExecution = useCallback(
    (jobId: string, status: WorkflowExportExecution['status'], error?: string) => {
      setFinalExportContext((context) => {
        if (!context) return context;
        const execution = getMatchingFinalExportExecution(context);
        if (!execution || execution.id !== jobId) return context;
        return {
          ...context,
          execution: {
            ...execution,
            status,
            error,
          },
        };
      });
    },
    [],
  );

  const recordRenderError = useCallback(
    (message: string, stage: RenderStage) => {
      if (!mountedRef.current) return;
      setRenderError(message);
      setRenderStage(stage);
      setPollingRenderStatus(false);
      setExporting(false);
      dispatch(
        addLog({
          level: 'error',
          category: 'export',
          message: t('export.renderFailed'),
          detail: message,
        }),
      );
    },
    [dispatch],
  );

  useEffect(() => {
    let active = true;

    const loadCurrentFinalExport = async () => {
      if (!activeCanvas) {
        if (active) setFinalExportContext(null);
        return;
      }
      const api = getAPI();
      if (!api?.workflow) return;

      try {
        const workflows = await api.workflow.list({});
        const managedRun = workflows.find(
          (run) =>
            run.workflowType === 'movie.production.v2' &&
            run.entityType === 'canvas' &&
            run.entityId === activeCanvas.id &&
            run.status !== 'cancelled' &&
            run.status !== 'dead',
        );
        if (!managedRun) {
          if (active) setFinalExportContext(null);
          return;
        }

        const context = await api.workflow.getFinalExport(managedRun.id);
        if (!active) return;
        if (!context) {
          setFinalExportContext(null);
          return;
        }
        restoreMatchingFinalExportExecution(context);
      } catch {
        // Rendering still verifies the Final Export context before it starts.
      }
    };

    void loadCurrentFinalExport();
    return () => {
      active = false;
    };
  }, [activeCanvas, restoreMatchingFinalExportExecution]);

  useEffect(() => {
    if (!renderJobId || !pollingRenderStatus) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let remainingPolls = MAX_RENDER_STATUS_POLLS;

    const finish = (stage: RenderStage, nextProgress: number, error?: string) => {
      if (cancelled || !mountedRef.current) return;
      const executionStatus = executionStatusForRenderStage(stage);
      if (executionStatus) {
        updateMatchingFinalExportExecution(renderJobId, executionStatus, error);
      }
      setRenderStage(stage);
      updateRenderProgress(nextProgress);
      setPollingRenderStatus(false);
      setExporting(false);
      if (error) {
        setRenderError(error);
        dispatch(
          addLog({
            level: 'error',
            category: 'export',
            message: t('export.renderFailed'),
            detail: error,
          }),
        );
      }
    };

    const poll = async () => {
      if (cancelled || !mountedRef.current) return;
      if (remainingPolls <= 0) {
        finish('recovery_required', progressRef.current, t('export.recoveryRequiredHint'));
        return;
      }
      remainingPolls -= 1;

      try {
        const api = getAPI();
        if (!api?.render?.status) {
          finish('recovery_required', progressRef.current, t('export.recoveryRequiredHint'));
          return;
        }

        const status = await api.render.status(renderJobId);
        if (cancelled || !mountedRef.current) return;

        const stage = normalizeRenderStage(status.stage);
        const nextProgress = stage === 'completed' ? 100 : clampRenderProgress(status.progress);
        if (stage === 'completed') {
          finish(stage, nextProgress);
          return;
        }
        if (stage === 'failed') {
          finish(stage, nextProgress, status.error ?? t('export.renderFailed'));
          return;
        }
        if (stage === 'cancelled') {
          finish(stage, nextProgress);
          return;
        }
        if (stage === 'recovery_required') {
          finish(stage, nextProgress, status.error ?? t('export.recoveryRequiredHint'));
          return;
        }

        setRenderStage(stage);
        updateRenderProgress(nextProgress);
        timer = setTimeout(() => {
          void poll();
        }, RENDER_STATUS_POLL_INTERVAL_MS);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        finish('recovery_required', progressRef.current, message);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    dispatch,
    pollingRenderStatus,
    renderJobId,
    updateMatchingFinalExportExecution,
    updateRenderProgress,
  ]);

  const startRender = useCallback(
    async (retry: boolean) => {
      setExporting(true);
      updateRenderProgress(0);
      setRenderJobId(null);
      setRenderStage('queued');
      setRenderError(null);
      setPollingRenderStatus(false);
      try {
        const api = getAPI();
        if (!api) throw new Error(t('export.recoveryRequiredHint'));
        if (!activeCanvas) throw new Error('Select a canvas before rendering');
        const res = RESOLUTIONS.find((r) => r.id === resolution);
        const outputFormat = format === 'prores' ? ('mov' as const) : ('mp4' as const);
        const workflows = await api.workflow.list({});
        const managedRun = workflows.find(
          (run) =>
            run.workflowType === 'movie.production.v2' &&
            run.entityType === 'canvas' &&
            run.entityId === activeCanvas.id &&
            run.status !== 'cancelled' &&
            run.status !== 'dead',
        );
        let startedJobId: string;
        if (managedRun) {
          const finalExport = await api.workflow.getFinalExport(managedRun.id);
          if (!finalExport) {
            throw new Error('The AI must prepare the Final Export manifest before rendering');
          }
          if (finalExport.approval.status !== 'approved') {
            throw new Error('Approve the exact Final Export manifest in the workflow drawer first');
          }
          const matchingExecution = getMatchingFinalExportExecution(finalExport);
          if (matchingExecution) {
            if (
              isRunningFinalExportExecution(matchingExecution) ||
              matchingExecution.status === 'completed'
            ) {
              restoreMatchingFinalExportExecution(finalExport);
              return;
            }
            if (!isRetryableFinalExportExecution(matchingExecution)) {
              throw new Error(t('export.recoveryRequiredHint'));
            }
            const maxRenderAttempts = getMaxRenderAttempts(finalExport);
            if (!retry) {
              restoreMatchingFinalExportExecution(finalExport);
              throw new Error(t('export.retryRequired'));
            }
            if (!maxRenderAttempts || matchingExecution.attempt >= maxRenderAttempts) {
              restoreMatchingFinalExportExecution(finalExport);
              throw new Error(t('export.retryBudgetExhausted'));
            }
          } else if (retry) {
            throw new Error(t('export.retryRequired'));
          }
          const execution = await api.render.start({
            sceneId: activeCanvas.id,
            workflowRunId: managedRun.id,
            expectedManifestRevision: finalExport.manifest.revision,
            expectedManifestHash: finalExport.manifest.contentHash,
            ...(retry ? { retry: true } : {}),
          });
          startedJobId = requireRenderJobId(execution.jobId);

          try {
            const refreshedContext = await api.workflow.getFinalExport(managedRun.id);
            if (refreshedContext && restoreMatchingFinalExportExecution(refreshedContext)) {
              return;
            }
          } catch {
            // The successful start result is still enough to begin status polling.
          }
          setFinalExportContext(finalExport);
        } else {
          if (retry) throw new Error(t('export.retryRequired'));
          const execution = await api.render.start({
            sceneId: activeCanvas.id,
            outputFormat,
            codec: format,
            resolution: { width: res?.width ?? 1920, height: res?.height ?? 1080 },
            fps,
          });
          startedJobId = requireRenderJobId(execution.jobId);
        }
        if (!mountedRef.current) return;
        setRenderJobId(startedJobId);
        setRenderStage('queued');
        setPollingRenderStatus(true);
      } catch (err) {
        const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
        recordRenderError(message, 'failed');
      }
    },
    [
      activeCanvas,
      format,
      fps,
      recordRenderError,
      resolution,
      restoreMatchingFinalExportExecution,
      updateRenderProgress,
    ],
  );

  const handleRender = useCallback(() => {
    void startRender(false);
  }, [startRender]);

  const handleRetryRender = useCallback(() => {
    void startRender(true);
  }, [startRender]);

  const handleCancelRender = useCallback(async () => {
    if (!renderJobId) return;
    setCancellingRender(true);
    setPollingRenderStatus(false);
    try {
      const api = getAPI();
      if (!api?.render?.cancel) throw new Error(t('export.recoveryRequiredHint'));
      await api.render.cancel(renderJobId);
      if (!mountedRef.current) return;
      updateMatchingFinalExportExecution(renderJobId, 'cancelled');
      setRenderStage('cancelled');
      setExporting(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordRenderError(message, 'recovery_required');
    } finally {
      if (mountedRef.current) {
        setCancellingRender(false);
      }
    }
  }, [recordRenderError, renderJobId, updateMatchingFinalExportExecution]);

  const handleNleExport = useCallback(async () => {
    setExporting(true);
    try {
      const api = getAPI();
      if (!api) return;
      if (!activeCanvas) throw new Error('Select a canvas before exporting');
      const videoAssets = await api.asset.query({ type: 'video' });
      const assetsByHash = new Map(videoAssets.map((asset) => [asset.hash, asset]));
      const res = RESOLUTIONS.find((entry) => entry.id === resolution);
      const clips: Array<Record<string, unknown>> = [];
      let startTime = 0;
      const videoNodes = activeCanvas.nodes
        .filter((node) => node.type === 'video' && !node.bypassed)
        .sort(
          (left, right) =>
            left.position.x - right.position.x ||
            left.position.y - right.position.y ||
            left.id.localeCompare(right.id),
        );
      for (const node of videoNodes) {
        const data = node.data as {
          assetHash?: string;
          variants?: string[];
          selectedVariantIndex?: number;
          duration?: number;
          durationOverride?: number;
          sceneNumber?: string;
          shotOrder?: number;
        };
        const selectedIndex = Number.isInteger(data.selectedVariantIndex)
          ? (data.selectedVariantIndex ?? 0)
          : 0;
        const hash = data.variants?.[selectedIndex] ?? data.assetHash;
        const asset = hash ? assetsByHash.get(hash) : undefined;
        if (!hash || !asset) throw new Error(`Video node "${node.title}" has no indexed asset`);
        const duration = data.durationOverride ?? asset.duration ?? data.duration;
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
          throw new Error(`Video node "${node.title}" has no valid duration`);
        }
        const assetPath = await api.asset.getPath(hash, 'video', asset.format);
        clips.push({
          id: node.id,
          trackIndex: 0,
          trackType: 'video',
          assetPath,
          startTime,
          duration,
          inPoint: 0,
          outPoint: duration,
          speed: 1,
          title: node.title,
          sceneNumber: data.sceneNumber,
          shotOrder: data.shotOrder,
        });
        startTime += duration;
      }
      if (clips.length === 0) throw new Error('The active canvas has no video clips to export');
      await api.export.nle({
        format: nleFormat,
        canvasId: activeCanvas.id,
        project: {
          name: activeCanvas.name,
          fps,
          width: res?.width ?? 1920,
          height: res?.height ?? 1080,
          clips,
        },
      });
    } catch (err) {
      dispatch(
        addLog({
          level: 'error',
          category: 'export',
          message: t('export.nleFailed'),
          detail: err instanceof Error ? (err.stack ?? err.message) : String(err),
        }),
      );
    } finally {
      setExporting(false);
    }
  }, [activeCanvas, dispatch, fps, nleFormat, resolution]);

  const handleAssetPack = useCallback(async () => {
    setExporting(true);
    try {
      const api = getAPI();
      if (!api) return;
      if (!activeCanvas) throw new Error('Select a canvas before exporting');
      // Collect all asset hashes from the active canvas
      const hashes: string[] = [];
      for (const node of activeCanvas?.nodes ?? []) {
        const data = node.data as { assetHash?: string; variants?: string[] };
        if (data.assetHash) hashes.push(data.assetHash);
        if (Array.isArray(data.variants)) {
          for (const v of data.variants) {
            if (v && !hashes.includes(v)) hashes.push(v);
          }
        }
      }
      if (hashes.length === 0) return;
      await api.export.assetBundle(hashes, undefined, activeCanvas.id);
    } catch (err) {
      dispatch(
        addLog({
          level: 'error',
          category: 'export',
          message: t('export.assetPackFailed'),
          detail: err instanceof Error ? (err.stack ?? err.message) : String(err),
        }),
      );
    } finally {
      setExporting(false);
    }
  }, [activeCanvas, dispatch]);

  const tabs = [
    { key: 'render' as const, icon: Film, label: t('export.render') },
    { key: 'nle' as const, icon: FileCode, label: t('export.nle') },
    { key: 'assets' as const, icon: Package, label: t('export.assets') },
  ];
  const matchingFinalExportExecution = finalExportContext
    ? getMatchingFinalExportExecution(finalExportContext)
    : undefined;
  const maxRenderAttempts = finalExportContext
    ? getMaxRenderAttempts(finalExportContext)
    : undefined;
  const retryableExecution =
    matchingFinalExportExecution && isRetryableFinalExportExecution(matchingFinalExportExecution)
      ? matchingFinalExportExecution
      : undefined;
  const canRetryFinalExport = Boolean(
    retryableExecution && maxRenderAttempts && retryableExecution.attempt < maxRenderAttempts,
  );
  const retryBudgetExhausted = Boolean(
    retryableExecution && (!maxRenderAttempts || retryableExecution.attempt >= maxRenderAttempts),
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/60 bg-card">
        <Download className="w-3.5 h-3.5 text-primary" />
        <span className="text-xs font-medium">{t('export.title')}</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border/60 bg-card">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3 h-3" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'render' && (
          <div className="max-w-lg space-y-4">
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1">
                {t('export.format')}
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {VIDEO_FORMATS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id as 'h264' | 'h265' | 'prores')}
                    className={`px-2.5 py-1.5 text-xs rounded-md border border-border/60 ${format === f.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                  >
                    {t(f.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[10px] text-muted-foreground mb-1">
                {t('export.resolution')}
              </label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="w-full px-2 py-1 text-xs rounded-md border border-border/60 bg-background"
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {t(r.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] text-muted-foreground mb-1">
                {t('export.fps')}
              </label>
              <div className="flex gap-1.5">
                {FPS_OPTIONS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFps(f)}
                    className={`px-2.5 py-1 text-xs rounded-md border border-border/60 ${fps === f ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                  >
                    {f}fps
                  </button>
                ))}
              </div>
            </div>

            {renderJobId && renderStage && (
              <section
                role="status"
                className="space-y-2 rounded-md border border-border/70 bg-card/70 p-3 text-xs"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">{t('export.renderStatus')}</span>
                  <span className="text-muted-foreground">{renderStageLabel(renderStage)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-muted-foreground">
                  <span>{t('export.renderJob')}</span>
                  <code className="max-w-[14rem] truncate text-[10px] text-foreground">
                    {renderJobId}
                  </code>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <progress
                    aria-label={t('export.renderStatus')}
                    value={progress}
                    max={100}
                    className="h-2 flex-1 accent-primary"
                  />
                  <span className="w-9 text-right tabular-nums">{progress}%</span>
                </div>
                {renderError && (
                  <div
                    role="alert"
                    className="rounded border border-red-400/30 bg-red-500/10 px-2.5 py-2 text-red-200"
                  >
                    {renderError}
                  </div>
                )}
                {exporting && (
                  <button
                    type="button"
                    onClick={() => void handleCancelRender()}
                    disabled={cancellingRender}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-60"
                  >
                    {cancellingRender && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {cancellingRender ? t('export.cancellingRender') : t('export.cancelRender')}
                  </button>
                )}
                {retryableExecution && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">
                      {t('export.renderAttempt')} {retryableExecution.attempt}/
                      {maxRenderAttempts ?? '?'}
                    </span>
                    <button
                      type="button"
                      onClick={handleRetryRender}
                      disabled={!canRetryFinalExport || exporting || cancellingRender}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md border border-primary/60 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <Play className="h-3.5 w-3.5" />
                      {canRetryFinalExport
                        ? t('export.retryFinalExport')
                        : retryBudgetExhausted
                          ? t('export.retryBudgetExhausted')
                          : t('export.retryRequired')}
                    </button>
                  </div>
                )}
              </section>
            )}

            {!renderJobId && renderError && (
              <div
                role="alert"
                className="rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
              >
                {renderError}
              </div>
            )}

            <button
              onClick={handleRender}
              disabled={exporting || cancellingRender || Boolean(matchingFinalExportExecution)}
              className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {t('export.startRender')}
            </button>
          </div>
        )}

        {activeTab === 'nle' && (
          <div className="max-w-lg space-y-4">
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1">
                {t('export.nleFormat')}
              </label>
              <div className="space-y-1.5">
                {NLE_FORMATS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setNleFormat(f.id)}
                    className={`flex items-center gap-1.5 w-full px-2.5 py-1.5 text-xs rounded-md border border-border/60 text-left ${nleFormat === f.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    {t(f.labelKey)}
                    <span className="text-[10px] text-muted-foreground ml-auto">{f.ext}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleNleExport}
              disabled={exporting}
              className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              {t('export.exportNle')}
            </button>
          </div>
        )}

        {activeTab === 'assets' && (
          <div className="max-w-lg space-y-4">
            <div className="p-4 rounded-md border-2 border-dashed border-border/60 text-center">
              <Package className="w-10 h-10 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">{t('export.assetPackDescription')}</p>
            </div>

            <button
              onClick={handleAssetPack}
              disabled={exporting}
              className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Package className="w-3.5 h-3.5" />
              )}
              {t('export.exportAssetPack')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
