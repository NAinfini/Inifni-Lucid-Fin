import { LazyDetails } from '../../LazyDetails.js';
import type { InspectorSectionProps } from '../inspector-registry.js';
import type { ImageNodeData, VideoNodeData, AudioNodeData } from '@lucid-fin/contracts';

interface HistoryEntry {
  assetHash: string;
  prompt: string;
  providerId: string;
  seed?: number;
  cost?: number;
  createdAt: number;
}

/**
 * Generation History section (M10) -- renders for generation nodes
 * that have at least one history entry.
 */
export function GenerationHistorySection({ node, t }: InspectorSectionProps) {
  const generationData = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  const history: HistoryEntry[] =
    (generationData as { generationHistory?: HistoryEntry[] }).generationHistory ?? [];

  if (history.length === 0) return null;

  return (
    <div className="px-3 py-2 border-b border-border/60">
      <LazyDetails
        className="group"
        summary={
          <summary className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider select-none">
            <span className="transition-transform group-open:rotate-90">&#9654;</span>
            {t('inspector.generationHistory')} ({history.length})
          </summary>
        }
      >
        <div className="mt-1.5 max-h-[160px] overflow-auto space-y-1">
          {history
            .slice()
            .reverse()
            .slice(0, 20)
            .map((entry, i) => (
              <div
                key={`${entry.assetHash}-${i}`}
                className="rounded-md border border-border/40 bg-muted/20 px-2 py-1 text-[10px]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground truncate">
                    {entry.providerId}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-muted-foreground truncate">
                  {entry.prompt.slice(0, 80)}
                  {entry.prompt.length > 80 ? '...' : ''}
                </div>
                {entry.cost != null && (
                  <span className="text-muted-foreground">${entry.cost.toFixed(3)}</span>
                )}
              </div>
            ))}
        </div>
      </LazyDetails>
    </div>
  );
}
