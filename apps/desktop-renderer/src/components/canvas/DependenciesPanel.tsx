import { useDispatch, useSelector } from 'react-redux';
import { GitBranch } from 'lucide-react';
import type { RootState } from '../../store/index.js';
import { setSelection } from '../../store/slices/canvas.js';
import { setHoveredDependencyNodeId } from '../../store/slices/ui.js';
import { useI18n } from '../../hooks/use-i18n.js';

export function DependenciesPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const { canvases, activeCanvasId, selectedNodeIds } = useSelector(
    (state: RootState) => state.canvas,
  );

  const activeCanvas = canvases.find((c) => c.id === activeCanvasId) ?? null;

  const buildDepMap = () => {
    if (!activeCanvas) return { upstream: [] as string[], downstream: [] as string[] };
    const selected = selectedNodeIds[0];
    if (!selected) return { upstream: [], downstream: [] };

    const upstream = activeCanvas.edges
      .filter((e) => e.target === selected)
      .map((e) => e.source);
    const downstream = activeCanvas.edges
      .filter((e) => e.source === selected)
      .map((e) => e.target);

    return { upstream, downstream };
  };

  const nodeLabel = (id: string) => {
    const node = activeCanvas?.nodes.find((n) => n.id === id);
    return node ? node.title || node.type : id;
  };

  const nodeTypeLabel = (id: string) => {
    const type = activeCanvas?.nodes.find((n) => n.id === id)?.type;
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

  const { upstream, downstream } = buildDepMap();
  const hasSelection = selectedNodeIds.length > 0;

  return (
    <div className="h-full bg-card border-l flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <GitBranch className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t('dependencies.title')}</span>
      </div>

      {!hasSelection ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground px-4 text-center">
          {t('dependencies.selectNode')}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {t('dependencies.upstream')} ({upstream.length})
            </div>
            {upstream.length === 0 ? (
              <div className="text-xs text-muted-foreground">{t('dependencies.noUpstream')}</div>
            ) : (
              <div className="space-y-1">
                {upstream.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSelectNode(id)}
                    onMouseEnter={() => handleMouseEnter(id)}
                    onMouseLeave={handleMouseLeave}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 text-sm hover:bg-amber-500/10 hover:text-amber-300 transition-colors text-left"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                    <span className="truncate">{nodeLabel(id)}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{nodeTypeLabel(id)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
              {t('dependencies.downstream')} ({downstream.length})
            </div>
            {downstream.length === 0 ? (
              <div className="text-xs text-muted-foreground">{t('dependencies.noDownstream')}</div>
            ) : (
              <div className="space-y-1">
                {downstream.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleSelectNode(id)}
                    onMouseEnter={() => handleMouseEnter(id)}
                    onMouseLeave={handleMouseLeave}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 text-sm hover:bg-sky-500/10 hover:text-sky-300 transition-colors text-left"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" />
                    <span className="truncate">{nodeLabel(id)}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{nodeTypeLabel(id)}</span>
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
