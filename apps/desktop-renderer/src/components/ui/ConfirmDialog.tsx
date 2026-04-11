import { useState, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from './Dialog.js';

interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

type ResolveRef = ((value: boolean) => void) | null;

export function useConfirm() {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions>({ title: '' });
  const resolveRef = useRef<ResolveRef>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setOpen(false);
    resolveRef.current?.(true);
    resolveRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setOpen(false);
    resolveRef.current?.(false);
    resolveRef.current = null;
  }, []);

  const ConfirmDialogComponent = (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancel(); }}>
      <DialogContent
        aria-describedby={options.description ? 'confirm-dialog-description' : undefined}
        className="max-w-sm"
      >
        <DialogTitle className="text-sm font-medium">{options.title}</DialogTitle>
        {options.description && (
          <DialogDescription id="confirm-dialog-description" className="text-xs text-muted-foreground">
            {options.description}
          </DialogDescription>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted transition-colors"
          >
            {options.cancelLabel ?? 'Cancel'}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
              options.destructive
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {options.confirmLabel ?? 'OK'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { confirm, ConfirmDialog: ConfirmDialogComponent };
}
