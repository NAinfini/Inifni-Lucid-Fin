import { lazy, Suspense, useCallback, useEffect, useRef } from 'react';
import { Layers, Plus } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '../store/index.js';
import { addCanvas, setActiveCanvas, setCanvases, setLoading } from '../store/slices/canvas.js';
import { selectAllCanvases, selectActiveCanvas } from '../store/slices/canvas-selectors.js';
import { toggleCommander } from '../store/slices/commander.js';
import { setPresets, setPresetsLoading } from '../store/slices/presets.js';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';
import { CanvasWorkspace } from '../components/canvas/CanvasWorkspace.js';
import { ErrorBoundary } from '../components/ErrorBoundary.js';
import { ReactFlowProvider } from '@xyflow/react';
import { LeftToolbar } from '../components/layout/LeftToolbar.js';
import { RightToolbar } from '../components/layout/RightToolbar.js';
import { addLog } from '../store/slices/logger.js';
import { enqueueToast } from '../store/slices/toast.js';
import { useClipboardWatcher } from '../hooks/useClipboardWatcher.js';

const AddNodePanel = lazy(() =>
  import('../components/canvas/AddNodePanel.js').then((m) => ({ default: m.AddNodePanel })),
);
const AssetBrowserPanel = lazy(() =>
  import('../components/canvas/AssetBrowserPanel.js').then((m) => ({
    default: m.AssetBrowserPanel,
  })),
);
const CanvasNavigatorPanel = lazy(() =>
  import('../components/canvas/CanvasNavigatorPanel.js').then((m) => ({
    default: m.CanvasNavigatorPanel,
  })),
);
const CanvasNotesPanel = lazy(() =>
  import('../components/canvas/CanvasNotesPanel.js').then((m) => ({ default: m.CanvasNotesPanel })),
);
const CharacterManagerPanel = lazy(() =>
  import('../components/canvas/CharacterManagerPanel.js').then((m) => ({
    default: m.CharacterManagerPanel,
  })),
);
const CommanderPanel = lazy(() =>
  import('../components/canvas/CommanderPanel.js').then((m) => ({ default: m.CommanderPanel })),
);
const DependenciesPanel = lazy(() =>
  import('../components/canvas/DependenciesPanel.js').then((m) => ({
    default: m.DependenciesPanel,
  })),
);
const EquipmentManagerPanel = lazy(() =>
  import('../components/canvas/EquipmentManagerPanel.js').then((m) => ({
    default: m.EquipmentManagerPanel,
  })),
);
const LocationManagerPanel = lazy(() =>
  import('../components/canvas/LocationManagerPanel.js').then((m) => ({
    default: m.LocationManagerPanel,
  })),
);
const ExportRenderPanel = lazy(() =>
  import('../components/canvas/ExportRenderPanel.js').then((m) => ({
    default: m.ExportRenderPanel,
  })),
);
const GenerationQueuePanel = lazy(() =>
  import('../components/canvas/GenerationQueuePanel.js').then((m) => ({
    default: m.GenerationQueuePanel,
  })),
);
const HistoryPanel = lazy(() =>
  import('../components/canvas/HistoryPanel.js').then((m) => ({ default: m.HistoryPanel })),
);
const InspectorPanel = lazy(() =>
  import('../components/canvas/InspectorPanel.js').then((m) => ({ default: m.InspectorPanel })),
);
const LoggerPanel = lazy(() =>
  import('../components/canvas/LoggerPanel.js').then((m) => ({ default: m.LoggerPanel })),
);
const PresetManagerPanel = lazy(() =>
  import('../components/canvas/PresetManagerPanel.js').then((m) => ({
    default: m.PresetManagerPanel,
  })),
);
const ShotTemplateManagerPanel = lazy(() =>
  import('../components/canvas/ShotTemplateManagerPanel.js').then((m) => ({
    default: m.ShotTemplateManagerPanel,
  })),
);

const MIN_PANEL_WIDTH = 200;
const MAX_PANEL_WIDTH = 500;

function DragHandle({
  side,
  panelRef,
  widthRef,
}: {
  side: 'left' | 'right';
  panelRef: React.RefObject<HTMLDivElement | null>;
  widthRef: React.MutableRefObject<number>;
}) {
  const lastX = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      lastX.current = e.clientX;
      let pendingWidth: number | null = null;
      let rafId = 0;

      const flush = () => {
        rafId = 0;
        if (pendingWidth === null) return;
        const w = pendingWidth;
        pendingWidth = null;
        widthRef.current = w;
        if (panelRef.current) panelRef.current.style.width = `${w}px`;
      };

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - lastX.current;
        lastX.current = ev.clientX;
        const signed = side === 'left' ? delta : -delta;
        const base = pendingWidth ?? widthRef.current;
        pendingWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, base + signed));
        if (!rafId) rafId = requestAnimationFrame(flush);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (rafId) cancelAnimationFrame(rafId);
        flush();
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [panelRef, side, widthRef],
  );

  return (
    <div
      onMouseDown={onMouseDown}
      className="w-[3px] shrink-0 cursor-col-resize bg-border/60 hover:bg-primary/30 active:bg-primary/50 transition-colors"
    />
  );
}

