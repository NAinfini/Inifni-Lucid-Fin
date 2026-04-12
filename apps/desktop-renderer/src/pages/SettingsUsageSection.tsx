import { useSelector } from 'react-redux';
import type { RootState } from '../store/index.js';
import { t } from '../i18n.js';

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatRelativeDate(iso: string): string {
  try {
    const date = new Date(iso);
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffDays = Math.floor(diffMs / 86_400_000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 30) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch { /* invalid date string — return raw ISO value as fallback */
    return iso;
  }
}

export function SettingsUsageSection() {
  const usage = useSelector((state: RootState) => state.settings.usage);

  const totalGenerations = Object.values(usage.generationCount).reduce((sum, n) => sum + n, 0);
  const successfulSessions =
    usage.sessionCount - usage.cancelledSessions - usage.failedSessions;

  const top10Tools = Object.entries(usage.toolFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const providerEntries = Object.entries(usage.providerUsage);
  const generationEntries = Object.entries(usage.generationCount);

  // Last 90 days heatmap
  const today = new Date();
  const last90Days: string[] = [];
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    last90Days.push(d.toISOString().slice(0, 10));
  }
  const maxMinutes = Math.max(1, ...last90Days.map((d) => usage.dailyActiveMinutes[d] ?? 0));

  return (
    <div className="space-y-8">
      {/* Overview Cards */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">{t('settings.usage.title')}</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('settings.usage.totalSessions')}</p>
            <p className="text-2xl font-semibold tabular-nums">{usage.sessionCount}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('settings.usage.totalToolCalls')}</p>
            <p className="text-2xl font-semibold tabular-nums">{usage.totalToolCalls}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('settings.usage.totalGenerations')}</p>
            <p className="text-2xl font-semibold tabular-nums">{totalGenerations}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('settings.usage.usageTime')}</p>
            <p className="text-2xl font-semibold tabular-nums">
              {formatDuration(usage.totalSessionDurationMs)}
            </p>
          </div>
        </div>
      </div>

      {/* Commander AI Section */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">{t('settings.usage.commander')}</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('settings.usage.successful')}</p>
            <p className="text-2xl font-semibold tabular-nums">{successfulSessions}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('settings.usage.failed')}</p>
            <p className="text-2xl font-semibold tabular-nums">{usage.failedSessions}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('settings.usage.cancelled')}</p>
            <p className="text-2xl font-semibold tabular-nums">{usage.cancelledSessions}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('settings.usage.avgTurns')}</p>
            <p className="text-2xl font-semibold tabular-nums">
              {usage.avgTurnsPerSession.toFixed(1)}
            </p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('settings.usage.avgTools')}</p>
            <p className="text-2xl font-semibold tabular-nums">
              {usage.avgToolsPerSession.toFixed(1)}
            </p>
          </div>
        </div>
        {top10Tools.length > 0 && (
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              {t('settings.usage.topTools')}
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40 text-muted-foreground">
                  <th className="py-1.5 text-left font-medium">Tool</th>
                  <th className="py-1.5 text-right font-medium">Count</th>
                </tr>
              </thead>
              <tbody>
                {top10Tools.map(([name, count]) => (
                  <tr key={name} className="border-b border-border/20 last:border-0">
                    <td className="py-1.5 font-mono">{name}</td>
                    <td className="py-1.5 text-right tabular-nums">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Provider Usage Section */}
      {providerEntries.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">{t('settings.usage.providers')}</h3>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/40 text-muted-foreground">
                  <th className="py-1.5 text-left font-medium">{t('settings.usage.provider')}</th>
                  <th className="py-1.5 text-right font-medium">{t('settings.usage.requests')}</th>
                  <th className="py-1.5 text-right font-medium">
                    {t('settings.usage.avgLatency')}
                  </th>
                  <th className="py-1.5 text-right font-medium">{t('settings.usage.errors')}</th>
                  <th className="py-1.5 text-right font-medium">{t('settings.usage.lastUsed')}</th>
                </tr>
              </thead>
              <tbody>
                {providerEntries.map(([id, stats]) => (
                  <tr key={id} className="border-b border-border/20 last:border-0">
                    <td className="py-1.5 font-mono">{id}</td>
                    <td className="py-1.5 text-right tabular-nums">{stats.requestCount}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {Math.round(stats.avgLatencyMs)}ms
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{stats.errorCount}</td>
                    <td className="py-1.5 text-right">{formatRelativeDate(stats.lastUsed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Generation Stats Section */}
      {generationEntries.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-foreground">
            {t('settings.usage.generations')}
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {generationEntries.map(([type, count]) => {
              const rate = usage.generationSuccessRate[type] ?? 1;
              return (
                <div key={type} className="rounded-lg border border-border/60 bg-card p-4">
                  <p className="text-xs capitalize text-muted-foreground">{type}</p>
                  <p className="text-2xl font-semibold tabular-nums">{count}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('settings.usage.successRate')}: {Math.round(rate * 100)}%
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Project Activity Section */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">
          {t('settings.usage.projectActivity')}
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('settings.usage.nodesCreated')}</p>
            <p className="text-2xl font-semibold tabular-nums">{usage.nodesCreated}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('settings.usage.edgesCreated')}</p>
            <p className="text-2xl font-semibold tabular-nums">{usage.edgesCreated}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('settings.usage.entitiesCreated')}</p>
            <p className="text-2xl font-semibold tabular-nums">{usage.entitiesCreated}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-card p-4">
            <p className="text-xs text-muted-foreground">{t('settings.usage.snapshotsUsed')}</p>
            <p className="text-2xl font-semibold tabular-nums">{usage.snapshotsUsed}</p>
          </div>
        </div>
      </div>

      {/* Activity Heatmap */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-foreground">
          {t('settings.usage.activityHeatmap')}
        </h3>
        <div className="rounded-lg border border-border/60 bg-card p-4">
          {maxMinutes === 1 && last90Days.every((d) => !usage.dailyActiveMinutes[d]) ? (
            <p className="text-xs text-muted-foreground">{t('settings.usage.noData')}</p>
          ) : (
            <div
              className="flex flex-wrap gap-0.5"
              role="img"
              aria-label={t('settings.usage.activityHeatmap')}
            >
              {last90Days.map((date) => {
                const minutes = usage.dailyActiveMinutes[date] ?? 0;
                const intensity = minutes === 0 ? 0 : Math.ceil((minutes / maxMinutes) * 4);
                return (
                  <div
                    key={date}
                    title={`${date}: ${minutes}m`}
                    className="h-3 w-3 rounded-sm"
                    style={{
                      opacity: intensity === 0 ? 0.15 : 0.25 + (intensity / 4) * 0.75,
                      backgroundColor: intensity === 0 ? 'hsl(var(--muted))' : 'hsl(var(--primary))',
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
