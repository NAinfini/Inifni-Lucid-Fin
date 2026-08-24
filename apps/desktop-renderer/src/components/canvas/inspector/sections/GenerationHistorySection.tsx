import { Check, ChevronRight, Copy } from 'lucide-react';
import { useState } from 'react';
import { LazyDetails } from '../../LazyDetails.js';
import { getLocale } from '../../../../i18n.js';
import type { InspectorSectionProps } from '../inspector-registry.js';
import type {
  AudioNodeData,
  GenerationHistoryEntry,
  ImageNodeData,
  VideoNodeData,
} from '@lucid-fin/contracts';
import { PromptAssemblyProvenance } from '../../PromptAssemblyProvenance.js';

/**
 * Generation History section (M10) -- renders for generation nodes
 * that have at least one history entry.
 */
export function GenerationHistorySection({ node, t }: InspectorSectionProps) {
  const [copiedId, setCopiedId] = useState<string>();
  const generationData = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
  const history: GenerationHistoryEntry[] = generationData.generationHistory ?? [];

  if (history.length === 0) return null;

  return (
    <div className="px-3 py-2 border-b border-border/60">
      <LazyDetails
        className="group"
        summary={
          <summary className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider select-none">
            <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
            {t('inspector.generationHistory')} ({history.length})
          </summary>
        }
      >
        <div className="mt-2 max-h-[320px] divide-y divide-border/40 overflow-auto rounded-md border border-border/50 bg-muted/10">
          {history
            .slice()
            .reverse()
            .slice(0, 20)
            .map((entry, i) => {
              const entryId = entry.promptAssemblyId ?? `${entry.assetHash}-${i}`;
              return (
                <details key={entryId} className="group/history text-[11px]">
                  <summary className="flex cursor-pointer list-none items-start gap-2 px-2.5 py-2 hover:bg-muted/30">
                    <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open/history:rotate-90" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-medium text-foreground">
                          {entry.providerId}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleTimeString(getLocale())}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
                        {entry.prompt}
                      </p>
                    </div>
                  </summary>
                  <div className="space-y-2 border-t border-border/40 px-3 py-2.5">
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">
                          {t('inspector.finalProviderPrompt')}
                        </span>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={() => {
                            void navigator.clipboard.writeText(entry.prompt).then(() => {
                              setCopiedId(entryId);
                              window.setTimeout(() => setCopiedId(undefined), 1_500);
                            });
                          }}
                        >
                          {copiedId === entryId ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          {copiedId === entryId
                            ? t('inspector.promptCopied')
                            : t('inspector.copyPrompt')}
                        </button>
                      </div>
                      <p className="whitespace-pre-wrap break-words rounded bg-background/60 p-2 text-[10px] leading-4 text-foreground">
                        {entry.prompt}
                      </p>
                    </div>
                    {entry.negativePrompt && (
                      <div>
                        <span className="font-medium text-foreground">
                          {t('inspector.negativePrompt')}
                        </span>
                        <p className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-4 text-muted-foreground">
                          {entry.negativePrompt}
                        </p>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      {entry.promptAssemblyId && (
                        <span className="font-mono" title={entry.promptAssemblyId}>
                          {t('inspector.promptRevision')}: {entry.promptAssemblyId.slice(0, 8)}
                        </span>
                      )}
                      {entry.cost != null && (
                        <span>
                          {new Intl.NumberFormat(getLocale(), {
                            style: 'currency',
                            currency: 'USD',
                            minimumFractionDigits: 3,
                          }).format(entry.cost)}
                        </span>
                      )}
                    </div>
                    {entry.promptAssemblyId ? (
                      <PromptAssemblyProvenance assemblyId={entry.promptAssemblyId} t={t} />
                    ) : null}
                  </div>
                </details>
              );
            })}
        </div>
      </LazyDetails>
    </div>
  );
}
