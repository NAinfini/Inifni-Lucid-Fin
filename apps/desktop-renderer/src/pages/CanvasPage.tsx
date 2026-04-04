import { useCallback, useEffect, useMemo } from 'react';
import { Layers, Plus } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { Group, Panel, Separator } from 'react-resizable-panels';
import type { Canvas } from '@lucid-fin/contracts';
import type { AppDispatch, RootState } from '../store/index.js';
import {
  addCanvas,
  setActiveCanvas,
  setCanvases,
  setLoading,
} from '../store/slices/canvas.js';
import { toggleCommander } from '../store/slices/commander.js';
import { setPresets, setPresetsLoading } from '../store/slices/presets.js';
import { setPanelWidth, setRightPanelWidth } from '../store/slices/ui.js';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';
import { AddNodePanel } from '../components/canvas/AddNodePanel.js';
import { AssetBrowserPanel } from '../components/canvas/AssetBrowserPanel.js';
import { CanvasNavigatorPanel } from '../components/canvas/CanvasNavigatorPanel.js';
import { CanvasNotesPanel } from '../components/canvas/CanvasNotesPanel.js';
import { CanvasWorkspace } from '../components/canvas/CanvasWorkspace.js';
import { ReactFlowProvider } from '@xyflow/react';
import { CharacterManagerPanel } from '../components/canvas/CharacterManagerPanel.js';
import { CommanderPanel } from '../components/canvas/CommanderPanel.js';
import { DependenciesPanel } from '../components/canvas/DependenciesPanel.js';
import { EquipmentManagerPanel } from '../components/canvas/EquipmentManagerPanel.js';
import { LocationManagerPanel } from '../components/canvas/LocationManagerPanel.js';
import { ExportRenderPanel } from '../components/canvas/ExportRenderPanel.js';
import { GenerationQueuePanel } from '../components/canvas/GenerationQueuePanel.js';
import { HistoryPanel } from '../components/canvas/HistoryPanel.js';
import { InspectorPanel } from '../components/canvas/InspectorPanel.js';
import { LoggerPanel } from '../components/canvas/LoggerPanel.js';
import { PresetManagerPanel } from '../components/canvas/PresetManagerPanel.js';
import { LeftToolbar } from '../components/layout/LeftToolbar.js';
import { RightToolbar } from '../components/layout/RightToolbar.js';
import { addLog } from '../store/slices/logger.js';

function ResizeHandle({ direction }: { direction: 'horizontal' | 'vertical' }) {
  return (
    <Separator
      className={
        direction === 'horizontal'
          ? 'w-1 bg-border transition-colors hover:bg-primary/30'
          : 'h-1 bg-border transition-colors hover:bg-primary/30'
      }
    />
  );
}

export function CanvasPage() {
  const dispatch = useDispatch<AppDispatch>();
  const { canvases, activeCanvasId, loading } = useSelector(
    (state: RootState) => state.canvas,
  );
  const { activePanel, rightPanel } = useSelector(
    (state: RootState) => state.ui,
  );
  const projectLoaded = useSelector((state: RootState) => state.project.loaded);

  const activeCanvas = useMemo(
    () => canvases.find((canvas) => canvas.id === activeCanvasId) ?? null,
    [activeCanvasId, canvases],
  );

  useEffect(() => {
    if (!projectLoaded) return;
    if (canvases.length > 0) {
      if (loading) dispatch(setLoading(false));
      return;
    }
    const loadCanvases = async () => {
      dispatch(setLoading(true));
      try {
        const api = getAPI();
        if (!api) return;
        const listed = await api?.canvas.list();
        if (!Array.isArray(listed)) return;

        const loaded: Canvas[] = [];
        for (const item of listed) {
          loaded.push(await api.canvas.load(item.id));
        }

        dispatch(setCanvases(loaded));
        if (!activeCanvasId && loaded.length > 0) {
          dispatch(setActiveCanvas(loaded[0].id));
        }
      } finally {
        dispatch(setLoading(false));
      }
    };

    void loadCanvases();
  }, [dispatch, projectLoaded, canvases.length, loading]);

  useEffect(() => {
    if (!projectLoaded) return;
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
  }, [dispatch, projectLoaded]);

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
    switch (activePanel) {
      case 'add':
        return <AddNodePanel />;
      case 'assets':
        return <AssetBrowserPanel />;
      case 'characters':
        return <CharacterManagerPanel />;
      case 'equipment':
        return <EquipmentManagerPanel />;
      case 'locations':
        return <LocationManagerPanel />;
      case 'presets':
        return <PresetManagerPanel />;
      case 'canvases':
        return <CanvasNavigatorPanel />;
      default:
        return null;
    }
  };

  const renderRightPanel = () => {
    switch (rightPanel) {
      case 'inspector':
        return <InspectorPanel />;
      case 'logger':
        return <LoggerPanel />;
      case 'dependencies':
        return <DependenciesPanel />;
      case 'queue':
        return <GenerationQueuePanel />;
      case 'history':
        return <HistoryPanel />;
      case 'notes':
        return <CanvasNotesPanel />;
      case 'export':
        return <ExportRenderPanel />;
      default:
        return null;
    }
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
              <div className="text-base font-medium text-foreground">{t('panels.emptyCanvasTitle')}</div>
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
          <Group orientation="horizontal" className="h-full w-full">
            {activePanel ? (
              <>
                <Panel
                  id="left-panel"
                  defaultSize="25%"
                  minSize="200px"
                  maxSize="40%"
                  onResize={(panelSize) => {
                    dispatch(setPanelWidth(Math.round(panelSize.inPixels)));
                  }}
                >
                  {renderActivePanel()}
                </Panel>
                <ResizeHandle direction="horizontal" />
              </>
            ) : null}

            <Panel id="canvas-area" minSize="30%">
                <CanvasWorkspace />
            </Panel>

            {rightPanel !== null ? (
              <>
                <ResizeHandle direction="horizontal" />
                <Panel
                  id="right-panel"
                  defaultSize="25%"
                  minSize="200px"
                  maxSize="40%"
                  onResize={(panelSize) => {
                    dispatch(setRightPanelWidth(Math.round(panelSize.inPixels)));
                  }}
                >
                  {renderRightPanel()}
                </Panel>
              </>
            ) : null}
          </Group>
          </ReactFlowProvider>
        )}
      </div>

      <CommanderPanel />
      <RightToolbar />
    </div>
  );
}