export function CanvasPage() {
  const dispatch = useDispatch<AppDispatch>();
  useClipboardWatcher();
  const leftWidthRef = useRef(380);
  const rightWidthRef = useRef(380);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const canvases = useSelector(selectAllCanvases);
  const activeCanvasId = useSelector((state: RootState) => state.canvas.activeCanvasId);
  const loading = useSelector((state: RootState) => state.canvas.loading);
  const activePanel = useSelector((state: RootState) => state.ui.activePanel);
  const rightPanel = useSelector((state: RootState) => state.ui.rightPanel);
  const commanderOpen = useSelector((state: RootState) => state.commander.open);
  const bootstrapped = useSelector((state: RootState) => state.settings.bootstrapped);

  const activeCanvas = useSelector(selectActiveCanvas) ?? null;

  useEffect(() => {
    if (!bootstrapped) return;
    if (canvases.length > 0) {
      return;
    }

    let cancelled = false;

    const loadCanvases = async () => {
      dispatch(setLoading(true));
      try {
        const api = getAPI();
        if (!api) return;
        const listed = await api?.canvas.list();
        if (!Array.isArray(listed)) return;

        const loaded = await Promise.all(listed.map((item) => api.canvas.load(item.id)));

        if (cancelled) return;
        dispatch(setCanvases(loaded));
        if (!activeCanvasId && loaded.length > 0) {
          dispatch(setActiveCanvas(loaded[0].id));
        }
      } catch (err) {
        if (!cancelled) {
          dispatch(
            addLog({
              level: 'error',
              category: 'canvas',
              message: t('toast.error.canvasLoadFailed'),
              detail: err instanceof Error ? (err.stack ?? err.message) : String(err),
            }),
          );
          dispatch(
            enqueueToast({
              variant: 'error',
              title: t('toast.error.canvasLoadFailed'),
              message: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      } finally {
        if (!cancelled) {
          dispatch(setLoading(false));
        }
      }
    };

    void loadCanvases();

    return () => {
      cancelled = true;
    };
  }, [activeCanvasId, canvases.length, dispatch, bootstrapped]);

  useEffect(() => {
    if (!bootstrapped) return;
    const loadPresets = async () => {
      dispatch(setPresetsLoading(true));
      try {
        const presets = await getAPI()?.preset.list();
        if (presets) {
          dispatch(setPresets(presets));
        }
      } finally {
        dispatch(setPresetsLoading(false));
      }
    };

    void loadPresets();
  }, [dispatch, bootstrapped]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        dispatch(toggleCommander());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch]);

  useEffect(() => {
    const api = getAPI();
    if (!api?.logger || !api.onReady) return;

    const seenIds = new Set<string>();
    const pushEntry = (entry: {
      id: string;
      level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
      category: string;
      message: string;
      detail?: string;
    }) => {
      if (seenIds.has(entry.id)) return;
      seenIds.add(entry.id);
      dispatch(
        addLog({
          level: entry.level === 'fatal' ? 'error' : entry.level,
          category: entry.category,
          message: entry.message,
          detail: entry.detail,
        }),
      );
    };

    const unsubscribeEntry = api.logger.onEntry((entry) => {
      pushEntry(entry);
    });

    const unsubscribeReady = api.onReady(() => {
      void api.logger
        .getRecent()
        .then((entries) => {
          for (const entry of entries) {
            pushEntry(entry);
          }
        })
        .catch((error) => {
          dispatch(
            addLog({
              level: 'error',
              category: 'logger',
              message: 'Failed to load recent logs from main process',
              detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
            }),
          );
        });
    });

    return () => {
      unsubscribeReady();
      unsubscribeEntry();
    };
  }, [dispatch]);

  useEffect(() => {
    const api = getAPI();
    if (!api?.canvasGeneration || !activeCanvasId) return;

    const resolveNodeTitle = (nodeId: string) =>
      activeCanvas?.nodes.find((node) => node.id === nodeId)?.title || nodeId;

    const unsubComplete = api.canvasGeneration.onComplete((data) => {
      if (data.canvasId !== activeCanvasId) return;
      const nodeTitle = resolveNodeTitle(data.nodeId);
      dispatch(
        addLog({
          level: 'info',
          category: 'generation',
          message: `Done: ${nodeTitle}`,
        }),
      );
    });

    const unsubFailed = api.canvasGeneration.onFailed((data) => {
      if (data.canvasId !== activeCanvasId) return;
      const nodeTitle = resolveNodeTitle(data.nodeId);
      dispatch(
        addLog({
          level: 'error',
          category: 'generation',
          message: `Failed: ${nodeTitle}`,
          detail: data.error,
        }),
      );
    });

    return () => {
      unsubComplete();
      unsubFailed();
    };
  }, [activeCanvas, activeCanvasId, dispatch]);

  const handleCreateCanvas = useCallback(async () => {
    const nextName = `Canvas ${canvases.length + 1}`;
    const created = await getAPI()?.canvas.create(nextName);
    if (!created) return;

    dispatch(addCanvas(created));
    dispatch(setActiveCanvas(created.id));
  }, [canvases.length, dispatch]);

  const renderActivePanel = () => {
    let Panel: React.ComponentType | null = null;
    switch (activePanel) {
      case 'add':
        Panel = AddNodePanel;
        break;
      case 'assets':
        Panel = AssetBrowserPanel;
        break;
      case 'characters':
        Panel = CharacterManagerPanel;
        break;
      case 'equipment':
        Panel = EquipmentManagerPanel;
        break;
      case 'locations':
        Panel = LocationManagerPanel;
        break;
      case 'shotTemplates':
        Panel = ShotTemplateManagerPanel;
        break;
      case 'presets':
        Panel = PresetManagerPanel;
        break;
      case 'canvases':
        Panel = CanvasNavigatorPanel;
        break;
    }
    return Panel ? (
      <ErrorBoundary name={activePanel ?? undefined}>
        <Suspense fallback={null}>
          <Panel />
        </Suspense>
      </ErrorBoundary>
    ) : null;
  };

  const renderRightPanel = () => {
    let Panel: React.ComponentType | null = null;
    switch (rightPanel) {
      case 'inspector':
        Panel = InspectorPanel;
        break;
      case 'logger':
        Panel = LoggerPanel;
        break;
      case 'dependencies':
        Panel = DependenciesPanel;
        break;
      case 'queue':
        Panel = GenerationQueuePanel;
        break;
      case 'history':
        Panel = HistoryPanel;
        break;
      case 'notes':
        Panel = CanvasNotesPanel;
        break;
      case 'export':
        Panel = ExportRenderPanel;
        break;
    }
    return Panel ? (
      <ErrorBoundary name={rightPanel ?? undefined}>
        <Suspense fallback={null}>
          <Panel />
        </Suspense>
      </ErrorBoundary>
    ) : null;
  };

  return (
    <div className="flex h-full min-h-0 bg-background">
      <LeftToolbar />

      <div className="min-w-0 flex-1">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t('panels.loadingCanvases')}
          </div>
        ) : !activeCanvas ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-muted-foreground">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Layers className="h-8 w-8" />
            </div>
            <div>
              <div className="text-base font-medium text-foreground">
                {t('panels.emptyCanvasTitle')}
              </div>
              <div className="mt-1 text-sm">{t('panels.emptyCanvasHint')}</div>
            </div>
            <button
              type="button"
              onClick={() => void handleCreateCanvas()}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              {t('panels.createCanvas')}
            </button>
          </div>
        ) : (
          <ReactFlowProvider>
            <div className="flex h-full w-full">
              {activePanel ? (
                <>
                  <div
                    ref={leftPanelRef}
                    className="h-full shrink-0 overflow-hidden"
                    style={{ width: leftWidthRef.current }}
                  >
                    {renderActivePanel()}
                  </div>
                  <DragHandle side="left" panelRef={leftPanelRef} widthRef={leftWidthRef} />
                </>
              ) : null}

              <div className="flex-1 min-w-0 h-full">
                <ErrorBoundary name="Canvas">
                  <CanvasWorkspace />
                </ErrorBoundary>
              </div>

              {rightPanel !== null ? (
                <>
                  <DragHandle side="right" panelRef={rightPanelRef} widthRef={rightWidthRef} />
                  <div
                    ref={rightPanelRef}
                    className="h-full shrink-0 overflow-hidden"
                    style={{ width: rightWidthRef.current }}
                  >
                    {renderRightPanel()}
                  </div>
                </>
              ) : null}
            </div>
          </ReactFlowProvider>
        )}
      </div>

      {commanderOpen ? (
        <ErrorBoundary name="Commander">
          <Suspense fallback={null}>
            <CommanderPanel />
          </Suspense>
        </ErrorBoundary>
      ) : null}
      <RightToolbar />
    </div>
  );
}
