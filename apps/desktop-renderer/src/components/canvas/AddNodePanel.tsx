import type { ComponentType } from 'react';
import { FileText, Image, LayoutTemplate, Video, Volume2 } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { useReactFlow } from '@xyflow/react';
import type { CanvasNodeType } from '@lucid-fin/contracts';
import type { RootState } from '../../store/index.js';
import { addNode } from '../../store/slices/canvas.js';
import { setActivePanel } from '../../store/slices/ui.js';
import { t } from '../../i18n.js';

const NODE_OPTIONS: Array<{
  type: CanvasNodeType;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { type: 'text', label: 'panels.textNode', icon: FileText },
  { type: 'image', label: 'panels.imageNode', icon: Image },
  { type: 'video', label: 'panels.videoNode', icon: Video },
  { type: 'audio', label: 'panels.audioNode', icon: Volume2 },
  { type: 'backdrop', label: 'panels.backdropNode', icon: LayoutTemplate },
];

export function AddNodePanel() {
  const dispatch = useDispatch();
  const { screenToFlowPosition } = useReactFlow();
  const activeCanvasId = useSelector((state: RootState) => state.canvas.activeCanvasId);

  const getCanvasCenter = () => {
    // Use the ReactFlow pane DOM element to find the true center of the canvas viewport.
    const pane = document.querySelector('.react-flow__pane') as HTMLElement | null;
    if (pane) {
      const rect = pane.getBoundingClientRect();
      return screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
    // Fallback if pane not found
    return screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  };

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{t('panels.addNode')}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t('panels.addNodeHint')}</p>
      </div>

      {!activeCanvasId ? (
        <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
          No canvas selected. Create or open a canvas first.
        </div>
      ) : (
        <div className="grid gap-3 p-4">
          {NODE_OPTIONS.map((option) => {
            const Icon = option.icon;
            const label = t(option.label);

            return (
              <button
                key={option.type}
                type="button"
                aria-label={label}
                onClick={() => {
                  dispatch(
                    addNode({
                      id: crypto.randomUUID(),
                      type: option.type,
                      title: t(`canvas.nodeType.${option.type}`),
                      position: getCanvasCenter(),
                    }),
                  );
                  dispatch(setActivePanel(null));
                }}
                className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/60"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t('panels.addNodeAction')}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
