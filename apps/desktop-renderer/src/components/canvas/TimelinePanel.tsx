import { ChevronDown } from 'lucide-react';
import { t } from '../../i18n.js';
import { TimelineEditor } from '../../pages/TimelineEditor.js';

/** @deprecated Timeline feature has been removed from the main canvas layout. */
export function TimelinePanel() {
  return (
    <div className="relative flex h-full flex-col">
      <button
        type="button"
        aria-label={t('timeline.collapse')}
        className="absolute right-2 top-1.5 z-10 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      <TimelineEditor />
    </div>
  );
}
