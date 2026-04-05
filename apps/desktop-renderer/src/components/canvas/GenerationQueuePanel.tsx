import { useSelector } from 'react-redux';
import { ListTodo, Loader2, CheckCircle2, XCircle, X } from 'lucide-react';
import { useDispatch } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { setRightPanel } from '../../store/slices/ui.js';
import { cn } from '../../lib/utils.js';
import { useI18n } from '../../hooks/use-i18n.js';

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

export function GenerationQueuePanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const canvas = useSelector((state: RootState) => {
    const id = state.canvas.activeCanvasId;
    return state.canvas.canvases.find((c) => c.id === id);
  });

  const generationNodes = (canvas?.nodes ?? [])
    .filter((n) => n.type === 'image' || n.type === 'video' || n.type === 'audio')
    .map((n) => {
      const data = n.data as { status?: string; progress?: number; error?: string; providerId?: string; jobId?: string };
      return {
        id: n.id,
        title: n.title || n.type,
        type: n.type,
        status: data.status ?? 'empty',
        progress: data.progress ?? 0,
        error: data.error,
        providerId: data.providerId,
      };
    })
    .filter((n) => n.status !== 'empty');

  const generating = generationNodes.filter((n) => n.status === 'generating');
  const completed = generationNodes.filter((n) => n.status === 'done');
  const failed = generationNodes.filter((n) => n.status === 'failed');

  return (
    <div className="h-full flex flex-col bg-card border-l overflow-auto">
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{t('toolbar.queue')}</span>
        </div>
        <button
          onClick={() => dispatch(setRightPanel(null))}
          className="p-1 rounded hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-2">
        {generating.length === 0 && completed.length === 0 && failed.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-8">
            {t('generation.noJobs')}
          </div>
        ) : null}

        {generating.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {t('generation.active')} ({generating.length})
            </div>
            {generating.map((node) => {
              const Icon = STATUS_ICON[node.status] ?? ListTodo;
              return (
                <div key={node.id} className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-2.5">
                  <div className="flex items-center gap-2">
                    <Icon className={cn('h-3.5 w-3.5 shrink-0', node.status === 'generating' && 'animate-spin', STATUS_COLOR[node.status])} />
                    <span className="flex-1 truncate text-xs font-medium">{node.title}</span>
                    <span className="text-[10px] text-muted-foreground">{node.progress}%</span>
                  </div>
                  {node.progress > 0 && (
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-blue-500 transition-all" style={{ width: `${node.progress}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {failed.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {t('generation.failed')} ({failed.length})
            </div>
            {failed.map((node) => (
              <div key={node.id} className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
                <div className="flex items-center gap-2">
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                  <span className="flex-1 truncate text-xs font-medium">{node.title}</span>
                </div>
                {node.error && (
                  <div className="mt-1 text-[10px] text-destructive truncate">{node.error}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {completed.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {t('generation.completed')} ({completed.length})
            </div>
            {completed.map((node) => (
              <div key={node.id} className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span className="flex-1 truncate text-xs font-medium">{node.title}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
