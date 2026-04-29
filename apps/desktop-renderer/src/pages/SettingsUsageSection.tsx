import { useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../store/index.js';
import type { UsageStats } from '../store/slices/settings.js';
import { t } from '../i18n.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tr(key: string, fallback: string): string {
  const v = t(key);
  return v === key ? fallback : v;
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function fmtRelDate(iso: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 30) return `${diff}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function dateRange(days: number): string[] {
  const result: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    result.push(d.toISOString().slice(0, 10));
  }
  return result;
}

function sumDaily(record: Record<string, number>, dates: string[]): number {
  return dates.reduce((sum, d) => sum + (record[d] ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Time filter
// ---------------------------------------------------------------------------

type TimeRange = '1d' | '7d' | '30d' | 'all';

const TIME_TABS: { value: TimeRange; labelKey: string; fallback: string }[] = [
  { value: '1d', labelKey: 'settings.usage.timeToday', fallback: 'Today' },
  { value: '7d', labelKey: 'settings.usage.time7d', fallback: '7 Days' },
  { value: '30d', labelKey: 'settings.usage.time30d', fallback: '30 Days' },
  { value: 'all', labelKey: 'settings.usage.timeAll', fallback: 'All' },
];

function getDays(range: TimeRange): number {
  switch (range) {
    case '1d':
      return 1;
    case '7d':
      return 7;
    case '30d':
      return 30;
    case 'all':
      return 365;
  }
}

// ---------------------------------------------------------------------------
// SVG Line Chart
// ---------------------------------------------------------------------------

function LineChart({
  data,
  dates,
  color = 'hsl(var(--primary))',
  height = 120,
}: {
  data: Record<string, number>;
  dates: string[];
  color?: string;
  height?: number;
}) {
  const values = dates.map((d) => data[d] ?? 0);
  const max = Math.max(1, ...values);
  const n = dates.length;
  // When n === 1 we still need a non-zero width so points can render.
  const vbW = Math.max(1, n - 1);
  const viewBox = `0 0 ${vbW} ${height}`;

  if (values.every((v) => v === 0)) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground"
        style={{ height }}
      >
        {tr('settings.usage.noData', 'No data')}
      </div>
    );
  }

  const yOf = (v: number) => height - (v / max) * (height - 20);
  const xOf = (i: number) => (n === 1 ? vbW / 2 : i);
  const points = values.map((v, i) => `${xOf(i)},${yOf(v)}`).join(' ');
  const areaPoints = `${xOf(0)},${height} ${points} ${xOf(n - 1)},${height}`;

  // Y-axis labels
  const yLabels = [0, Math.round(max / 2), max];

  return (
    <div className="relative" style={{ height }}>
      {/* Y-axis labels */}
      <div
        className="absolute left-0 top-0 flex h-full flex-col justify-between text-[9px] text-muted-foreground tabular-nums"
        style={{ width: 40 }}
      >
        <span>{fmtNum(max)}</span>
        <span>{fmtNum(yLabels[1])}</span>
        <span>0</span>
      </div>
      <div className="ml-10 relative h-full w-[calc(100%-40px)]">
        <svg
          viewBox={viewBox}
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
        >
          <polygon points={areaPoints} fill={color} opacity="0.1" />
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {/* Data-point dots — rendered as DOM elements so they stay circular
            regardless of the SVG's non-uniform stretch. Positioned in % of the
            plot area, offset by half their pixel size to center on the point. */}
        {values.map((v, i) =>
          v > 0 ? (
            <span
              key={i}
              className="pointer-events-none absolute block h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: color,
                left: `calc(${n === 1 ? 50 : (i / (n - 1)) * 100}% - 3px)`,
                top: `calc(${(yOf(v) / height) * 100}% - 3px)`,
              }}
            />
          ) : null,
        )}
      </div>
      {/* X-axis labels */}
      <div className="ml-10 flex justify-between text-[9px] text-muted-foreground mt-1">
        <span>{dates[0]?.slice(5)}</span>
        {dates.length > 7 && <span>{dates[Math.floor(dates.length / 2)]?.slice(5)}</span>}
        <span>{dates[dates.length - 1]?.slice(5)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  subtitle,
}: {
  label: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums mt-0.5">
        {typeof value === 'number' ? fmtNum(value) : value}
      </p>
      {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool Frequency Table
// ---------------------------------------------------------------------------

function ToolTable({
  toolFrequency,
  toolErrors,
  totalCalls,
}: {
  toolFrequency: Record<string, number>;
  toolErrors: Record<string, number>;
  totalCalls: number;
}) {
  const [sortBy, setSortBy] = useState<'count' | 'errors' | 'name'>('count');
  const [expanded, setExpanded] = useState(false);

  const entries = useMemo(() => {
    const items = Object.entries(toolFrequency).map(([name, count]) => ({
      name,
      count,
      errors: toolErrors[name] ?? 0,
      pct: totalCalls > 0 ? (count / totalCalls) * 100 : 0,
    }));
    items.sort((a, b) => {
      if (sortBy === 'count') return b.count - a.count;
      if (sortBy === 'errors') return b.errors - a.errors;
      return a.name.localeCompare(b.name);
    });
    return items;
  }, [toolFrequency, toolErrors, totalCalls, sortBy]);

  const shown = expanded ? entries : entries.slice(0, 15);

  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{tr('settings.usage.noData', 'No data')}</p>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border/40 text-muted-foreground">
            <th className="py-1.5 text-left font-medium">#</th>
            <th
              className="py-1.5 text-left font-medium cursor-pointer hover:text-foreground"
              onClick={() => setSortBy('name')}
            >
              {tr('settings.usage.toolName', 'Tool')} {sortBy === 'name' ? '↑' : ''}
            </th>
            <th
              className="py-1.5 text-right font-medium cursor-pointer hover:text-foreground"
              onClick={() => setSortBy('count')}
            >
              {tr('settings.usage.calls', 'Calls')} {sortBy === 'count' ? '↓' : ''}
            </th>
            <th
              className="py-1.5 text-right font-medium cursor-pointer hover:text-foreground"
              onClick={() => setSortBy('errors')}
            >
              {tr('settings.usage.errors', 'Errors')} {sortBy === 'errors' ? '↓' : ''}
            </th>
            <th className="py-1.5 text-right font-medium">{tr('settings.usage.share', 'Share')}</th>
            <th className="py-1.5 w-24 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((item, i) => (
            <tr key={item.name} className="border-b border-border/20 last:border-0">
              <td className="py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
              <td className="py-1.5 font-mono">{item.name}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtNum(item.count)}</td>
              <td className="py-1.5 text-right tabular-nums">
                {item.errors > 0 ? <span className="text-destructive">{item.errors}</span> : '0'}
              </td>
              <td className="py-1.5 text-right tabular-nums">{item.pct.toFixed(1)}%</td>
              <td className="py-1.5 px-2">
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${item.pct}%` }}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length > 15 && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-[10px] text-primary hover:underline"
        >
          {expanded
            ? tr('settings.usage.showLess', 'Show less')
            : `${tr('settings.usage.showAll', 'Show all')} (${entries.length})`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Provider Table
// ---------------------------------------------------------------------------

function ProviderTable({ usage }: { usage: UsageStats }) {
  const entries = Object.entries(usage.providerUsage);
  if (entries.length === 0) return null;

  const totalRequests = entries.reduce((sum, [, s]) => sum + s.requestCount, 0);

  return (
    <div className="rounded-lg border border-border/60 bg-card p-3">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border/40 text-muted-foreground">
            <th className="py-1.5 text-left font-medium">#</th>
            <th className="py-1.5 text-left font-medium">
              {tr('settings.usage.provider', 'Provider')}
            </th>
            <th className="py-1.5 text-right font-medium">
              {tr('settings.usage.requests', 'Requests')}
            </th>
            <th className="py-1.5 text-right font-medium">
              {tr('settings.usage.totalTokens', 'Tokens')}
            </th>
            <th className="py-1.5 text-right font-medium">
              {tr('settings.usage.avgLatency', 'Avg Latency')}
            </th>
            <th className="py-1.5 text-right font-medium">
              {tr('settings.usage.errors', 'Errors')}
            </th>
            <th className="py-1.5 text-right font-medium">{tr('settings.usage.share', 'Share')}</th>
            <th className="py-1.5 text-right font-medium">
              {tr('settings.usage.lastUsed', 'Last Used')}
            </th>
          </tr>
        </thead>
        <tbody>
          {entries
            .sort(([, a], [, b]) => b.requestCount - a.requestCount)
            .map(([id, stats], i) => {
              const tokens = usage.tokensByProvider[id];
              const pct = totalRequests > 0 ? (stats.requestCount / totalRequests) * 100 : 0;
              return (
                <tr key={id} className="border-b border-border/20 last:border-0">
                  <td className="py-1.5 text-muted-foreground tabular-nums">{i + 1}</td>
                  <td className="py-1.5 font-mono font-medium">{id}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtNum(stats.requestCount)}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {tokens ? (
                      <span title={`In: ${fmtNum(tokens.input)} / Out: ${fmtNum(tokens.output)}`}>
                        {fmtNum(tokens.input + tokens.output)}
                        <span className="text-muted-foreground ml-1 text-[9px]">
                          ↑{fmtNum(tokens.input)} ↓{fmtNum(tokens.output)}
                        </span>
                      </span>
                    ) : (
                      '-'
                    )}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {Math.round(stats.avgLatencyMs)}ms
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {stats.errorCount > 0 ? (
                      <span className="text-destructive">{stats.errorCount}</span>
                    ) : (
                      '0'
                    )}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{pct.toFixed(1)}%</td>
                  <td className="py-1.5 text-right text-muted-foreground">
                    {fmtRelDate(stats.lastUsed)}
                  </td>
                </tr>
              );
            })}
        </tbody>
        {entries.length > 1 && (
          <tfoot>
            <tr className="border-t border-border/60 font-medium">
              <td className="py-1.5" colSpan={2}>
                {tr('settings.usage.total', 'Total')}
              </td>
              <td className="py-1.5 text-right tabular-nums">{fmtNum(totalRequests)}</td>
              <td className="py-1.5 text-right tabular-nums">
                {fmtNum(usage.totalInputTokens + usage.totalOutputTokens)}
                <span className="text-muted-foreground ml-1 text-[9px]">
                  ↑{fmtNum(usage.totalInputTokens)} ↓{fmtNum(usage.totalOutputTokens)}
                </span>
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {totalRequests > 0
                  ? `${Math.round(entries.reduce((s, [, st]) => s + st.avgLatencyMs * st.requestCount, 0) / totalRequests)}ms`
                  : '-'}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {entries.reduce((s, [, st]) => s + st.errorCount, 0)}
              </td>
              <td className="py-1.5 text-right">100%</td>
              <td></td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chart tab selector
// ---------------------------------------------------------------------------

type ChartMetric = 'toolCalls' | 'generations' | 'sessions' | 'prompts' | 'tokens' | 'active';

const CHART_TABS: { value: ChartMetric; labelKey: string; fallback: string }[] = [
  { value: 'toolCalls', labelKey: 'settings.usage.chartToolCalls', fallback: 'Tool Calls' },
  { value: 'sessions', labelKey: 'settings.usage.chartSessions', fallback: 'Sessions' },
  { value: 'generations', labelKey: 'settings.usage.chartGenerations', fallback: 'Generations' },
  { value: 'tokens', labelKey: 'settings.usage.chartTokens', fallback: 'Tokens' },
  { value: 'prompts', labelKey: 'settings.usage.chartPrompts', fallback: 'Prompts' },
  { value: 'active', labelKey: 'settings.usage.chartActive', fallback: 'Active Time' },
];

function getChartData(usage: UsageStats, metric: ChartMetric): Record<string, number> {
  switch (metric) {
    case 'toolCalls':
      return usage.dailyToolCalls;
    case 'generations':
      return usage.dailyGenerations;
    case 'sessions':
      return usage.dailySessions;
    case 'prompts':
      return usage.dailyPrompts;
    case 'tokens':
      return usage.dailyTokensUsed;
    case 'active':
      return usage.dailyActiveMinutes;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function SettingsUsageSection() {
  const usage = useSelector((state: RootState) => state.settings.usage);
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [chartMetric, setChartMetric] = useState<ChartMetric>('toolCalls');

  const days = getDays(timeRange);
  const dates = useMemo(() => dateRange(days), [days]);

  const totalGenerations = Object.values(usage.generationCount).reduce((sum, n) => sum + n, 0);
  const totalTokens = usage.totalInputTokens + usage.totalOutputTokens;
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayTokens = usage.dailyTokensUsed[todayStr] ?? 0;
  const todayTools = usage.dailyToolCalls[todayStr] ?? 0;

  return (
    <div className="space-y-6">
      {/* Time Range Filter */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-lg border border-border/60 p-0.5">
          {TIME_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setTimeRange(tab.value)}
              className={`rounded-md px-3 py-1 text-[11px] font-medium transition-colors ${
                timeRange === tab.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {tr(tab.labelKey, tab.fallback)}
            </button>
          ))}
        </div>
      </div>

      {/* Overview Stat Cards */}
      <Section title={tr('settings.usage.overview', 'Overview')}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatCard
            label={tr('settings.usage.totalSessions', 'Total Sessions')}
            value={timeRange === 'all' ? usage.sessionCount : sumDaily(usage.dailySessions, dates)}
            subtitle={`${usage.failedSessions} ${tr('settings.usage.failed', 'failed')}`}
          />
          <StatCard
            label={tr('settings.usage.totalToolCalls', 'Tool Calls')}
            value={
              timeRange === 'all' ? usage.totalToolCalls : sumDaily(usage.dailyToolCalls, dates)
            }
            subtitle={`${tr('settings.usage.today', 'Today')}: ${todayTools}`}
          />
          <StatCard
            label={tr('settings.usage.totalGenerations', 'Generations')}
            value={timeRange === 'all' ? totalGenerations : sumDaily(usage.dailyGenerations, dates)}
          />
          <StatCard
            label={tr('settings.usage.totalTokens', 'Tokens')}
            value={fmtNum(
              timeRange === 'all' ? totalTokens : sumDaily(usage.dailyTokensUsed, dates),
            )}
            subtitle={`${tr('settings.usage.today', 'Today')}: ${fmtNum(todayTokens)}`}
          />
          <StatCard
            label={tr('settings.usage.usageTime', 'Usage Time')}
            value={fmtDuration(
              timeRange === 'all'
                ? sumDaily(usage.dailyActiveMinutes, dateRange(365)) * 60_000
                : sumDaily(usage.dailyActiveMinutes, dates) * 60_000,
            )}
          />
        </div>
      </Section>

      {/* Charts: Full-width Line Chart + Heatmap */}
      <div className="space-y-3">
        {/* Line Chart — full width, prominent */}
        <div className="rounded-lg border border-border/60 bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-medium">{tr('settings.usage.trendChart', 'Trend')}</h4>
            <div className="flex gap-0.5 rounded-md border border-border/40 p-0.5">
              {CHART_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setChartMetric(tab.value)}
                  className={`rounded px-2 py-0.5 text-[10px] transition-colors ${
                    chartMetric === tab.value
                      ? 'bg-primary/20 text-primary font-medium'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tr(tab.labelKey, tab.fallback)}
                </button>
              ))}
            </div>
          </div>
          <LineChart data={getChartData(usage, chartMetric)} dates={dates} height={180} />
        </div>
      </div>

      {/* Provider Analytics */}
      <Section title={tr('settings.usage.providerAnalytics', 'Provider Analytics')}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard
            label={tr('settings.usage.inputTokens', 'Input Tokens')}
            value={fmtNum(usage.totalInputTokens)}
          />
          <StatCard
            label={tr('settings.usage.outputTokens', 'Output Tokens')}
            value={fmtNum(usage.totalOutputTokens)}
          />
          <StatCard
            label={tr('settings.usage.avgLatency', 'Avg Latency')}
            value={(() => {
              const entries = Object.values(usage.providerUsage);
              const total = entries.reduce((s, e) => s + e.avgLatencyMs * e.requestCount, 0);
              const count = entries.reduce((s, e) => s + e.requestCount, 0);
              return count > 0 ? `${Math.round(total / count)}ms` : '-';
            })()}
          />
          <StatCard
            label={tr('settings.usage.totalPrompts', 'Prompts Written')}
            value={usage.totalPromptsWritten}
            subtitle={
              usage.totalPromptsWritten > 0
                ? `${tr('settings.usage.avgWords', 'Avg')}: ${Math.round(usage.totalPromptWords / usage.totalPromptsWritten)} ${tr('settings.usage.words', 'words')}`
                : undefined
            }
          />
        </div>
        <ProviderTable usage={usage} />
      </Section>

      {/* Tool Usage */}
      <Section title={tr('settings.usage.toolUsage', 'Tool Usage')}>
        <ToolTable
          toolFrequency={usage.toolFrequency}
          toolErrors={usage.toolErrors}
          totalCalls={usage.totalToolCalls}
        />
      </Section>

      {/* Commander AI */}
      <Section title={tr('settings.usage.commander', 'Commander AI')}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatCard
            label={tr('settings.usage.successful', 'Successful')}
            value={usage.sessionCount - usage.cancelledSessions - usage.failedSessions}
          />
          <StatCard label={tr('settings.usage.failed', 'Failed')} value={usage.failedSessions} />
          <StatCard
            label={tr('settings.usage.cancelled', 'Cancelled')}
            value={usage.cancelledSessions}
          />
          <StatCard
            label={tr('settings.usage.avgTurns', 'Avg Turns/Session')}
            value={usage.avgTurnsPerSession.toFixed(1)}
          />
          <StatCard
            label={tr('settings.usage.avgTools', 'Avg Tools/Session')}
            value={usage.avgToolsPerSession.toFixed(1)}
          />
        </div>
      </Section>

      {/* Creation Activity */}
      <Section title={tr('settings.usage.canvasActivity', 'Creation Activity')}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          <StatCard
            label={tr('settings.usage.shotsCreated', 'Shots')}
            value={usage.totalShotsCreated}
          />
          <StatCard
            label={tr('settings.usage.scenesCreated', 'Scenes')}
            value={usage.totalScenesCreated}
          />
          <StatCard label={tr('settings.usage.nodesCreated', 'Nodes')} value={usage.nodesCreated} />
          <StatCard label={tr('settings.usage.edgesCreated', 'Edges')} value={usage.edgesCreated} />
          <StatCard
            label={tr('settings.usage.characters', 'Characters')}
            value={usage.charactersCreated}
          />
          <StatCard
            label={tr('settings.usage.locations', 'Locations')}
            value={usage.locationsCreated}
          />
          <StatCard
            label={tr('settings.usage.equipment', 'Equipment')}
            value={usage.equipmentCreated}
          />
          <StatCard
            label={tr('settings.usage.entityEdits', 'Entity Edits')}
            value={usage.entityEdits}
          />
        </div>
      </Section>

      {/* Workflow & Misc */}
      <Section title={tr('settings.usage.workflow', 'Workflow')}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatCard label={tr('settings.usage.undos', 'Undos')} value={usage.undoCount} />
          <StatCard label={tr('settings.usage.redos', 'Redos')} value={usage.redoCount} />
          <StatCard
            label={tr('settings.usage.presetChanges', 'Preset Changes')}
            value={usage.presetChanges}
          />
          <StatCard label={tr('settings.usage.exports', 'Exports')} value={usage.totalExports} />
          <StatCard
            label={tr('settings.usage.snapshotsUsed', 'Snapshots')}
            value={usage.snapshotsUsed}
          />
        </div>
      </Section>

      {/* First/Last Active */}
      {usage.firstUsedDate && (
        <div className="text-[10px] text-muted-foreground text-right">
          {tr('settings.usage.firstUsed', 'First used')}: {usage.firstUsedDate}
          {usage.lastActiveDate &&
            ` · ${tr('settings.usage.lastActive', 'Last active')}: ${usage.lastActiveDate}`}
        </div>
      )}
    </div>
  );
}
