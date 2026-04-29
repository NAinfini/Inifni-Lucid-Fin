import type { PayloadAction } from '@reduxjs/toolkit';
import type { SettingsState, UsageStats } from './types.js';

// ---------------------------------------------------------------------------
// Default usage stats
// ---------------------------------------------------------------------------

export const DEFAULT_USAGE_STATS: UsageStats = {
  sessionCount: 0,
  totalToolCalls: 0,
  toolFrequency: {},
  toolErrors: {},
  recentTools: [],
  avgToolsPerSession: 0,
  avgTurnsPerSession: 0,
  totalSessionDurationMs: 0,
  cancelledSessions: 0,
  failedSessions: 0,
  generationCount: {},
  generationSuccessRate: {},
  totalGenerationTimeMs: 0,
  providerUsage: {},
  nodesCreated: 0,
  edgesCreated: 0,
  entitiesCreated: 0,
  snapshotsUsed: 0,
  dailyActiveMinutes: {},
  totalPromptsWritten: 0,
  totalPromptWords: 0,
  longestPromptWords: 0,
  charactersCreated: 0,
  locationsCreated: 0,
  equipmentCreated: 0,
  propsCreated: 0,
  entityEdits: 0,
  presetChanges: 0,
  presetUsageByCategory: {},
  totalShotsCreated: 0,
  totalScenesCreated: 0,
  exportsByFormat: {},
  totalExports: 0,
  undoCount: 0,
  redoCount: 0,
  featuresUsed: {},
  dailyErrors: {},
  totalInputTokens: 0,
  totalOutputTokens: 0,
  tokensByProvider: {},
  dailyToolCalls: {},
  dailyGenerations: {},
  dailySessions: {},
  dailyPrompts: {},
  dailyEntityCreations: {},
  dailyShotCreations: {},
  dailyExports: {},
  dailyTokensUsed: {},
  firstUsedDate: '',
  lastActiveDate: '',
};

// ---------------------------------------------------------------------------
// Telemetry reducer functions
// ---------------------------------------------------------------------------

export function recordToolCall(
  state: SettingsState,
  action: PayloadAction<{ toolName: string; error?: boolean }>,
) {
  const today = new Date().toISOString().slice(0, 10);
  state.usage.totalToolCalls += 1;
  state.usage.toolFrequency[action.payload.toolName] =
    (state.usage.toolFrequency[action.payload.toolName] ?? 0) + 1;
  if (action.payload.error) {
    state.usage.toolErrors[action.payload.toolName] =
      (state.usage.toolErrors[action.payload.toolName] ?? 0) + 1;
  }
  state.usage.recentTools.push(action.payload.toolName);
  if (state.usage.recentTools.length > 50) {
    state.usage.recentTools = state.usage.recentTools.slice(-50);
  }
  state.usage.dailyToolCalls[today] = (state.usage.dailyToolCalls[today] ?? 0) + 1;
}

export function recordSession(
  state: SettingsState,
  action: PayloadAction<{
    durationMs: number;
    toolCount: number;
    turnCount: number;
    cancelled?: boolean;
    failed?: boolean;
  }>,
) {
  const today = new Date().toISOString().slice(0, 10);
  state.usage.sessionCount += 1;
  state.usage.totalSessionDurationMs += action.payload.durationMs;
  if (action.payload.cancelled) state.usage.cancelledSessions += 1;
  if (action.payload.failed) state.usage.failedSessions += 1;
  const n = state.usage.sessionCount;
  state.usage.avgToolsPerSession =
    state.usage.avgToolsPerSession +
    (action.payload.toolCount - state.usage.avgToolsPerSession) / n;
  state.usage.avgTurnsPerSession =
    state.usage.avgTurnsPerSession +
    (action.payload.turnCount - state.usage.avgTurnsPerSession) / n;
  state.usage.dailySessions[today] = (state.usage.dailySessions[today] ?? 0) + 1;
}

export function recordGeneration(
  state: SettingsState,
  action: PayloadAction<{
    type: string;
    success: boolean;
    durationMs: number;
  }>,
) {
  const today = new Date().toISOString().slice(0, 10);
  const { type, success, durationMs } = action.payload;
  state.usage.generationCount[type] = (state.usage.generationCount[type] ?? 0) + 1;
  state.usage.totalGenerationTimeMs += durationMs;
  const count = state.usage.generationCount[type];
  const prev = state.usage.generationSuccessRate[type] ?? 1;
  state.usage.generationSuccessRate[type] = prev + ((success ? 1 : 0) - prev) / count;
  state.usage.dailyGenerations[today] = (state.usage.dailyGenerations[today] ?? 0) + 1;
}

export function recordProviderRequest(
  state: SettingsState,
  action: PayloadAction<{
    providerId: string;
    latencyMs: number;
    error?: boolean;
  }>,
) {
  const { providerId, latencyMs, error } = action.payload;
  const existing = state.usage.providerUsage[providerId] ?? {
    requestCount: 0,
    errorCount: 0,
    avgLatencyMs: 0,
    lastUsed: '',
  };
  existing.requestCount += 1;
  if (error) existing.errorCount += 1;
  existing.avgLatencyMs =
    existing.avgLatencyMs + (latencyMs - existing.avgLatencyMs) / existing.requestCount;
  existing.lastUsed = new Date().toISOString();
  state.usage.providerUsage[providerId] = existing;
}

