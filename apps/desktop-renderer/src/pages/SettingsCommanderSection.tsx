import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Bot, Cog, Database, RotateCcw } from 'lucide-react';
import type { RunResourceBudget } from '@lucid-fin/contracts';
import type { RootState } from '../store/index.js';
import { CommitSlider } from '../components/ui/CommitSlider.js';
import {
  setRunResourceBudget,
  setTemperature,
  setContextWindowTokens,
  setMaxOutputTokens,
  setMaxSessions,
  setMaxMessagesPerSession,
  setUndoStackDepth,
  setMaxLogEntries,
  setAutoSaveDelayMs,
  setUndoGroupWindowMs,
  setClipboardWatchIntervalMs,
  setClipboardMinLength,
  setGenerationConcurrency,
  setQualityGateBehavior,
  setRequireStylePlateBeforeRefImage,
} from '../store/slices/commander.js';
import { t } from '../i18n.js';
import { cn } from '../lib/utils.js';
import type { CommanderQualityGateBehavior } from '@lucid-fin/contracts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tr(key: string, fallback: string): string {
  const v = t(key);
  return v === key ? fallback : v;
}

function clampSliderValue(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
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
  label,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  formatValue?: (v: number) => string;
  label: string;
}) {
  const [inputValue, setInputValue] = useState(String(value));
  const sliderValue = clampSliderValue(value, min, max);

  useEffect(() => {
    setInputValue(String(value));
  }, [value]);

  const commitInputValue = () => {
    const nextValue = Number(inputValue);
    if (!Number.isFinite(nextValue)) {
      setInputValue(String(value));
      return;
    }
    onChange(nextValue);
  };

  return (
    <div className="flex items-center gap-2">
      <CommitSlider
        min={min}
        max={max}
        step={step}
        value={sliderValue}
        onCommit={onChange}
        aria-label={label}
        className="h-1.5 w-28 cursor-pointer accent-primary"
      />
      <input
        type="number"
        aria-label={`${label} value`}
        value={inputValue}
        step={step}
        onChange={(event) => setInputValue(event.target.value)}
        onBlur={commitInputValue}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            setInputValue(String(value));
            event.currentTarget.blur();
          }
        }}
        className="h-7 w-20 rounded border border-border/60 bg-background px-1.5 text-right font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        title={formatValue ? formatValue(value) : String(value)}
      />
    </div>
  );
}

function OptionalNumberInput({
  value,
  onChange,
  label,
  placeholder,
  step = 1,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  label: string;
  placeholder: string;
  step?: number;
}) {
  const [inputValue, setInputValue] = useState(value === undefined ? '' : String(value));

  useEffect(() => {
    setInputValue(value === undefined ? '' : String(value));
  }, [value]);

  const commit = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      onChange(undefined);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setInputValue(value === undefined ? '' : String(value));
      return;
    }
    onChange(parsed);
  };

  return (
    <input
      type="number"
      min={0}
      step={step}
      aria-label={label}
      value={inputValue}
      placeholder={placeholder}
      onChange={(event) => setInputValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          setInputValue(value === undefined ? '' : String(value));
          event.currentTarget.blur();
        }
      }}
      className="h-8 w-32 rounded-md border border-border/60 bg-background px-2 text-right font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
    />
  );
}

