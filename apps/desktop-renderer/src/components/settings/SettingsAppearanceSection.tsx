import { Globe, Moon, Sun } from 'lucide-react';
import { t, type Locale } from '../../i18n.js';
import type { Theme } from '../../store/slices/ui.js';

interface SettingsAppearanceSectionProps {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  onThemeChange: (theme: Theme) => void;
  theme: Theme;
}

export function SettingsAppearanceSection({
  locale,
  onLocaleChange,
  onThemeChange,
  theme,
}: SettingsAppearanceSectionProps) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-sm font-medium text-muted-foreground">
        {t('settings.appearance.title')}
      </h2>
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium">
            {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            {t('settings.appearance.theme')}
          </div>
          <div className="flex overflow-hidden rounded-lg border border-border text-sm">
            <button
              type="button"
              onClick={() => onThemeChange('light')}
              className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                theme === 'light'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Sun className="h-3.5 w-3.5" />
              {t('settings.appearance.light')}
            </button>
            <button
              type="button"
              onClick={() => onThemeChange('dark')}
              className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                theme === 'dark'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Moon className="h-3.5 w-3.5" />
              {t('settings.appearance.dark')}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Globe className="h-4 w-4" />
            {t('settings.appearance.language')}
          </div>
          <div className="flex overflow-hidden rounded-lg border border-border text-sm">
            <button
              type="button"
              onClick={() => onLocaleChange('zh-CN')}
              className={`px-3 py-1.5 transition-colors ${
                locale === 'zh-CN'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {t('settings.appearance.chinese')}
            </button>
            <button
              type="button"
              onClick={() => onLocaleChange('en-US')}
              className={`px-3 py-1.5 transition-colors ${
                locale === 'en-US'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {t('settings.appearance.english')}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
