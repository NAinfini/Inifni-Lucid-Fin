import { cn } from '../../../lib/utils.js';
import { useI18n } from '../../../hooks/use-i18n.js';

interface EditViewProps {
  focusedNodeId: string | null;
}

export function EditView({ focusedNodeId }: EditViewProps) {
  const { t } = useI18n();

  if (!focusedNodeId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('view.editNoSelection')}
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col items-center justify-center p-6')}>
      <div className="w-full max-w-2xl rounded-lg border border-border/60 bg-card/95 p-6 shadow-lg">
        <p className="text-xs text-muted-foreground">
          {t('view.editLabel')}: {focusedNodeId}
        </p>
      </div>
    </div>
  );
}
