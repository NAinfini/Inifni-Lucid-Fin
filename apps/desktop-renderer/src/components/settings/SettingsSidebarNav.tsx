import {
  BarChart3,
  Bot,
  ChevronDown,
  Cpu,
  FileText,
  HardDrive,
  Image,
  Info,
  ListTree,
  Sun,
} from 'lucide-react';
import { useState } from 'react';
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
  | 'about'
  | 'canvas';

interface SettingsTabGroup {
  id: string;
  labelKey: string;
  fallbackLabel: string;
  tabs: SettingsTab[];
}

/**
 * Two-group sidebar: program-level settings on top, canvas-scoped
 * settings in a second group below. Canvas tab is always visible but
 * the section itself renders a disabled notice when no canvas is
 * active.
 */
const TAB_GROUPS: SettingsTabGroup[] = [
  {
    id: 'program',
    labelKey: 'settings.nav.groupProgram',
    fallbackLabel: 'Application',
    tabs: ['providers', 'appearance', 'storage', 'usage', 'about'],
  },
  {
    id: 'canvas',
    labelKey: 'settings.nav.groupCanvas',
    fallbackLabel: 'Canvas',
    tabs: ['canvas'],
  },
];

const ADVANCED_TABS: SettingsTab[] = ['commander', 'guides', 'processGuides'];

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
    fallbackLabel: 'Run Guides',
    icon: ListTree,
  },
  appearance: { labelKey: 'settings.nav.appearance', fallbackLabel: 'Appearance', icon: Sun },
  storage: { labelKey: 'settings.nav.storage', fallbackLabel: 'Storage', icon: HardDrive },
  usage: { labelKey: 'settings.nav.usage', fallbackLabel: 'Usage', icon: BarChart3 },
  about: { labelKey: 'settings.nav.about', fallbackLabel: 'About', icon: Info },
  canvas: { labelKey: 'settings.nav.canvas', fallbackLabel: 'Canvas', icon: Image },
};

export function translateOrFallback(key: string, fallback: string): string {
  const translated = t(key);
  return translated === key ? fallback : translated;
}

interface SettingsSidebarNavProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

function SettingsTabButtons({
  activeTab,
  availableUpdate,
  onTabChange,
  tabs,
}: {
  activeTab: SettingsTab;
  availableUpdate: boolean;
  onTabChange: (tab: SettingsTab) => void;
  tabs: SettingsTab[];
}) {
  return (
    <div className="grid grid-cols-2 gap-1 md:grid-cols-1">
      {tabs.map((tab) => {
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
  );
}

export function SettingsSidebarNav({ activeTab, onTabChange }: SettingsSidebarNavProps) {
  const availableUpdate = useSelector((s: RootState) => s.settings.availableUpdate);
  const advancedActive = ADVANCED_TABS.includes(activeTab);
  const [advancedOpen, setAdvancedOpen] = useState(advancedActive);
  const showAdvancedTabs = advancedOpen || advancedActive;

  return (
    <nav
      aria-label={translateOrFallback('settings.nav.title', 'Settings sections')}
      className="md:w-56 md:shrink-0"
    >
      <div className="space-y-3">
        {TAB_GROUPS.map((group) => (
          <div key={group.id} className="rounded-lg border border-border/60 bg-card p-1.5">
            <div className="px-2 pb-1.5 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {translateOrFallback(group.labelKey, group.fallbackLabel)}
            </div>
            <SettingsTabButtons
              activeTab={activeTab}
              availableUpdate={Boolean(availableUpdate)}
              onTabChange={onTabChange}
              tabs={group.tabs}
            />
          </div>
        ))}

        <div className="rounded-lg border border-border/60 bg-card p-1.5">
          <button
            type="button"
            aria-controls="settings-advanced-tabs"
            aria-expanded={showAdvancedTabs}
            onClick={() => setAdvancedOpen((open) => (advancedActive ? true : !open))}
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {translateOrFallback('settings.nav.groupAdvanced', 'Advanced')}
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform duration-200',
                showAdvancedTabs && 'rotate-180',
              )}
            />
          </button>
          {showAdvancedTabs && (
            <div id="settings-advanced-tabs" className="mt-1">
              <SettingsTabButtons
                activeTab={activeTab}
                availableUpdate={Boolean(availableUpdate)}
                onTabChange={onTabChange}
                tabs={ADVANCED_TABS}
              />
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
