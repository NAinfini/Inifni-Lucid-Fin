import React, { useState, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Download, Film, FileCode, Package, Play, Loader2 } from 'lucide-react';
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

  const NLE_FORMATS: Array<{ id: NLEFormat; labelKey: string; ext: string }> = [
    { id: 'fcpxml', labelKey: 'export.fcpxml', ext: '.fcpxml' },
    { id: 'edl', labelKey: 'export.edl', ext: '.edl' },
  ];

  const handleRender = useCallback(async () => {
    setExporting(true);
    setProgress(0);
    try {
      const api = getAPI();
      if (!api) return;
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
      if (managedRun) {
        const finalExport = await api.workflow.getFinalExport(managedRun.id);
        if (!finalExport) {
          throw new Error('The AI must prepare the Final Export manifest before rendering');
        }
        if (finalExport.approval.status !== 'approved') {
          throw new Error('Approve the exact Final Export manifest in the workflow drawer first');
        }
        await api.render.start({
          sceneId: activeCanvas.id,
          workflowRunId: managedRun.id,
          expectedManifestRevision: finalExport.manifest.revision,
          expectedManifestHash: finalExport.manifest.contentHash,
        });
      } else {
        await api.render.start({
          sceneId: activeCanvas.id,
          outputFormat,
          codec: format,
          resolution: { width: res?.width ?? 1920, height: res?.height ?? 1080 },
          fps,
        });
      }
      setProgress(100);
    } catch (err) {
      dispatch(
        addLog({
          level: 'error',
          category: 'export',
          message: t('export.renderFailed'),
          detail: err instanceof Error ? (err.stack ?? err.message) : String(err),
        }),
      );
    } finally {
      setExporting(false);
    }
  }, [activeCanvas, dispatch, format, fps, resolution]);

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

            {progress > 0 && progress < 100 && (
              <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-[width] duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            <button
              onClick={handleRender}
              disabled={exporting}
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
