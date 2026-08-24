import { AlertTriangle, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { PromptAssemblyRecord } from '@lucid-fin/contracts';
import { getAPI } from '../../utils/api.js';

export function PromptAssemblyProvenance({
  assemblyId,
  t,
}: {
  assemblyId: string;
  t: (key: string) => string;
}) {
  const [record, setRecord] = useState<PromptAssemblyRecord | null>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (record !== undefined || loading) return;
    setLoading(true);
    setError(undefined);
    try {
      const api = getAPI();
      if (!api?.promptAssembly?.get) throw new Error(t('inspector.provenanceUnavailable'));
      const result = await api.promptAssembly.get(assemblyId);
      if (!result) throw new Error(t('inspector.provenanceNotFound'));
      setRecord(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  return (
    <details
      className="group/provenance rounded-md border border-border/50 bg-background/35"
      onToggle={(event) => {
        if (event.currentTarget.open) void load();
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 font-medium text-foreground">
        <ChevronRight className="h-3 w-3 transition-transform group-open/provenance:rotate-90" />
        {t('inspector.promptProvenance')}
      </summary>
      <div className="space-y-2 border-t border-border/40 px-2.5 py-2" aria-live="polite">
        {loading ? <p className="text-muted-foreground">{t('action.loading')}</p> : null}
        {error ? (
          <div className="flex items-start gap-1.5 text-destructive">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            <p className="break-words">{error}</p>
          </div>
        ) : null}
        {record?.output ? (
          <>
            <p className="leading-4 text-foreground">{record.output.summary}</p>
            {record.output.warnings.length > 0 ? (
              <ul className="list-disc space-y-1 pl-4 text-amber-300">
                {record.output.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <ul className="space-y-1.5">
              {record.input.sources.map((source) => {
                const decision = record.output?.sourceDecisions.find(
                  (candidate) => candidate.sourceId === source.sourceId,
                );
                return (
                  <li key={source.sourceId} className="rounded bg-muted/35 px-2 py-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-words font-medium text-foreground">
                        {source.label}
                      </span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {decision?.disposition ?? t('inspector.provenanceUnknown')}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{source.kind}</p>
                    {decision?.reason ? (
                      <p className="mt-1 break-words text-muted-foreground">{decision.reason}</p>
                    ) : null}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
                        {t('inspector.sourceContent')}
                      </summary>
                      <p className="mt-1 whitespace-pre-wrap break-words rounded bg-background/60 p-1.5 leading-4 text-foreground">
                        {source.content}
                      </p>
                    </details>
                  </li>
                );
              })}
            </ul>
            <details>
              <summary className="cursor-pointer text-[10px] text-muted-foreground hover:text-foreground">
                {t('inspector.technicalDetails')}
              </summary>
              <dl className="mt-1 grid grid-cols-[auto,1fr] gap-x-2 gap-y-1 break-all font-mono text-[10px] text-muted-foreground">
                <dt>ID</dt>
                <dd>{record.id}</dd>
                <dt>{t('inspector.parentPrompt')}</dt>
                <dd>{record.parentAssemblyId ?? '—'}</dd>
                <dt>{t('inspector.inputHash')}</dt>
                <dd>{record.inputHash}</dd>
              </dl>
            </details>
          </>
        ) : null}
      </div>
    </details>
  );
}
