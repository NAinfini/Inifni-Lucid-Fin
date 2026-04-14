import React from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { Activity } from 'lucide-react';
import { t } from '../../i18n.js';

export function StatusBar() {
  const { title } = useSelector((s: RootState) => s.settings.production);
  const { activeCount } = useSelector((s: RootState) => s.jobs);

  return (
    <footer
      className="flex items-center justify-between h-6 px-3 text-xs border-t bg-card text-muted-foreground select-none"
      role="contentinfo"
      aria-label={t('statusBar.label')}
    >
      <span>{title || 'Lucid Fin'}</span>
      <div className="flex items-center gap-3">
        {activeCount > 0 && (
          <span className="flex items-center gap-1">
            <Activity className="w-3 h-3 text-primary animate-pulse" />
            {activeCount} {t('statusBar.jobsRunning')}
          </span>
        )}
        <span>Lucid Fin v0.0.1</span>
      </div>
    </footer>
  );
}
