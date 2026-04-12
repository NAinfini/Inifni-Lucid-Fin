import { useState, useEffect, useCallback } from 'react';
import { Film, Loader2, Check, AlertCircle } from 'lucide-react';
import { t } from '../../i18n.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/Dialog.js';

interface VideoCloneDialogProps {
  open: boolean;
  projectId: string | null;
  onClose: () => void;
  onCanvasCreated?: (canvasId: string) => void;
}

type CloneState = 'idle' | 'cloning' | 'done' | 'error';

interface ProgressData {
  step: string;
  current: number;
  total: number;
  message: string;
}

export function VideoCloneDialog({
  open,
  projectId,
  onClose,
  onCanvasCreated,
}: VideoCloneDialogProps) {
  const [filePath, setFilePath] = useState('');
  const [threshold, setThreshold] = useState(0.4);
  const [state, setState] = useState<CloneState>('idle');
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [result, setResult] = useState<{ canvasId: string; nodeCount: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setState('idle');
      setFilePath('');
      setProgress(null);
      setResult(null);
      setError('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const unsub = window.lucidAPI.video.onCloneProgress((data) => {
      setProgress(data);
    });
    return unsub;
  }, [open]);

  const handleSelectFile = useCallback(async () => {
    const selected = await window.lucidAPI.video.pickFile();
    if (selected) {
      setFilePath(selected);
    }
  }, []);

  const handleClone = useCallback(async () => {
    if (!filePath || !projectId) return;
    setState('cloning');
    setError('');
    try {
      const res = await window.lucidAPI.video.clone(filePath, projectId, threshold);
      setResult(res);
      setState('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }, [filePath, projectId, threshold]);

  const handleGoToCanvas = useCallback(() => {
    if (result?.canvasId) {
      onCanvasCreated?.(result.canvasId);
    }
    onClose();
  }, [result, onCanvasCreated, onClose]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Film className="h-4 w-4" />
            {t('videoClone.title')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* File picker */}
          <div>
            <button
              type="button"
              onClick={handleSelectFile}
              disabled={state === 'cloning'}
              className="w-full rounded-md border border-dashed border-border/60 p-4 text-center text-sm text-muted-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
            >
              {filePath
                ? filePath.split(/[\\/]/).pop()
                : t('videoClone.selectFile')}
            </button>
          </div>

          {/* Threshold slider */}
          <div>
            <label className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t('videoClone.threshold')}</span>
              <span className="font-mono">{threshold.toFixed(2)}</span>
            </label>
            <input
              type="range"
              min={0.1}
              max={0.8}
              step={0.05}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              disabled={state === 'cloning'}
              className="w-full mt-1"
            />
          </div>

          {/* Progress */}
          {state === 'cloning' && progress && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{progress.message}</span>
              </div>
              {progress.total > 1 && (
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-200"
                    style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Done */}
          {state === 'done' && result && (
            <div className="flex items-center gap-2 text-xs text-green-500">
              <Check className="h-3 w-3" />
              <span>{t('videoClone.complete').replace('{count}', String(result.nodeCount))}</span>
            </div>
          )}

          {/* Error */}
          {state === 'error' && error && (
            <div className="flex items-center gap-2 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" />
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            {state === 'done' ? (
              <button
                type="button"
                onClick={handleGoToCanvas}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {t('videoClone.goToCanvas')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleClone}
                disabled={!filePath || !projectId || state === 'cloning'}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {state === 'cloning' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  t('videoClone.clone')
                )}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
