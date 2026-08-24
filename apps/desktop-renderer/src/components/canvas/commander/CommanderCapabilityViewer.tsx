import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { CatalogFrozenEvent } from '@lucid-fin/contracts';

interface CommanderCapabilityViewerProps {
  catalog: CatalogFrozenEvent;
  id: string;
  t: (key: string) => string;
}

export function CommanderCapabilityViewer({ catalog, id, t }: CommanderCapabilityViewerProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const tools = useMemo(
    () =>
      normalizedQuery
        ? catalog.tools.filter((tool) =>
            [tool.name, tool.description, ...tool.tags, ...tool.contexts]
              .join('\n')
              .toLowerCase()
              .includes(normalizedQuery),
          )
        : catalog.tools,
    [catalog.tools, normalizedQuery],
  );

  return (
    <section
      id={id}
      aria-label={t('commander.capabilities.title')}
      className="border-t border-border/60 bg-surface/20"
    >
      <div className="flex items-center justify-between px-4 py-2.5">
        <h2 className="text-xs font-semibold text-foreground">
          {t('commander.capabilities.title')}
        </h2>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {catalog.tools.length}
        </span>
      </div>

      <label className="relative block border-y border-border/60 px-3 py-2">
        <span className="sr-only">{t('commander.capabilities.search')}</span>
        <Search
          className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('commander.capabilities.search')}
          className="h-8 w-full rounded-md border border-border/70 bg-background/60 pl-9 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </label>

      <div className="max-h-56 overflow-y-auto" role="list">
        {tools.length > 0 ? (
          tools.map((tool) => (
            <div
              key={tool.name}
              role="listitem"
              className="border-b border-border/40 px-4 py-2.5 last:border-b-0"
            >
              <div className="flex items-start justify-between gap-3">
                <code className="min-w-0 break-all text-xs font-medium text-foreground">
                  {tool.name}
                </code>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {t(`commander.capabilities.tier.${tool.tier}`)}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {tool.description}
              </p>
            </div>
          ))
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {t('commander.capabilities.noMatches')}
          </p>
        )}
      </div>
    </section>
  );
}
