import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { Activity, Check, Loader2 } from 'lucide-react';
import { t } from '../../i18n.js';
import { getAPI } from '../../utils/api.js';
import { getCanvasSaveStatus } from '../../store/middleware/persist.js';

export function StatusBar() {
  const canvasName = useSelector((s: RootState) => {
    const id = s.canvas.activeCanvasId;
    if (!id) return null;
    return s.canvas.canvases.entities[id]?.name ?? null;
  });
  const { activeCount } = useSelector((s: RootState) => s.jobs);
  const [version, setVersion] = useState('');
  const [saveStatus, setSaveStatus] = useState<{ lastSavedAt: number; pending: boolean }>({ lastSavedAt: 0, pending: false });

  useEffect(() => {
    getAPI()?.app.version().then(setVersion).catch(() => setVersion('dev'));
  }, []);

  useEffect(() => {
    const id = setInterval(() => setSaveStatus(getCanvasSaveStatus()), 1000);
    return () => clearInterval(id);
  }, []);

  const showSaved = !saveStatus.pending && saveStatus.lastSavedAt > 0;

  return (
    <footer
      className="flex items-center justify-between h-6 px-3 text-xs border-t bg-card text-muted-foreground select-none"
      role="contentinfo"
      aria-label={t('statusBar.label')}
    >
      <div className="flex items-center gap-2">
        <span>{canvasName || 'Lucid Fin'}</span>
        {saveStatus.pending && (
          <span className="flex items-center gap-1 text-[10px] text-amber-500">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            {t('statusBar.saving')}
          </span>
        )}
        {showSaved && (
          <span className="flex items-center gap-1 text-[10px] text-emerald-500">
            <Check className="w-2.5 h-2.5" />
            {t('statusBar.saved')}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        {activeCount > 0 && (
          <span className="flex items-center gap-1">
            <Activity className="w-3 h-3 text-primary animate-pulse" />
            {activeCount} {t('statusBar.jobsRunning')}
          </span>
        )}
        <span>Lucid Fin {version ? `v${version}` : ''}</span>
      </div>
    </footer>
  );
}
