import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Download, Film, FileText } from 'lucide-react';
import { getAPI } from '../../utils/api.js';
import type { RootState } from '../../store/index.js';
import { cn } from '../../lib/utils.js';
import { useI18n } from '../../hooks/use-i18n.js';
import { recordExport } from '../../store/slices/settings.js';

type ExportFormat = 'fcpxml' | 'edl';

export function ExportRenderPanel() {
  const { t } = useI18n();
  const dispatch = useDispatch();
  const { canvases, activeCanvasId } = useSelector((state: RootState) => state.canvas);
  const [format, setFormat] = useState<ExportFormat>('fcpxml');
  const [exporting, setExporting] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeCanvas = canvases.find((c) => c.id === activeCanvasId) ?? null;

  async function handleExport() {
    const api = getAPI();
    if (!api || !activeCanvas) return;

    setExporting(true);
    setError(null);
    setLastResult(null);
    try {
      // Build a minimal NLEProject from canvas nodes
      const project = {
        id: activeCanvas.id,
        name: activeCanvas.name,
        fps: 24,
        clips: activeCanvas.nodes
          .filter((n) => n.type === 'video' || n.type === 'image' || n.type === 'audio')
          .map((n, i) => ({
            id: n.id,
            name: n.title || `${n.type}-${i + 1}`,
            type: n.type,
            start: i * 5,
            duration: 5,
          })),
      };

      // Backend handles save dialog
      const result = await (api.export.nle as unknown as (args: { format: ExportFormat; project: unknown }) => Promise<{ outputPath: string } | null>)({ format, project });
      if (result) setLastResult(result.outputPath);
      dispatch(recordExport({ format }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('exportRender.exportFailed'));
    } finally {
      setExporting(false);
    }
  }

  const FORMAT_OPTIONS: { value: ExportFormat; labelKey: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { value: 'fcpxml', labelKey: 'exportRender.fcpxml', icon: Film },
    { value: 'edl', labelKey: 'exportRender.edl', icon: FileText },
  ];

  return (
    <div className="h-full bg-card border-l border-border/60 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
        <Download className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">{t('exportRender.title')}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Format */}
        <div>
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">{t('exportRender.format')}</div>
          <div className="space-y-1">
            {FORMAT_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setFormat(value)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md border text-xs text-left transition-colors',
                  format === value
                    ? 'border-primary/40 bg-primary/5 text-foreground'
                    : 'border-border/60 bg-muted/20 text-muted-foreground hover:text-foreground hover:bg-muted/40',
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>

        {activeCanvas && (
          <div className="text-[11px] text-muted-foreground px-0.5">
            {t('exportRender.canvas')} <span className="text-foreground">{activeCanvas.name}</span>{' '}
            ({activeCanvas.nodes.filter((n) => n.type !== 'backdrop').length} {t('exportRender.clips')})
          </div>
        )}

        {lastResult && (
          <div className="px-2.5 py-1.5 rounded-md bg-emerald-400/10 border border-emerald-400/30 text-[11px] text-emerald-400 break-all">
            {t('exportRender.exported')} {lastResult}
          </div>
        )}
        {error && (
          <div className="px-2.5 py-1.5 rounded-md bg-destructive/10 border border-destructive/30 text-[11px] text-destructive">
            {error}
          </div>
        )}
      </div>

      <div className="px-3 py-2.5 border-t border-border/60">
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting || !activeCanvas}
          className="w-full flex items-center justify-center gap-2 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 transition-opacity hover:opacity-90"
        >
          <Download className="w-3.5 h-3.5" />
          {exporting ? t('exportRender.exporting') : t('exportRender.exportBtn')}
        </button>
      </div>
    </div>
  );
}
