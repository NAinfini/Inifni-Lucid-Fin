import { useDispatch, useSelector } from 'react-redux';
import { Bot, Cog, Database, RotateCcw } from 'lucide-react';
import type { RootState } from '../store/index.js';
import { CommitSlider } from '../components/ui/CommitSlider.js';
import {
  setMaxSteps,
  setTemperature,
  setMaxTokens,
  setLlmRetries,
  setMaxSessions,
  setMaxMessagesPerSession,
  setUndoStackDepth,
  setMaxLogEntries,
  setAutoSaveDelayMs,
  setUndoGroupWindowMs,
  setClipboardWatchIntervalMs,
  setClipboardMinLength,
  setGenerationConcurrency,
} from '../store/slices/commander.js';
import { t } from '../i18n.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tr(key: string, fallback: string): string {
  const v = t(key);
  return v === key ? fallback : v;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionCard({
  icon: Icon,
  title,
  onReset,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  onReset?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">{title}</span>
        </div>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            {tr('settings.commander.resetDefaults', 'Reset')}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-border/40 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">{label}</div>
        {description && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">{description}</div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SliderInput({
  value,
  min,
  max,
  step,
  onChange,
  formatValue,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
}) {
  return (
    <div className="flex items-center gap-2">
      <CommitSlider
        min={min}
        max={max}
        step={step}
        value={value}
        onCommit={onChange}
        className="h-1.5 w-28 cursor-pointer accent-primary"
      />
      <span className="w-14 text-right text-xs font-mono text-muted-foreground">
        {formatValue ? formatValue(value) : value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export function SettingsCommanderSection() {
  const dispatch = useDispatch();
  const state = useSelector((s: RootState) => s.commander);

  const handleResetAgent = () => {
    dispatch(setMaxSteps(50));
    dispatch(setTemperature(0.7));
    dispatch(setMaxTokens(200000));
    dispatch(setLlmRetries(2));
  };

  const handleResetData = () => {
    dispatch(setMaxSessions(50));
    dispatch(setMaxMessagesPerSession(200));
    dispatch(setUndoStackDepth(100));
    dispatch(setMaxLogEntries(500));
  };

  const handleResetBehavior = () => {
    dispatch(setAutoSaveDelayMs(500));
    dispatch(setUndoGroupWindowMs(300));
    dispatch(setClipboardWatchIntervalMs(1500));
    dispatch(setClipboardMinLength(100));
    dispatch(setGenerationConcurrency(1));
  };

  return (
    <div className="space-y-6">
      {/* Agent Parameters */}
      <SectionCard icon={Bot} title={tr('settings.commander.agentParams', 'Agent Parameters')} onReset={handleResetAgent}>
        <SettingRow label={tr('settings.commander.maxSteps', 'Max Steps')} description={tr('settings.commander.maxStepsDesc', 'Maximum tool call iterations per request.')}>
          <SliderInput value={state.maxSteps} min={1} max={200} step={1} onChange={(v) => dispatch(setMaxSteps(v))} />
        </SettingRow>
        <SettingRow label={tr('settings.commander.temperature', 'Temperature')} description={tr('settings.commander.temperatureDesc', 'Controls creativity vs determinism.')}>
          <SliderInput value={state.temperature} min={0} max={1} step={0.1} onChange={(v) => dispatch(setTemperature(v))} formatValue={(v) => v.toFixed(1)} />
        </SettingRow>
        <SettingRow label={tr('settings.commander.contextWindow', 'Context Window')} description={tr('settings.commander.contextWindowDesc', 'Token budget for LLM context — controls both input history and output limits.')}>
          <SliderInput value={state.maxTokens} min={1024} max={1000000} step={1024} onChange={(v) => dispatch(setMaxTokens(v))} formatValue={(v) => `${(v / 1000).toFixed(0)}K`} />
        </SettingRow>
        <SettingRow label={tr('settings.commander.llmRetries', 'LLM Retries')} description={tr('settings.commander.llmRetriesDesc', 'Retry count on rate-limit or service errors.')}>
          <SliderInput value={state.llmRetries} min={0} max={10} step={1} onChange={(v) => dispatch(setLlmRetries(v))} />
        </SettingRow>
      </SectionCard>

      {/* Storage & Data */}
      <SectionCard icon={Database} title={tr('settings.commander.dataLimits', 'Storage & Data Limits')} onReset={handleResetData}>
        <SettingRow label={tr('settings.commander.maxSessions', 'Max Sessions')} description={tr('settings.commander.maxSessionsDesc', 'Maximum saved Commander sessions.')}>
          <SliderInput value={state.maxSessions} min={5} max={200} step={5} onChange={(v) => dispatch(setMaxSessions(v))} />
        </SettingRow>
        <SettingRow label={tr('settings.commander.maxMessagesPerSession', 'Messages/Session')} description={tr('settings.commander.maxMessagesPerSessionDesc', 'Maximum messages kept per session.')}>
          <SliderInput value={state.maxMessagesPerSession} min={20} max={1000} step={20} onChange={(v) => dispatch(setMaxMessagesPerSession(v))} />
        </SettingRow>
        <SettingRow label={tr('settings.commander.undoStackDepth', 'Undo Depth')} description={tr('settings.commander.undoStackDepthDesc', 'Maximum canvas undo steps.')}>
          <SliderInput value={state.undoStackDepth} min={10} max={500} step={10} onChange={(v) => dispatch(setUndoStackDepth(v))} />
        </SettingRow>
        <SettingRow label={tr('settings.commander.maxLogEntries', 'Log Entries')} description={tr('settings.commander.maxLogEntriesDesc', 'Maximum log entries in the log panel.')}>
          <SliderInput value={state.maxLogEntries} min={100} max={5000} step={100} onChange={(v) => dispatch(setMaxLogEntries(v))} />
        </SettingRow>
      </SectionCard>

      {/* Behavior */}
      <SectionCard icon={Cog} title={tr('settings.commander.behavior', 'Behavior')} onReset={handleResetBehavior}>
        <SettingRow label={tr('settings.commander.autoSaveDelay', 'Auto-Save Delay')} description={tr('settings.commander.autoSaveDelayDesc', 'Debounce delay before auto-saving changes.')}>
          <SliderInput value={state.autoSaveDelayMs} min={100} max={5000} step={100} onChange={(v) => dispatch(setAutoSaveDelayMs(v))} formatValue={(v) => `${v}ms`} />
        </SettingRow>
        <SettingRow label={tr('settings.commander.undoGroupWindow', 'Undo Group Window')} description={tr('settings.commander.undoGroupWindowDesc', 'Time window for grouping rapid edits into one undo step.')}>
          <SliderInput value={state.undoGroupWindowMs} min={50} max={1000} step={50} onChange={(v) => dispatch(setUndoGroupWindowMs(v))} formatValue={(v) => `${v}ms`} />
        </SettingRow>
        <SettingRow label={tr('settings.commander.clipboardInterval', 'Clipboard Watch')} description={tr('settings.commander.clipboardIntervalDesc', 'Polling interval for clipboard AI text detection.')}>
          <SliderInput value={state.clipboardWatchIntervalMs} min={500} max={10000} step={500} onChange={(v) => dispatch(setClipboardWatchIntervalMs(v))} formatValue={(v) => `${(v / 1000).toFixed(1)}s`} />
        </SettingRow>
        <SettingRow label={tr('settings.commander.clipboardMinLength', 'Clipboard Min Length')} description={tr('settings.commander.clipboardMinLengthDesc', 'Minimum text length to trigger clipboard detection.')}>
          <SliderInput value={state.clipboardMinLength} min={10} max={1000} step={10} onChange={(v) => dispatch(setClipboardMinLength(v))} />
        </SettingRow>
        <SettingRow label={tr('settings.commander.generationConcurrency', 'Generation Concurrency')} description={tr('settings.commander.generationConcurrencyDesc', 'Max parallel API calls for media generation.')}>
          <SliderInput value={state.generationConcurrency} min={1} max={10} step={1} onChange={(v) => dispatch(setGenerationConcurrency(v))} />
        </SettingRow>
      </SectionCard>
    </div>
  );
}