function SegmentedInput<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex rounded-md border border-border/60 bg-background p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded px-2 py-1 text-[11px] transition-colors',
            value === option.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ToggleInput({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-primary"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

export function SettingsCommanderSection() {
  const dispatch = useDispatch();
  const state = useSelector((s: RootState) => s.commander);

  const handleResetAgent = () => {
    dispatch(setRunResourceBudget({}));
    dispatch(setTemperature(0.7));
    dispatch(setContextWindowTokens(200000));
    dispatch(setMaxOutputTokens(4096));
  };

  const updateResourceBudget = (
    field: keyof RunResourceBudget,
    value: number | undefined,
  ) => {
    const next = { ...state.resourceBudget };
    if (value === undefined) delete next[field];
    else Object.assign(next, { [field]: value });
    dispatch(setRunResourceBudget(next));
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
    dispatch(setQualityGateBehavior('auto-expand'));
    dispatch(setRequireStylePlateBeforeRefImage(true));
  };

  return (
    <div className="space-y-6">
      {/* Agent Parameters */}
      <SectionCard
        icon={Bot}
        title={tr('settings.commander.agentParams', 'Agent Parameters')}
        onReset={handleResetAgent}
      >
        <SettingRow
          label={tr('settings.commander.maxTokensPerRun', 'Tokens per run')}
          description={tr(
            'settings.commander.maxTokensPerRunDesc',
            'Blocks the run before its cumulative model token budget is exceeded. Leave blank for no user limit.',
          )}
        >
          <OptionalNumberInput
            value={state.resourceBudget.maxTokens}
            onChange={(value) => updateResourceBudget('maxTokens', value)}
            label={tr('settings.commander.maxTokensPerRun', 'Tokens per run')}
            placeholder={tr('settings.commander.unlimited', 'Unlimited')}
          />
        </SettingRow>
        <SettingRow
          label={tr('settings.commander.maxToolCallsPerRun', 'Tool calls per run')}
          description={tr(
            'settings.commander.maxToolCallsPerRunDesc',
            'Counts every model-selected tool call before deduplication. Leave blank for no user limit.',
          )}
        >
          <OptionalNumberInput
            value={state.resourceBudget.maxToolCalls}
            onChange={(value) => updateResourceBudget('maxToolCalls', value)}
            label={tr('settings.commander.maxToolCallsPerRun', 'Tool calls per run')}
            placeholder={tr('settings.commander.unlimited', 'Unlimited')}
          />
        </SettingRow>
        <SettingRow
          label={tr('settings.commander.maxActiveMinutesPerRun', 'Active minutes per run')}
          description={tr(
            'settings.commander.maxActiveMinutesPerRunDesc',
            'Counts active execution time but excludes time waiting for you. Leave blank for no user limit.',
          )}
        >
          <OptionalNumberInput
            value={
              state.resourceBudget.maxWallTimeMs === undefined
                ? undefined
                : state.resourceBudget.maxWallTimeMs / 60_000
            }
            onChange={(value) =>
              updateResourceBudget(
                'maxWallTimeMs',
                value === undefined ? undefined : Math.round(value * 60_000),
              )
            }
            label={tr('settings.commander.maxActiveMinutesPerRun', 'Active minutes per run')}
            placeholder={tr('settings.commander.unlimited', 'Unlimited')}
          />
        </SettingRow>
        <SettingRow
          label={tr('settings.commander.maxCostPerRun', 'Cost per run (USD)')}
          description={tr(
            'settings.commander.maxCostPerRunDesc',
            'Paid operations without a reliable upper bound are blocked when this limit is set. Leave blank for no user limit.',
          )}
        >
          <OptionalNumberInput
            value={state.resourceBudget.maxCostUsd}
            onChange={(value) => updateResourceBudget('maxCostUsd', value)}
            label={tr('settings.commander.maxCostPerRun', 'Cost per run (USD)')}
            placeholder={tr('settings.commander.unlimited', 'Unlimited')}
            step={0.01}
          />
        </SettingRow>
        <SettingRow
          label={tr('settings.commander.temperature', 'Temperature')}
          description={tr(
            'settings.commander.temperatureDesc',
            'Controls creativity vs determinism.',
          )}
        >
          <SliderInput
            value={state.temperature}
            min={0}
            max={1}
            step={0.1}
            onChange={(v) => dispatch(setTemperature(v))}
            formatValue={(v) => v.toFixed(1)}
            label={tr('settings.commander.temperature', 'Temperature')}
          />
        </SettingRow>
        <SettingRow
          label={tr('settings.commander.contextWindow', 'Context Window')}
          description={tr(
            'settings.commander.contextWindowDesc',
            'Token budget for conversation history and tool context. Provider output limits are configured separately.',
          )}
        >
          <SliderInput
            value={state.contextWindowTokens}
            min={1024}
            max={200000}
            step={1024}
            onChange={(v) => dispatch(setContextWindowTokens(v))}
            formatValue={(v) => `${(v / 1000).toFixed(0)}K`}
            label={tr('settings.commander.contextWindow', 'Context Window')}
          />
        </SettingRow>
        <SettingRow
          label={tr('settings.commander.maxOutputTokens', 'Max Output Tokens')}
          description={tr(
            'settings.commander.maxOutputTokensDesc',
            'Maximum tokens in one model response, subject to the provider limit.',
          )}
        >
          <SliderInput
            value={state.maxOutputTokens}
            min={256}
            max={200000}
            step={256}
            onChange={(v) => dispatch(setMaxOutputTokens(v))}
            formatValue={(v) => v.toLocaleString()}
            label={tr('settings.commander.maxOutputTokens', 'Max Output Tokens')}
          />
        </SettingRow>
      </SectionCard>

      {/* Storage & Data */}
      <SectionCard
        icon={Database}
        title={tr('settings.commander.dataLimits', 'Storage & Data Limits')}
        onReset={handleResetData}
      >
        <SettingRow
          label={tr('settings.commander.maxSessions', 'Max Sessions')}
          description={tr(
            'settings.commander.maxSessionsDesc',
            'Maximum saved Commander sessions.',
          )}
        >
          <SliderInput
            value={state.maxSessions}
            min={5}
            max={200}
            step={5}
            onChange={(v) => dispatch(setMaxSessions(v))}
            label={tr('settings.commander.maxSessions', 'Max Sessions')}
          />
        </SettingRow>
        <SettingRow
          label={tr('settings.commander.maxMessagesPerSession', 'Messages/Session')}
          description={tr(
            'settings.commander.maxMessagesPerSessionDesc',
            'Maximum messages kept per session.',
          )}
        >
          <SliderInput
            value={state.maxMessagesPerSession}
            min={20}
            max={1000}
            step={20}
            onChange={(v) => dispatch(setMaxMessagesPerSession(v))}
            label={tr('settings.commander.maxMessagesPerSession', 'Messages/Session')}
          />
        </SettingRow>
        <SettingRow
          label={tr('settings.commander.undoStackDepth', 'Undo Depth')}
          description={tr('settings.commander.undoStackDepthDesc', 'Maximum canvas undo steps.')}
        >
          <SliderInput
            value={state.undoStackDepth}
            min={10}
            max={500}
            step={10}
            onChange={(v) => dispatch(setUndoStackDepth(v))}
            label={tr('settings.commander.undoStackDepth', 'Undo Depth')}
          />
        </SettingRow>
        <SettingRow
          label={tr('settings.commander.maxLogEntries', 'Log Entries')}
          description={tr(
            'settings.commander.maxLogEntriesDesc',
            'Maximum log entries in the log panel.',
          )}
        >
          <SliderInput
            value={state.maxLogEntries}
            min={100}
            max={5000}
            step={100}
            onChange={(v) => dispatch(setMaxLogEntries(v))}
            label={tr('settings.commander.maxLogEntries', 'Log Entries')}
          />
        </SettingRow>
      </SectionCard>

      {/* Behavior */}
      <SectionCard
        icon={Cog}
        title={tr('settings.commander.behavior', 'Behavior')}
        onReset={handleResetBehavior}
      >
        <SettingRow
          label={tr('settings.commander.autoSaveDelay', 'Auto-Save Delay')}
          description={tr(
            'settings.commander.autoSaveDelayDesc',
            'Debounce delay before auto-saving changes.',
          )}
        >
          <SliderInput
            value={state.autoSaveDelayMs}
            min={100}
            max={5000}
            step={100}
            onChange={(v) => dispatch(setAutoSaveDelayMs(v))}
            formatValue={(v) => `${v}ms`}
            label={tr('settings.commander.autoSaveDelay', 'Auto-Save Delay')}
          />
        </SettingRow>
        <SettingRow
          label={tr('settings.commander.undoGroupWindow', 'Undo Group Window')}
          description={tr(
            'settings.commander.undoGroupWindowDesc',
            'Time window for grouping rapid edits into one undo step.',
          )}
        >
          <SliderInput
            value={state.undoGroupWindowMs}
            min={50}
            max={1000}
            step={50}
            onChange={(v) => dispatch(setUndoGroupWindowMs(v))}
            formatValue={(v) => `${v}ms`}
            label={tr('settings.commander.undoGroupWindow', 'Undo Group Window')}
          />
        </SettingRow>
        <SettingRow
          label={tr('settings.commander.clipboardInterval', 'Clipboard Watch')}
          description={tr(
            'settings.commander.clipboardIntervalDesc',
            'Polling interval for clipboard AI text detection.',
          )}
        >
          <SliderInput
            value={state.clipboardWatchIntervalMs}
            min={500}
            max={10000}
            step={500}
            onChange={(v) => dispatch(setClipboardWatchIntervalMs(v))}
            formatValue={(v) => `${(v / 1000).toFixed(1)}s`}
            label={tr('settings.commander.clipboardInterval', 'Clipboard Watch')}
          />
        </SettingRow>
        <SettingRow
          label={tr('settings.commander.clipboardMinLength', 'Clipboard Min Length')}
          description={tr(
            'settings.commander.clipboardMinLengthDesc',
            'Minimum text length to trigger clipboard detection.',
          )}
        >
          <SliderInput
            value={state.clipboardMinLength}
            min={10}
            max={1000}
            step={10}
            onChange={(v) => dispatch(setClipboardMinLength(v))}
            label={tr('settings.commander.clipboardMinLength', 'Clipboard Min Length')}
          />
        </SettingRow>
        <SettingRow
          label={tr('settings.commander.generationConcurrency', 'Generation Concurrency')}
          description={tr(
            'settings.commander.generationConcurrencyDesc',
            'Max parallel API calls for media generation.',
          )}
        >
          <SliderInput
            value={state.generationConcurrency}
            min={1}
            max={10}
            step={1}
            onChange={(v) => dispatch(setGenerationConcurrency(v))}
            label={tr('settings.commander.generationConcurrency', 'Generation Concurrency')}
          />
        </SettingRow>
        <SettingRow
          label={tr('settings.commander.qualityGateBehavior', 'Quality Gate')}
          description={tr(
            'settings.commander.qualityGateBehaviorDesc',
            'Controls how Commander handles weak generation prompts.',
          )}
        >
          <SegmentedInput<CommanderQualityGateBehavior>
            value={state.qualityGateBehavior}
            options={[
              {
                value: 'warn-only',
                label: tr('settings.commander.qualityGateWarnOnly', 'Warn only'),
              },
              {
                value: 'auto-expand',
                label: tr('settings.commander.qualityGateAutoExpand', 'Auto-expand'),
              },
              {
                value: 'block-generation',
                label: tr('settings.commander.qualityGateBlock', 'Block generation'),
              },
            ]}
            onChange={(v) => dispatch(setQualityGateBehavior(v))}
          />
        </SettingRow>
        <SettingRow
          label={tr(
            'settings.commander.requireStylePlateBeforeRefImage',
            'Require visual-style draft before reference images',
          )}
          description={tr(
            'settings.commander.requireStylePlateBeforeRefImageDesc',
            'Commander must create a canonical Canvas visual-style draft before character, location, or equipment reference images.',
          )}
        >
          <ToggleInput
            label={tr(
              'settings.commander.requireStylePlateBeforeRefImage',
              'Require visual-style draft before reference images',
            )}
            checked={state.requireStylePlateBeforeRefImage}
            onChange={(checked) => dispatch(setRequireStylePlateBeforeRefImage(checked))}
          />
        </SettingRow>
      </SectionCard>
    </div>
  );
}
