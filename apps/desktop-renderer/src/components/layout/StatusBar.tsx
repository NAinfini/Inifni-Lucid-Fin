import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { Activity } from 'lucide-react';
import { t } from '../../i18n.js';
import { getAPI } from '../../utils/api.js';

export function StatusBar() {
  const canvasName = useSelector((s: RootState) => {
    const id = s.canvas.activeCanvasId;
    if (!id) return null;
    return s.canvas.canvases.entities[id]?.name ?? null;
  });
  const { activeCount } = useSelector((s: RootState) => s.jobs);
  const [version, setVersion] = useState('');

  useEffect(() => {
    getAPI()?.app.version().then(setVersion).catch(() => setVersion('dev'));
  }, []);

  return (
    <footer
      className="flex items-center justify-between h-6 px-3 text-xs border-t bg-card text-muted-foreground select-none"
      role="contentinfo"
      aria-label={t('statusBar.label')}
    >
      <span>{canvasName || 'Lucid Fin'}</span>
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
