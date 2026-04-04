import { useState } from 'react';
import { useSelector } from 'react-redux';
import { Download, Film, FileText } from 'lucide-react';
import { getAPI } from '../../utils/api.js';
import type { RootState } from '../../store/index.js';
import { cn } from '../../lib/utils.js';
import { useI18n } from '../../hooks/use-i18n.js';

type ExportFormat = 'fcpxml' | 'edl';

export function ExportRenderPanel() {
  const { t } = useI18n();
  const { canvases, activeCanvasId } = useSelector((state: RootState) => state.canvas);
  const [format, setFormat] = useState<ExportFormat>('fcpxml');
  const [exporting, setExporting] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeCanvas = canvases.find((c) => c.id === activeCanvasId) ?? null;

  async function handleExport() {
    const api = getAPI();
    if (!api || !activeCanvas) return;

    const formatLabel = format === 'fcpxml' ? 'FCPXML' : 'EDL';
    const outputPath = window.prompt(
      t('exportRender.outputPathPrompt').replace('{{format}}', formatLabel),
      `${activeCanvas.name.replace(/\s+/g, '_')}.${format === 'fcpxml' ? 'fcpxml' : 'edl'}`,
    );
    if (!outputPath) return;

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

      // Type-cast since global.d.ts has the old ExportPreset signature
      const result = await (api.export.nle as unknown as (args: { format: ExportFormat; project: unknown; outputPath: string }) => Promise<{ outputPath: string }>)({ format, project, outputPath });
      setLastResult(result.outputPath);
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
    <div className="h-full bg-card border-l flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <Download className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">{t('exportRender.title')}</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Format */}
        <div>
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{t('exportRender.format')}</div>
          <div className="space-y-1.5">
            {FORMAT_OPTIONS.map(({ value, labelKey, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setFormat(value)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-sm text-left transition-colors',
                  format === value
                    ? 'border-primary/40 bg-primary/5 text-foreground'
                    : 'border-border bg-muted/20 text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>

        {activeCanvas && (
          <div className="text-xs text-muted-foreground px-1">
            {t('exportRender.canvas')} <span className="text-foreground">{activeCanvas.name}</span>{' '}
            ({activeCanvas.nodes.filter((n) => n.type !== 'backdrop').length} {t('exportRender.clips')})
          </div>
        )}

        {lastResult && (
          <div className="px-3 py-2 rounded-lg bg-emerald-400/10 border border-emerald-400/30 text-xs text-emerald-400 break-all">
            {t('exportRender.exported')} {lastResult}
          </div>
        )}
        {error && (
          <div className="px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t">
        <button
          type="button"
          onClick={() => void handleExport()}
          disabled={exporting || !activeCanvas}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50 transition-opacity hover:opacity-90"
        >
          <Download className="w-4 h-4" />
          {exporting ? t('exportRender.exporting') : t('exportRender.exportBtn')}
        </button>
      </div>
    </div>
  );
}
