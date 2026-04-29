import { useState, useCallback, useRef } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './Dialog.js';
import { Button } from './Button.js';
import { t } from '../../i18n.js';

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
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) handleCancel();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogTitle className="text-sm font-medium">{options.title}</DialogTitle>
        {options.description ? (
          <DialogDescription className="text-xs text-muted-foreground">
            {options.description}
          </DialogDescription>
        ) : (
          <DialogDescription className="sr-only">Confirm action</DialogDescription>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={handleCancel}>
            {options.cancelLabel ?? t('dialog.cancel')}
          </Button>
          <Button
            variant={options.destructive ? 'destructive' : 'default'}
            size="sm"
            onClick={handleConfirm}
          >
            {options.confirmLabel ?? t('dialog.ok')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { confirm, ConfirmDialog: ConfirmDialogComponent };
}
