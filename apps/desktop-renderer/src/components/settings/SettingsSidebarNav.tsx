import { BarChart3, Bot, Cpu, FileText, HardDrive, Info, ListTree, Sun } from 'lucide-react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/index.js';
import { t } from '../../i18n.js';
import { cn } from '../../lib/utils.js';

export type SettingsTab =
  | 'commander'
  | 'providers'
  | 'guides'
  | 'processGuides'
  | 'appearance'
  | 'storage'
  | 'usage'
  | 'about';

const TAB_ORDER: SettingsTab[] = [
  'commander', 'providers', 'guides', 'processGuides',
  'appearance', 'storage', 'usage', 'about',
];

export const SETTINGS_TAB_META: Record<
  SettingsTab,
  {
    labelKey: string;
    fallbackLabel: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  commander: { labelKey: 'settings.nav.commander', fallbackLabel: 'Commander AI', icon: Bot },
  providers: { labelKey: 'settings.nav.providers', fallbackLabel: 'Providers', icon: Cpu },
  guides: {
    labelKey: 'settings.nav.guides',
    fallbackLabel: 'Guides',
    icon: FileText,
  },
  processGuides: {
    labelKey: 'settings.nav.processGuides',
    fallbackLabel: 'Process Injection',
    icon: ListTree,
  },
  appearance: { labelKey: 'settings.nav.appearance', fallbackLabel: 'Appearance', icon: Sun },
  storage: { labelKey: 'settings.nav.storage', fallbackLabel: 'Storage', icon: HardDrive },
  usage: { labelKey: 'settings.nav.usage', fallbackLabel: 'Usage', icon: BarChart3 },
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
  const availableUpdate = useSelector((s: RootState) => s.settings.availableUpdate);

  return (
    <nav
      aria-label={translateOrFallback('settings.nav.title', 'Settings sections')}
      className="md:w-56 md:shrink-0"
    >
      <div className="rounded-lg border border-border/60 bg-card p-1.5">
        <div className="grid grid-cols-2 gap-1 md:grid-cols-1">
          {TAB_ORDER.map((tab) => {
            const meta = SETTINGS_TAB_META[tab];
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
                {tab === 'about' && availableUpdate && !isActive && (
                  <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-primary animate-pulse" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
