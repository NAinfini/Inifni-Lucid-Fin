import { Globe, Monitor, Moon, Sun } from 'lucide-react';
import { t, type Locale } from '../../i18n.js';
import { resolveEffectiveTheme, type Theme } from '../../store/slices/ui.js';

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
  const effective = resolveEffectiveTheme(theme);
  const themeIcon = theme === 'auto'
    ? <Monitor className="h-3.5 w-3.5" />
    : effective === 'dark'
      ? <Moon className="h-3.5 w-3.5" />
      : <Sun className="h-3.5 w-3.5" />;

  const themeButton = (value: Theme, label: string, icon: React.ReactNode) => (
    <button
      key={value}
      type="button"
      onClick={() => onThemeChange(value)}
      className={`flex items-center gap-1 px-2.5 py-1 transition-colors ${
        theme === value
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-muted'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <section className="mb-6">
      <div className="space-y-3 rounded-md border border-border/60 bg-card p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            {themeIcon}
            {t('settings.appearance.theme')}
          </div>
          <div className="flex overflow-hidden rounded-md border border-border/60 text-xs">
            {themeButton('light', t('settings.appearance.light'), <Sun className="h-3 w-3" />)}
            {themeButton('dark', t('settings.appearance.dark'), <Moon className="h-3 w-3" />)}
            {themeButton('auto', t('settings.appearance.auto'), <Monitor className="h-3 w-3" />)}
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
