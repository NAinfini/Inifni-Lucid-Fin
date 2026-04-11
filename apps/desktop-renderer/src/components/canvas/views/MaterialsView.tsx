import { useI18n } from '../../../hooks/use-i18n.js';

export function MaterialsView() {
  const { t } = useI18n();

  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {t('view.materialsPlaceholder')}
    </div>
  );
}
