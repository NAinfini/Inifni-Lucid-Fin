import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { AlertCircle, Check, Download, Loader2, RotateCcw } from 'lucide-react';
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
  | { phase: 'idle'; availableVersion?: string }
  | { phase: 'checking'; availableVersion?: string }
  | { phase: 'available'; availableVersion: string }
  | { phase: 'downloading'; progress: number; availableVersion?: string }
  | { phase: 'ready'; availableVersion: string }
  | { phase: 'error'; message: string; availableVersion?: string }
  | { phase: 'upToDate'; availableVersion?: string };

function clampProgress(value?: number): number {
  return Math.max(0, Math.min(100, Math.round(value ?? 0)));
}

export function SettingsUpdateSection() {
  const dispatch = useDispatch<AppDispatch>();
  const [version, setVersion] = useState('');
  const [state, setState] = useState<UpdateState>({ phase: 'idle' });
  const checkRequestedRef = useRef(false);

  useEffect(() => {
    const api = getAPI();
    if (!api) return;

    let isMounted = true;

    const applyStatus = (status: UpdaterStatus) => {
      if (!isMounted) return;

      setState((current) => {
        const availableVersion = status.info?.version ?? current.availableVersion;

        switch (status.state) {
          case 'checking':
            return { phase: 'checking', availableVersion };
          case 'available':
            checkRequestedRef.current = false;
            return {
              phase: 'available',
              availableVersion: status.info?.version ?? availableVersion ?? '',
            };
          case 'downloading':
            checkRequestedRef.current = false;
            return {
              phase: 'downloading',
              progress: clampProgress(status.progress),
              availableVersion,
            };
          case 'downloaded':
            checkRequestedRef.current = false;
            return {
              phase: 'ready',
              availableVersion: status.info?.version ?? availableVersion ?? '',
            };
          case 'error':
            checkRequestedRef.current = false;
            return {
              phase: 'error',
              message: status.error ?? t('settings.update.error'),
              availableVersion,
            };
          case 'idle':
          default: {
            const completedCheck = checkRequestedRef.current || current.phase === 'checking';
            checkRequestedRef.current = false;
            return completedCheck
              ? { phase: 'upToDate', availableVersion }
              : { phase: 'idle', availableVersion };
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
      .then(applyStatus)
      .catch((error: unknown) => {
        if (!isMounted) return;
        dispatch(
          addLog({
            level: 'error',
            category: 'updater',
            message: t('settings.update.log.statusLoadFailed'),
            detail: error instanceof Error ? error.stack ?? error.message : String(error),
          }),
        );
        setState({
          phase: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
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
          detail: error instanceof Error ? error.stack ?? error.message : String(error),
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
          detail: error instanceof Error ? error.stack ?? error.message : String(error),
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
          detail: error instanceof Error ? error.stack ?? error.message : String(error),
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
          'space-y-3 rounded-md border p-3 transition-colors',
          state.phase === 'error'
            ? 'border-destructive/40 bg-destructive/5'
            : state.phase === 'available' ||
                state.phase === 'downloading' ||
                state.phase === 'ready'
              ? 'border-primary/40 bg-primary/5'
              : 'border-border/60 bg-card',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Lucid Fin</div>
            <div className="text-xs text-muted-foreground">
              {t('settings.update.version')} {version || '...'}
            </div>
          </div>
        </div>

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
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            {t('settings.update.upToDate')}
          </div>
        )}

        {state.phase === 'available' && (
          <div className="flex items-center justify-between gap-2">
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
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span>{t('settings.update.downloading')}</span>
              <span className="tabular-nums">{state.progress}%</span>
            </div>
            <Progress value={state.progress} />
          </div>
        )}

        {state.phase === 'ready' && (
          <div className="flex items-center justify-between gap-2">
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

        {state.phase === 'error' && (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                {t('settings.update.error')}
              </div>
              <div className="break-words text-xs text-muted-foreground">{state.message}</div>
            </div>
            <button
              type="button"
              onClick={() => void handleCheck()}
              className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-2.5 py-1 text-xs hover:bg-muted"
            >
              <RotateCcw className="h-3 w-3" />
              {t('settings.update.retry')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