export function recordProjectActivity(
  state: SettingsState,
  action: PayloadAction<{
    nodesCreated?: number;
    edgesCreated?: number;
    entitiesCreated?: number;
    snapshotsUsed?: number;
  }>,
) {
  const p = action.payload;
  if (p.nodesCreated) state.usage.nodesCreated += p.nodesCreated;
  if (p.edgesCreated) state.usage.edgesCreated += p.edgesCreated;
  if (p.entitiesCreated) state.usage.entitiesCreated += p.entitiesCreated;
  if (p.snapshotsUsed) state.usage.snapshotsUsed += p.snapshotsUsed;
}

export function updateDailyActive(
  state: SettingsState,
  action: PayloadAction<{ date: string; minutes: number }>,
) {
  state.usage.dailyActiveMinutes[action.payload.date] =
    (state.usage.dailyActiveMinutes[action.payload.date] ?? 0) + action.payload.minutes;
  if (!state.usage.firstUsedDate) state.usage.firstUsedDate = action.payload.date;
  state.usage.lastActiveDate = action.payload.date;
}

export function recordPrompt(state: SettingsState, action: PayloadAction<{ wordCount: number }>) {
  const today = new Date().toISOString().slice(0, 10);
  state.usage.totalPromptsWritten += 1;
  state.usage.totalPromptWords += action.payload.wordCount;
  if (action.payload.wordCount > state.usage.longestPromptWords) {
    state.usage.longestPromptWords = action.payload.wordCount;
  }
  state.usage.dailyPrompts[today] = (state.usage.dailyPrompts[today] ?? 0) + 1;
}

export function recordEntityCreate(
  state: SettingsState,
  action: PayloadAction<{ entityType: 'character' | 'location' | 'equipment' | 'prop' }>,
) {
  const today = new Date().toISOString().slice(0, 10);
  switch (action.payload.entityType) {
    case 'character':
      state.usage.charactersCreated += 1;
      break;
    case 'location':
      state.usage.locationsCreated += 1;
      break;
    case 'equipment':
      state.usage.equipmentCreated += 1;
      break;
    case 'prop':
      state.usage.propsCreated += 1;
      break;
  }
  state.usage.entitiesCreated += 1;
  state.usage.dailyEntityCreations[today] = (state.usage.dailyEntityCreations[today] ?? 0) + 1;
}

export function recordEntityEdit(state: SettingsState) {
  state.usage.entityEdits += 1;
}

export function recordPresetChange(
  state: SettingsState,
  action: PayloadAction<{ category: string }>,
) {
  state.usage.presetChanges += 1;
  state.usage.presetUsageByCategory[action.payload.category] =
    (state.usage.presetUsageByCategory[action.payload.category] ?? 0) + 1;
}

export function recordShotCreate(state: SettingsState) {
  const today = new Date().toISOString().slice(0, 10);
  state.usage.totalShotsCreated += 1;
  state.usage.dailyShotCreations[today] = (state.usage.dailyShotCreations[today] ?? 0) + 1;
}

export function recordSceneCreate(state: SettingsState) {
  state.usage.totalScenesCreated += 1;
}

export function recordExport(state: SettingsState, action: PayloadAction<{ format: string }>) {
  const today = new Date().toISOString().slice(0, 10);
  state.usage.totalExports += 1;
  state.usage.exportsByFormat[action.payload.format] =
    (state.usage.exportsByFormat[action.payload.format] ?? 0) + 1;
  state.usage.dailyExports[today] = (state.usage.dailyExports[today] ?? 0) + 1;
}

export function recordUndo(state: SettingsState) {
  state.usage.undoCount += 1;
}

export function recordRedo(state: SettingsState) {
  state.usage.redoCount += 1;
}

export function recordFeatureUsed(
  state: SettingsState,
  action: PayloadAction<{ feature: string }>,
) {
  state.usage.featuresUsed[action.payload.feature] =
    (state.usage.featuresUsed[action.payload.feature] ?? 0) + 1;
}

export function recordError(state: SettingsState) {
  const today = new Date().toISOString().slice(0, 10);
  state.usage.dailyErrors[today] = (state.usage.dailyErrors[today] ?? 0) + 1;
}

export function recordTokenUsage(
  state: SettingsState,
  action: PayloadAction<{ providerId: string; inputTokens: number; outputTokens: number }>,
) {
  const today = new Date().toISOString().slice(0, 10);
  const { providerId, inputTokens, outputTokens } = action.payload;
  state.usage.totalInputTokens += inputTokens;
  state.usage.totalOutputTokens += outputTokens;
  const existing = state.usage.tokensByProvider[providerId] ?? { input: 0, output: 0 };
  existing.input += inputTokens;
  existing.output += outputTokens;
  state.usage.tokensByProvider[providerId] = existing;
  state.usage.dailyTokensUsed[today] =
    (state.usage.dailyTokensUsed[today] ?? 0) + inputTokens + outputTokens;
}
