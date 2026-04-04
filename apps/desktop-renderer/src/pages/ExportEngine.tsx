import React, { useState, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { Download, Film, FileCode, Package, Play, Loader2 } from 'lucide-react';
import type { RootState } from '../store/index.js';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';

type ExportTab = 'render' | 'nle' | 'assets';
type NLEFormat = 'fcpxml' | 'edl';

const VIDEO_FORMATS = [
  { id: 'h264', label: 'H.264 (MP4)', ext: '.mp4' },
  { id: 'h265', label: 'H.265 (MP4)', ext: '.mp4' },
  { id: 'prores', label: 'ProRes (MOV)', ext: '.mov' },
];

const RESOLUTIONS = [
  { id: '1080p', label: '1920×1080 (1080p)', width: 1920, height: 1080 },
  { id: '4k', label: '3840×2160 (4K)', width: 3840, height: 2160 },
  { id: '720p', label: '1280×720 (720p)', width: 1280, height: 720 },
];

const FPS_OPTIONS = [24, 25, 30, 60];

export function ExportEngine() {
  const [activeTab, setActiveTab] = useState<ExportTab>('render');
  const [format, setFormat] = useState('h264');
  const [resolution, setResolution] = useState('1080p');
  const [fps, setFps] = useState(30);
  const [nleFormat, setNleFormat] = useState<NLEFormat>('fcpxml');
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const { title } = useSelector((s: RootState) => s.project);

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
      const res = RESOLUTIONS.find((r) => r.id === resolution);
      const outputFormat = format === 'prores' ? ('mov' as const) : ('mp4' as const);
      await api.render.start({
        sceneId: '',
        outputFormat,
        resolution: { width: res?.width ?? 1920, height: res?.height ?? 1080 },
        fps,
      });
      setProgress(100);
    } catch (err) {
      console.error('Render failed:', err);
    } finally {
      setExporting(false);
    }
  }, [format, fps, resolution, title]);

  const handleNleExport = useCallback(async () => {
    setExporting(true);
    try {
      const api = getAPI();
      if (!api) return;
      await api.export.nle({ format: nleFormat, includeAudio: true, includeSubtitles: true });
    } catch (err) {
      console.error('NLE export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [nleFormat]);

  const handleAssetPack = useCallback(async () => {
    setExporting(true);
    try {
      const api = getAPI();
      if (!api) return;
      await api.export.assetBundle(`${title || 'project'}-assets.zip`);
    } catch (err) {
      console.error('Asset pack failed:', err);
    } finally {
      setExporting(false);
    }
  }, [title]);

  const tabs = [
    { key: 'render' as const, icon: Film, label: t('export.render') },
    { key: 'nle' as const, icon: FileCode, label: t('export.nle') },
    { key: 'assets' as const, icon: Package, label: t('export.assets') },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b bg-card">
        <Download className="w-4 h-4 text-primary" />
        <span className="text-sm font-medium">{t('export.title')}</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b bg-card">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-sm border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'render' && (
          <div className="max-w-lg space-y-6">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">
                {t('export.format')}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {VIDEO_FORMATS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFormat(f.id)}
                    className={`px-3 py-2 text-sm rounded border ${format === f.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">
                {t('export.resolution')}
              </label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="w-full px-2 py-1.5 text-sm rounded border bg-background"
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">
                {t('export.fps')}
              </label>
              <div className="flex gap-2">
                {FPS_OPTIONS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFps(f)}
                    className={`px-3 py-1.5 text-sm rounded border ${fps === f ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                  >
                    {f}fps
                  </button>
                ))}
              </div>
            </div>

            {progress > 0 && progress < 100 && (
              <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            <button
              onClick={handleRender}
              disabled={exporting}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              {t('export.startRender')}
            </button>
          </div>
        )}

        {activeTab === 'nle' && (
          <div className="max-w-lg space-y-6">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">
                {t('export.nleFormat')}
              </label>
              <div className="space-y-2">
                {NLE_FORMATS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setNleFormat(f.id)}
                    className={`flex items-center gap-2 w-full px-3 py-2 text-sm rounded border text-left ${nleFormat === f.id ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                  >
                    <FileCode className="w-4 h-4" />
                    {t(f.labelKey)}
                    <span className="text-xs text-muted-foreground ml-auto">{f.ext}</span>
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleNleExport}
              disabled={exporting}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {t('export.exportNle')}
            </button>
          </div>
        )}

        {activeTab === 'assets' && (
          <div className="max-w-lg space-y-6">
            <div className="p-6 rounded-lg border-2 border-dashed text-center">
              <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">{t('export.assetPackDescription')}</p>
            </div>

            <button
              onClick={handleAssetPack}
              disabled={exporting}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 text-sm font-medium rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {exporting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Package className="w-4 h-4" />
              )}
              {t('export.exportAssetPack')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
