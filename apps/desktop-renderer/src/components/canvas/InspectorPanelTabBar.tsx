import { cn } from '../../lib/utils.js';

export type InspectorPanelTab = 'creative' | 'context' | 'technical';

interface InspectorPanelTabBarProps {
  activeTab: InspectorPanelTab;
  contextBadgeCount: number;
  labels: Record<InspectorPanelTab, string>;
  onChange: (tab: InspectorPanelTab) => void;
}

const INSPECTOR_PANEL_TABS: InspectorPanelTab[] = ['creative', 'technical', 'context'];

export function InspectorPanelTabBar({
  activeTab,
  contextBadgeCount,
  labels,
  onChange,
}: InspectorPanelTabBarProps) {
  return (
    <div className="flex shrink-0 items-center gap-0 border-b border-border/60 px-3">
      {INSPECTOR_PANEL_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={cn(
            'relative px-2.5 py-1.5 text-[11px] font-medium transition-colors',
            activeTab === tab
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground/70',
          )}
        >
          {labels[tab]}
          {tab === 'context' && contextBadgeCount > 0 ? (
            <span className="ml-1 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-primary/15 px-1 text-[9px] font-bold leading-none text-primary">
              {contextBadgeCount}
            </span>
          ) : null}
          {activeTab === tab ? (
            <span className="absolute bottom-0 left-2.5 right-2.5 h-0.5 rounded-t bg-primary" />
          ) : null}
        </button>
      ))}
    </div>
  );
}
