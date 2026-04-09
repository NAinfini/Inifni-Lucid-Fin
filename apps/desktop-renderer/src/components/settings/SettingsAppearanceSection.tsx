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
    <section className="mb-6">
      <div className="space-y-3 rounded-md border border-border/60 bg-card p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            {theme === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            {t('settings.appearance.theme')}
          </div>
          <div className="flex overflow-hidden rounded-md border border-border/60 text-xs">
            <button
              type="button"
              onClick={() => onThemeChange('light')}
              className={`flex items-center gap-1 px-2.5 py-1 transition-colors ${
                theme === 'light'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Sun className="h-3 w-3" />
              {t('settings.appearance.light')}
            </button>
            <button
              type="button"
              onClick={() => onThemeChange('dark')}
              className={`flex items-center gap-1 px-2.5 py-1 transition-colors ${
                theme === 'dark'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              <Moon className="h-3 w-3" />
              {t('settings.appearance.dark')}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border/40 pt-3">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Globe className="h-3.5 w-3.5" />
            {t('settings.appearance.language')}
          </div>
          <div className="flex overflow-hidden rounded-md border border-border/60 text-xs">
            <button
              type="button"
              onClick={() => onLocaleChange('zh-CN')}
              className={`px-2.5 py-1 transition-colors ${
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
              className={`px-2.5 py-1 transition-colors ${
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
