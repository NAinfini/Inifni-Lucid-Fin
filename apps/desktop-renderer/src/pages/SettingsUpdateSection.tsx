import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';
import { Progress } from '../components/ui/Progress.js';
import { cn } from '../lib/utils.js';
import type { AppDispatch } from '../store/index.js';
import { addLog } from '../store/slices/logger.js';

interface UpdateInfo {
  releaseDate?: string;
  releaseNotes?: string;
  version: string;
}

interface UpdaterStatus {
  error?: string;
  info?: UpdateInfo;
  progress?: number;
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
}

type UpdateState =
  | { phase: 'idle'; availableVersion?: string; releaseNotes?: string; releaseDate?: string }
  | { phase: 'checking'; availableVersion?: string; releaseNotes?: string; releaseDate?: string }
  | { phase: 'available'; availableVersion: string; releaseNotes?: string; releaseDate?: string }
  | {
      phase: 'downloading';
      progress: number;
      availableVersion?: string;
      releaseNotes?: string;
      releaseDate?: string;
    }
  | { phase: 'ready'; availableVersion: string; releaseNotes?: string; releaseDate?: string }
  | {
      phase: 'error';
      message: string;
      availableVersion?: string;
      releaseNotes?: string;
      releaseDate?: string;
    }
  | { phase: 'upToDate'; availableVersion?: string; releaseNotes?: string; releaseDate?: string };

function clampProgress(value?: number): number {
  return Math.max(0, Math.min(100, Math.round(value ?? 0)));
}

