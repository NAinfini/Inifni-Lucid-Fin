import { Bot, Cpu, FileText, HardDrive, Info, Sun, Workflow } from 'lucide-react';
import { t } from '../../i18n.js';
import { cn } from '../../lib/utils.js';

export type SettingsTab = 'providers' | 'commander' | 'appearance' | 'storage' | 'promptTemplates' | 'workflows' | 'about';

export const SETTINGS_TAB_META: Record<
  SettingsTab,
  {
    labelKey: string;
    fallbackLabel: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  providers: { labelKey: 'settings.nav.providers', fallbackLabel: 'Providers', icon: Cpu },
  commander: { labelKey: 'settings.nav.commander', fallbackLabel: 'Commander AI', icon: Bot },
  appearance: { labelKey: 'settings.nav.appearance', fallbackLabel: 'Appearance', icon: Sun },
  storage: { labelKey: 'settings.nav.storage', fallbackLabel: 'Storage', icon: HardDrive },
  promptTemplates: {
    labelKey: 'settings.nav.promptTemplates',
    fallbackLabel: 'Prompt Templates',
    icon: FileText,
  },
  workflows: { labelKey: 'settings.nav.workflows', fallbackLabel: 'Workflows', icon: Workflow },
  about: { labelKey: 'settings.nav.about', fallbackLabel: 'About', icon: Info },
};

export function translateOrFallback(key: string, fallback: string): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

interface SettingsSidebarNavProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

export function SettingsSidebarNav({ activeTab, onTabChange }: SettingsSidebarNavProps) {
  return (
    <nav
      aria-label={translateOrFallback('settings.nav.title', 'Settings sections')}
      className="md:w-56 md:shrink-0"
    >
      <div className="rounded-lg border border-border/60 bg-card p-1.5">
        <div className="grid grid-cols-2 gap-1 md:grid-cols-1">
          {(Object.entries(SETTINGS_TAB_META) as Array<
            [SettingsTab, (typeof SETTINGS_TAB_META)[SettingsTab]]
          >).map(([tab, meta]) => {
            const Icon = meta.icon;
            const isActive = activeTab === tab;

            return (
              <button
                key={tab}
                type="button"
                onClick={() => onTabChange(tab)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {translateOrFallback(meta.labelKey, meta.fallbackLabel)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
