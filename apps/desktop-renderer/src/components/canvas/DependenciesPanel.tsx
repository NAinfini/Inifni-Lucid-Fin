import { useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { GitBranch } from 'lucide-react';
import type { RootState } from '../../store/index.js';
import { selectActiveCanvas, selectNodesById } from '../../store/slices/canvas/canvas-selectors.js';
import { setSelection } from '../../store/slices/canvas/canvas.js';
import { setHoveredDependencyNodeId } from '../../store/slices/ui.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { EmptyState } from '../ui/EmptyState.js';

export function DependenciesPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const selectedNodeIds = useSelector((state: RootState) => state.canvas.selectedNodeIds);
  const activeCanvas = useSelector(selectActiveCanvas) ?? null;
  const nodesById = useSelector(selectNodesById);

  const { upstream, downstream } = useMemo(() => {
    if (!activeCanvas) return { upstream: [] as string[], downstream: [] as string[] };
    const selected = selectedNodeIds[0];
    if (!selected) return { upstream: [], downstream: [] };

    const upstreamIds = new Set<string>();
    const downstreamIds = new Set<string>();
    for (const edge of activeCanvas.edges) {
      if (edge.target === selected && edge.source !== selected) upstreamIds.add(edge.source);
      if (edge.source === selected && edge.target !== selected) downstreamIds.add(edge.target);
    }

    return { upstream: [...upstreamIds], downstream: [...downstreamIds] };
  }, [activeCanvas, selectedNodeIds]);

  const nodeLabel = (id: string) => {
    const node = nodesById.get(id);
    return node ? node.title || node.type : id;
  };

  const nodeTypeLabel = (id: string) => {
    const type = nodesById.get(id)?.type;
    return type ? t('node.' + type) : undefined;
  };

  const handleSelectNode = (id: string) => {
    dispatch(setSelection({ nodeIds: [id], edgeIds: [] }));
  };

  const handleMouseEnter = (id: string) => {
    dispatch(setHoveredDependencyNodeId(id));
  };

  const handleMouseLeave = () => {
    dispatch(setHoveredDependencyNodeId(null));
  };

  const hasSelection = selectedNodeIds.length > 0;

  return (
    <div className="h-full bg-card border-l border-border/60 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
        <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{t('dependencies.title')}</span>
      </div>

      {!hasSelection ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState icon={GitBranch} title={t('dependencies.selectNode')} />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
          <div>
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              {t('dependencies.upstream')} ({upstream.length})
            </div>
            {upstream.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">
                {t('dependencies.noUpstream')}
              </div>
            ) : (
              <div className="space-y-1">
                {upstream.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSelectNode(id)}
                    onMouseEnter={() => handleMouseEnter(id)}
                    onMouseLeave={handleMouseLeave}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/50 text-xs hover:bg-amber-500/10 hover:text-amber-300 transition-colors text-left"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    <span className="truncate">{nodeLabel(id)}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {nodeTypeLabel(id)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">
              {t('dependencies.downstream')} ({downstream.length})
            </div>
            {downstream.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">
                {t('dependencies.noDownstream')}
              </div>
            ) : (
              <div className="space-y-1">
                {downstream.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSelectNode(id)}
                    onMouseEnter={() => handleMouseEnter(id)}
                    onMouseLeave={handleMouseLeave}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/50 text-xs hover:bg-sky-500/10 hover:text-sky-300 transition-colors text-left"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                    <span className="truncate">{nodeLabel(id)}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {nodeTypeLabel(id)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
