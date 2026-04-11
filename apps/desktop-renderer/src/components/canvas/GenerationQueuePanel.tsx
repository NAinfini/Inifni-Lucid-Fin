import { useSelector } from 'react-redux';
import { ListTodo, Loader2, CheckCircle2, XCircle, X, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { useDispatch } from 'react-redux';
import { useEffect, useRef, useState } from 'react';
import type { RootState } from '../../store/index.js';
import { setRightPanel } from '../../store/slices/ui.js';
import { setNodeProgress, clearNodeGenerationStatus } from '../../store/slices/canvas.js';
import { cn } from '../../lib/utils.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { getAPI } from '../../utils/api.js';

const STATUS_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  empty: ListTodo,
  generating: Loader2,
  done: CheckCircle2,
  failed: XCircle,
};

const STATUS_COLOR: Record<string, string> = {
  empty: 'text-muted-foreground',
  generating: 'text-blue-400',
  done: 'text-emerald-400',
  failed: 'text-destructive',
};

const STATUS_LABEL_KEY: Record<string, string> = {
  idle: 'status.idle',
  queued: 'status.queued',
  generating: 'generation.generating',
  done: 'generation.completed',
  failed: 'generation.failed',
};

export function GenerationQueuePanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const canvas = useSelector((state: RootState) => {
    const id = state.canvas.activeCanvasId;
    return state.canvas.canvases.find((c) => c.id === id);
  });
  const activeCanvasId = canvas?.id;
  const settings = useSelector((state: RootState) => state.settings);
  const allProviders = [
    ...(settings.image?.providers ?? []),
    ...(settings.video?.providers ?? []),
    ...(settings.audio?.providers ?? []),
    ...(settings.llm?.providers ?? []),
  ];
  const resolveProviderName = (id?: string) => {
    if (!id) return undefined;
    return allProviders.find((p) => p.id === id)?.name ?? id;
  };

  // Listen for real-time progress updates from backend
  useEffect(() => {
    const api = getAPI();
    if (!api?.canvasGeneration || !activeCanvasId) return;

    const unsubscribe = api.canvasGeneration.onProgress((data) => {
      // Only update if the progress event is for the active canvas
      if (data.canvasId !== activeCanvasId) return;

      dispatch(setNodeProgress({
        id: data.nodeId,
        progress: data.progress,
        currentStep: data.currentStep
      }));
    });

    return unsubscribe;
  }, [activeCanvasId, dispatch]);

  const generationNodes = (canvas?.nodes ?? [])
    .filter((n) => n.type === 'image' || n.type === 'video' || n.type === 'audio')
    .map((n) => {
      const data = n.data as { status?: string; progress?: number; error?: string; providerId?: string; jobId?: string; currentStep?: string; estimatedCost?: number; cost?: number; generationTimeMs?: number };
      return {
        id: n.id,
        title: n.title || n.type,
        type: n.type,
        status: data.status ?? 'empty',
        progress: data.progress ?? 0,
        error: data.error,
        providerId: data.providerId,
        providerName: resolveProviderName(data.providerId),
        jobId: data.jobId,
        currentStep: data.currentStep,
        estimatedCost: data.estimatedCost,
        cost: data.cost,
        generationTimeMs: data.generationTimeMs,
      };
    })
    .filter((n) => n.status !== 'empty');

  const generating = generationNodes.filter((n) => n.status === 'generating');
  const completed = generationNodes.filter((n) => n.status === 'done');
  const failed = generationNodes.filter((n) => n.status === 'failed');

  const handleRemoveTask = async (nodeId: string, status: string) => {
    if (!canvas) return;

    if (status === 'generating') {
      // Cancel ongoing generation
      const api = getAPI();
      if (api?.canvasGeneration) {
        await api.canvasGeneration.cancel(canvas.id, nodeId);
      }
    } else {
      // Clear completed/failed status
      dispatch(clearNodeGenerationStatus({ id: nodeId }));
    }
  };

  return (
    <div className="h-full flex flex-col bg-card border-l border-border/60 overflow-auto">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-2">
          <ListTodo className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
          <span className="text-xs font-semibold">{t('toolbar.queue')}</span>
        </div>
        <button
          onClick={() => dispatch(setRightPanel(null))}
          className="p-0.5 rounded-md hover:bg-muted transition-colors"
          aria-label={t('generation.closeQueue')}
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>

      <div
        className="flex-1 overflow-auto p-2.5 space-y-2"
        aria-live="polite"
        aria-label={t('generation.queueStatus')}
      >
        {generating.length === 0 && completed.length === 0 && failed.length === 0 ? (
          <div className="text-[11px] text-muted-foreground text-center py-8">
            {t('generation.noJobs')}
          </div>
        ) : null}

        {generating.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {t('generation.active')} ({generating.length})
            </div>
            {generating.map((node) => (
              <TaskItem
                key={node.id}
                node={node}
                onRemove={handleRemoveTask}
              />
            ))}
          </div>
        )}

        {failed.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {t('generation.failed')} ({failed.length})
            </div>
            {failed.map((node) => (
              <TaskItem
                key={node.id}
                node={node}
                onRemove={handleRemoveTask}
              />
            ))}
          </div>
        )}

        {completed.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {t('generation.completed')} ({completed.length})
            </div>
            {completed.map((node) => (
              <TaskItem
                key={node.id}
                node={node}
                onRemove={handleRemoveTask}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatCost(value: number): string {
  return `$${value.toFixed(3)}`;
}

function TaskItem({
  node,
  onRemove,
}: {
  node: {
    id: string;
    title: string;
    type: string;
    status: string;
    progress: number;
    error?: string;
    providerId?: string;
    providerName?: string;
    jobId?: string;
    currentStep?: string;
    estimatedCost?: number;
    cost?: number;
    generationTimeMs?: number;
  };
  onRemove: (nodeId: string, status: string) => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startTimeRef = useRef<number | null>(null);

  // Elapsed timer for generating nodes
  useEffect(() => {
    if (node.status !== 'generating') {
      startTimeRef.current = null;
      setElapsed(0);
      return;
    }
    if (startTimeRef.current === null) {
      startTimeRef.current = Date.now();
    }
    const tick = () => {
      if (startTimeRef.current !== null) {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [node.status]);
  const Icon = STATUS_ICON[node.status] ?? ListTodo;
  const colorClass = STATUS_COLOR[node.status];
  const localizedNodeType =
    node.type === 'image' || node.type === 'video' || node.type === 'audio' || node.type === 'text'
      ? t(`canvas.nodeType.${node.type}`)
      : node.type;
  const localizedStatus = STATUS_LABEL_KEY[node.status]
    ? t(STATUS_LABEL_KEY[node.status])
    : t('generationQueue.unknown');

  const borderColor = node.status === 'generating'
    ? 'border-blue-500/30 bg-blue-500/5'
    : node.status === 'failed'
    ? 'border-destructive/30 bg-destructive/5'
    : 'border-emerald-500/30 bg-emerald-500/5';

  const removeLabel = node.status === 'generating'
    ? t('generation.cancel')
    : t('generation.remove');

  const expandLabel = expanded
    ? t('generation.collapse')
    : t('generation.expand');

  return (
    <div className={cn('rounded-md border p-2', borderColor)}>
      <div className="flex items-center gap-1.5">
        <Icon className={cn('h-3 w-3 shrink-0', node.status === 'generating' && 'animate-spin', colorClass)} aria-hidden="true" />
        <span className="flex-1 truncate text-[11px] font-medium">{node.title}</span>
        {node.status === 'generating' && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {node.progress}%{elapsed > 0 ? ` · ${formatElapsed(elapsed)}` : ''}
          </span>
        )}
        {(node.providerId || node.jobId) && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-0.5 rounded hover:bg-muted/50 transition-colors"
            aria-label={expandLabel}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
            )}
          </button>
        )}
        <button
          onClick={() => onRemove(node.id, node.status)}
          className="p-0.5 rounded hover:bg-destructive/20 transition-colors"
          aria-label={removeLabel}
        >
          <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
        </button>
      </div>

      {node.status === 'generating' && node.progress > 0 && (
        <div
          role="progressbar"
          aria-valuenow={node.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t('generation.progressLabel')}
          className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-blue-500 transition-all" style={{ width: `${node.progress}%` }} />
        </div>
      )}

      {node.status === 'generating' && node.currentStep && (
        <div className="mt-1 text-[10px] text-muted-foreground truncate">{node.currentStep}</div>
      )}

      {node.status === 'failed' && node.error && (
        <div className="mt-1 text-[10px] text-destructive truncate">{node.error}</div>
      )}

      {node.status === 'done' && (node.estimatedCost != null || node.cost != null) && (
        <div className="mt-1 text-[10px] text-muted-foreground font-mono">
          {node.estimatedCost != null && node.cost != null && node.estimatedCost !== node.cost
            ? `Est: ${formatCost(node.estimatedCost)} → Actual: ${formatCost(node.cost)}`
            : node.cost != null
            ? `Cost: ${formatCost(node.cost)}`
            : `Est: ${formatCost(node.estimatedCost!)}`}
        </div>
      )}

      {expanded && (
        <div className="mt-2 pt-2 border-t border-current/10 space-y-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">{t('generation.type')}:</span>
            <span className="font-mono">{localizedNodeType}</span>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">{t('generation.nodeId')}:</span>
            <span className="font-mono truncate max-w-[120px]" title={node.id}>{node.id.slice(0, 16)}...</span>
          </div>
          {node.providerId && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">{t('generation.provider')}:</span>
              <span className="font-mono">{node.providerName ?? node.providerId}</span>
            </div>
          )}
          {node.jobId && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">{t('generation.jobId')}:</span>
              <span className="font-mono truncate max-w-[120px]" title={node.jobId}>{node.jobId}</span>
            </div>
          )}
          {node.currentStep && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">{t('generation.currentStep')}:</span>
              <span className="font-mono">{node.currentStep}</span>
            </div>
          )}
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-muted-foreground">{t('generation.status')}:</span>
            <span className={cn('font-mono', STATUS_COLOR[node.status])}>{localizedStatus}</span>
          </div>
        </div>
      )}
    </div>
  );
}