export function SettingsUpdateSection() {
  const dispatch = useDispatch<AppDispatch>();
  const [version, setVersion] = useState('');
  const [state, setState] = useState<UpdateState>({ phase: 'idle' });
  const [changelogOpen, setChangelogOpen] = useState(false);
  const checkRequestedRef = useRef(false);

  useEffect(() => {
    const api = getAPI();
    if (!api) return;

    let isMounted = true;

    const applyStatus = (status: UpdaterStatus) => {
      if (!isMounted) return;

      setState((current) => {
        const availableVersion = status.info?.version ?? current.availableVersion;
        const releaseNotes = status.info?.releaseNotes ?? current.releaseNotes;
        const releaseDate = status.info?.releaseDate ?? current.releaseDate;

        switch (status.state) {
          case 'checking':
            return { phase: 'checking', availableVersion, releaseNotes, releaseDate };
          case 'available':
            checkRequestedRef.current = false;
            return {
              phase: 'available',
              availableVersion: status.info?.version ?? availableVersion ?? '',
              releaseNotes,
              releaseDate,
            };
          case 'downloading':
            checkRequestedRef.current = false;
            return {
              phase: 'downloading',
              progress: clampProgress(status.progress),
              availableVersion,
              releaseNotes,
              releaseDate,
            };
          case 'downloaded':
            checkRequestedRef.current = false;
            return {
              phase: 'ready',
              availableVersion: status.info?.version ?? availableVersion ?? '',
              releaseNotes,
              releaseDate,
            };
          case 'error':
            checkRequestedRef.current = false;
            return {
              phase: 'error',
              message: status.error ?? t('settings.update.error'),
              availableVersion,
              releaseNotes,
              releaseDate,
            };
          case 'idle':
          default: {
            const completedCheck = checkRequestedRef.current || current.phase === 'checking';
            checkRequestedRef.current = false;
            return completedCheck
              ? { phase: 'upToDate', availableVersion, releaseNotes, releaseDate }
              : { phase: 'idle', availableVersion, releaseNotes, releaseDate };
          }
        }
      });
    };

    void api.app
      .version()
      .then((appVersion) => {
        if (isMounted) setVersion(appVersion);
      })
      .catch(() => {
        if (isMounted) setVersion('dev');
      });

    void api.updater
      .status()
      .then((status) => {
        applyStatus(status);
        // Auto-check when opening About tab if we're still idle
        if (status.state === 'idle') {
          checkRequestedRef.current = true;
          setState({ phase: 'checking' });
          void api.updater.check().catch(() => {});
        }
      })
      .catch(() => {
        // In dev mode, updater handlers may not be ready yet — silently stay idle
        if (!isMounted) return;
        setState({ phase: 'idle' });
      });

    const unsubscribe = api.updater.onProgress((status) => applyStatus(status as UpdaterStatus));

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [dispatch]);

  async function handleCheck(): Promise<void> {
    const api = getAPI();
    if (!api) return;
    checkRequestedRef.current = true;
    setState((current) => ({ phase: 'checking', availableVersion: current.availableVersion }));
    try {
      await api.updater.check();
    } catch (error) {
      checkRequestedRef.current = false;
      dispatch(
        addLog({
          level: 'error',
          category: 'updater',
          message: t('settings.update.log.checkFailed'),
          detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
        }),
      );
      setState((current) => ({
        phase: 'error',
        availableVersion: current.availableVersion,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function handleDownload(): Promise<void> {
    const api = getAPI();
    if (!api) return;
    setState((current) => ({
      phase: 'downloading',
      progress: current.phase === 'downloading' ? current.progress : 0,
      availableVersion: current.availableVersion,
    }));
    try {
      await api.updater.download();
    } catch (error) {
      dispatch(
        addLog({
          level: 'error',
          category: 'updater',
          message: t('settings.update.log.downloadFailed'),
          detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
        }),
      );
      setState((current) => ({
        phase: 'error',
        availableVersion: current.availableVersion,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function handleInstall(): Promise<void> {
    const api = getAPI();
    if (!api) return;
    try {
      await api.updater.install();
    } catch (error) {
      dispatch(
        addLog({
          level: 'error',
          category: 'updater',
          message: t('settings.update.log.installFailed'),
          detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
        }),
      );
      setState((current) => ({
        phase: 'error',
        availableVersion: current.availableVersion,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  return (
    <section className="mb-6">
      <div
        className={cn(
          'rounded-md border p-3 transition-colors',
          state.phase === 'error'
            ? 'border-destructive/40 bg-destructive/5'
            : state.phase === 'available' ||
                state.phase === 'downloading' ||
                state.phase === 'ready'
              ? 'border-primary/40 bg-primary/5'
              : 'border-border/60 bg-card',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Lucid Fin</div>
            <div className="text-xs text-muted-foreground">
              {t('settings.update.version')} {version || '...'}
            </div>
          </div>

          {/* Status — inline right side */}
          {state.phase === 'idle' && (
            <button
              type="button"
              onClick={() => void handleCheck()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
            >
              {t('settings.update.checkForUpdates')}
            </button>
          )}

          {state.phase === 'checking' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('settings.update.checking')}
            </div>
          )}

          {state.phase === 'upToDate' && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <Check className="h-3.5 w-3.5" />
                {t('settings.update.upToDate')}
              </div>
              <button
                type="button"
                onClick={() => void handleCheck()}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <RotateCcw className="h-2.5 w-2.5" />
              </button>
            </div>
          )}

          {state.phase === 'error' && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                {t('settings.update.error')}
              </div>
              <button
                type="button"
                onClick={() => void handleCheck()}
                className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <RotateCcw className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
        </div>

        {/* Expanded states below the header row */}
        {state.phase === 'available' && (
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/40 pt-3">
            <div className="min-w-0">
              <div className="text-xs font-medium">{t('settings.update.available')}</div>
              <div className="text-xs text-muted-foreground">
                {t('settings.update.version')} {state.availableVersion}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleDownload()}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
            >
              <Download className="h-3 w-3" />
              {t('settings.update.download')}
            </button>
          </div>
        )}

        {state.phase === 'downloading' && (
          <div className="mt-3 space-y-1.5 border-t border-border/40 pt-3">
            <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span>{t('settings.update.downloading')}</span>
              <span className="tabular-nums">{state.progress}%</span>
            </div>
            <Progress value={state.progress} />
          </div>
        )}

        {state.phase === 'ready' && (
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/40 pt-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-emerald-400">
                {t('settings.update.ready')}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('settings.update.version')} {state.availableVersion}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleInstall()}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white"
            >
              {t('settings.update.install')}
            </button>
          </div>
        )}

        {state.phase === 'error' && state.message && (
          <div className="mt-2 text-[10px] text-muted-foreground break-words">{state.message}</div>
        )}

        {/* Changelog / release notes */}
        {state.releaseNotes &&
          (state.phase === 'available' ||
            state.phase === 'downloading' ||
            state.phase === 'ready') && (
            <div className="mt-2 border-t border-border/40 pt-2">
              <button
                type="button"
                onClick={() => setChangelogOpen(!changelogOpen)}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {changelogOpen ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {t('settings.update.changelog')}
                {state.releaseDate && (
                  <span className="ml-1 text-muted-foreground/60">
                    · {new Date(state.releaseDate).toLocaleDateString()}
                  </span>
                )}
              </button>
              {changelogOpen && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded-md bg-muted/30 p-2.5 text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {state.releaseNotes}
                </div>
              )}
            </div>
          )}
      </div>
    </section>
  );
}
