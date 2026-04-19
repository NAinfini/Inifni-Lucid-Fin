import { useCallback, useEffect, useState } from 'react';
import {
  Database,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from 'lucide-react';
import { t } from '../i18n.js';
import { cn } from '../lib/utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StorageOverview {
  appRoot: string;
  dbSize: number;
  globalAssetsSize: number;
  globalAssetCount: number;
  logsSize: number;
  totalSize: number;
  paths: {
    appRoot: string;
    database: string;
    globalAssets: string;
    logs: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

function StorageBar({ items }: { items: Array<{ label: string; size: number; color: string }> }) {
  const total = items.reduce((s, i) => s + i.size, 0);
  if (total === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {items.map((item) => {
          const pct = (item.size / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={item.label}
              className={cn('h-full transition-[width] duration-200', item.color)}
              style={{ width: `${pct}%` }}
              title={`${item.label}: ${formatBytes(item.size)}`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        {items.map((item) => (
          <span key={item.label} className="flex items-center gap-1">
            <span className={cn('inline-block h-2 w-2 rounded-full', item.color)} />
            {item.label}: {formatBytes(item.size)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

function PathRow({
  label,
  path,
  onOpen,
}: {
  label: string;
  path: string;
  onOpen: (p: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">{label}</div>
        <div className="truncate text-[10px] text-muted-foreground">{path}</div>
      </div>
      <button
        type="button"
        onClick={() => onOpen(path)}
        className="flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <FolderOpen className="h-3 w-3" />
      </button>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  loading,
  variant = 'default',
}: {
  icon: typeof Trash2;
  label: string;
  onClick: () => void;
  loading?: boolean;
  variant?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className={cn(
        'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors disabled:opacity-50',
        variant === 'danger'
          ? 'border-destructive/40 text-destructive hover:bg-destructive/10'
          : 'border-border/60 text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SettingsStorageSection() {
  const [overview, setOverview] = useState<StorageOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.lucidAPI.storage.getOverview();
      setOverview(data);
    } catch (err) {
      void console.error('[SettingsStorage] Failed to load storage overview:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const showMessage = useCallback((type: 'success' | 'error', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  }, []);

  const handleOpenFolder = useCallback((p: string) => {
    void window.lucidAPI.storage.openFolder(p);
  }, []);

  const handleClearLogs = useCallback(async () => {
    setActionLoading('clearLogs');
    try {
      const result = await window.lucidAPI.storage.clearLogs();
      showMessage('success', t('settings.storage.logsCleared').replace('{count}', String(result.cleared)));
      void refresh();
    } catch { /* IPC call failed — show generic error message */
      showMessage('error', t('settings.storage.actionFailed'));
    } finally {
      setActionLoading(null);
    }
  }, [refresh, showMessage]);

  const handleClearEmbeddings = useCallback(async () => {
    setActionLoading('clearEmbeddings');
    try {
      await window.lucidAPI.storage.clearEmbeddings();
      showMessage('success', t('settings.storage.embeddingsCleared'));
      void refresh();
    } catch { /* IPC call failed — show generic error message */
      showMessage('error', t('settings.storage.actionFailed'));
    } finally {
      setActionLoading(null);
    }
  }, [refresh, showMessage]);

  const handleVacuum = useCallback(async () => {
    setActionLoading('vacuum');
    try {
      await window.lucidAPI.storage.vacuumDatabase();
      showMessage('success', t('settings.storage.vacuumDone'));
      void refresh();
    } catch { /* IPC call failed — show generic error message */
      showMessage('error', t('settings.storage.actionFailed'));
    } finally {
      setActionLoading(null);
    }
  }, [refresh, showMessage]);

  const handleBackup = useCallback(async () => {
    const dest = await window.lucidAPI.storage.pickSaveFile('lucid-fin-backup.db');
    if (!dest) return;
    setActionLoading('backup');
    try {
      const result = await window.lucidAPI.storage.backupDatabase(dest);
      if (result.success) {
        showMessage('success', t('settings.storage.backupDone'));
      } else {
        showMessage('error', result.error ?? t('settings.storage.actionFailed'));
      }
    } finally {
      setActionLoading(null);
    }
  }, [showMessage]);

  const handleRestore = useCallback(async () => {
    const src = await window.lucidAPI.storage.pickOpenFile(['db']);
    if (!src) return;
    setActionLoading('restore');
    try {
      const result = await window.lucidAPI.storage.restoreDatabase(src);
      if (result.success) {
        showMessage('success', t('settings.storage.restoreDone'));
      } else {
        showMessage('error', result.error ?? t('settings.storage.actionFailed'));
      }
    } finally {
      setActionLoading(null);
    }
  }, [showMessage]);

  if (loading || !overview) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status message */}
      {message && (
        <div
          className={cn(
            'rounded-md px-3 py-2 text-xs',
            message.type === 'success'
              ? 'bg-green-500/10 text-green-500'
              : 'bg-destructive/10 text-destructive',
          )}
        >
          {message.text}
        </div>
      )}

      {/* Storage Overview */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold">
            <HardDrive className="h-3.5 w-3.5" />
            {t('settings.storage.overview')}
          </h3>
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="h-3 w-3" />
            {t('settings.storage.refresh')}
          </button>
        </div>

        <div className="rounded-lg border border-border/60 p-4">
          <div className="mb-3 text-lg font-bold">{formatBytes(overview.totalSize)}</div>
          <StorageBar
            items={[
              { label: t('settings.storage.database'), size: overview.dbSize, color: 'bg-blue-500' },
              { label: t('settings.storage.assets'), size: overview.globalAssetsSize, color: 'bg-purple-500' },
              { label: t('settings.storage.logs'), size: overview.logsSize, color: 'bg-yellow-500' },
            ]}
          />
        </div>
      </div>

      {/* Quick Access */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <FolderOpen className="h-3.5 w-3.5" />
          {t('settings.storage.quickAccess')}
        </h3>
        <div className="space-y-1.5">
          <PathRow label={t('settings.storage.appRoot')} path={overview.paths.appRoot} onOpen={handleOpenFolder} />
          <PathRow label={t('settings.storage.databaseFile')} path={overview.paths.database} onOpen={(p) => window.lucidAPI.storage.showInFolder(p)} />
          <PathRow label={t('settings.storage.globalAssets')} path={overview.paths.globalAssets} onOpen={handleOpenFolder} />
          <PathRow label={t('settings.storage.logsFolder')} path={overview.paths.logs} onOpen={handleOpenFolder} />
        </div>
      </div>

      {/* Database Management */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <Database className="h-3.5 w-3.5" />
          {t('settings.storage.databaseManagement')}
        </h3>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            icon={RefreshCw}
            label={t('settings.storage.vacuum')}
            onClick={() => void handleVacuum()}
            loading={actionLoading === 'vacuum'}
          />
          <ActionButton
            icon={Save}
            label={t('settings.storage.backup')}
            onClick={() => void handleBackup()}
            loading={actionLoading === 'backup'}
          />
          <ActionButton
            icon={Upload}
            label={t('settings.storage.restore')}
            onClick={() => void handleRestore()}
            loading={actionLoading === 'restore'}
          />
        </div>
      </div>

      {/* Cleanup */}
      <div className="space-y-3">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold">
          <Trash2 className="h-3.5 w-3.5" />
          {t('settings.storage.cleanup')}
        </h3>
        <div className="flex flex-wrap gap-2">
          <ActionButton
            icon={Trash2}
            label={t('settings.storage.clearLogs')}
            onClick={() => void handleClearLogs()}
            loading={actionLoading === 'clearLogs'}
            variant="danger"
          />
          <ActionButton
            icon={Trash2}
            label={t('settings.storage.clearEmbeddings')}
            onClick={() => void handleClearEmbeddings()}
            loading={actionLoading === 'clearEmbeddings'}
            variant="danger"
          />
        </div>
      </div>
    </div>
  );
}
