import type {
  Capability,
  LLMProviderAuthStyle,
  LLMProviderProtocol,
  StyleGuide,
} from '@lucid-fin/contracts';

export type APIGroup = 'llm' | 'image' | 'video' | 'audio' | 'vision';
export type ProviderKind = 'official' | 'hub';

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  isCustom: boolean;
  protocol?: LLMProviderProtocol;
  authStyle?: LLMProviderAuthStyle;
  contextWindow?: number;
}

export interface ProviderMetadata {
  kind: ProviderKind;
  docsUrl: string;
  keyUrl: string;
  modelExample?: string;
  capabilities: Capability[];
  supportsReferenceImage?: boolean;
  supportsAudio?: boolean;
  qualityTiers?: string[];
  defaultResolution?: string;
  defaultDurationSeconds?: number;
  outputFormats?: string[];
  notes?: string;
}

export type BuiltinProviderConfig = ProviderConfig & ProviderMetadata;

export interface ProviderCollectionConfig {
  providers: ProviderConfig[];
}

export interface UsageStats {
  // Commander AI
  sessionCount: number;
  totalToolCalls: number;
  toolFrequency: Record<string, number>;
  toolErrors: Record<string, number>;
  recentTools: string[]; // last 50 tool names used
  avgToolsPerSession: number;
  avgTurnsPerSession: number;
  totalSessionDurationMs: number;
  cancelledSessions: number;
  failedSessions: number;

  // Generation
  generationCount: Record<string, number>; // by type: image, video, audio
  generationSuccessRate: Record<string, number>; // by type: 0-1
  totalGenerationTimeMs: number;

  // Provider
  providerUsage: Record<string, {
    requestCount: number;
    errorCount: number;
    avgLatencyMs: number;
    lastUsed: string; // ISO date
  }>;

  // Project activity
  nodesCreated: number;
  edgesCreated: number;
  entitiesCreated: number;
  snapshotsUsed: number;

  // Activity tracking
  dailyActiveMinutes: Record<string, number>; // date string -> minutes

  // Prompt stats
  totalPromptsWritten: number;
  totalPromptWords: number;
  longestPromptWords: number;

  // Entity stats
  charactersCreated: number;
  locationsCreated: number;
  equipmentCreated: number;
  propsCreated: number;
  entityEdits: number;

  // Preset stats
  presetChanges: number;
  presetUsageByCategory: Record<string, number>; // category -> count

  // Canvas stats
  totalShotsCreated: number;
  totalScenesCreated: number;

  // Export stats
  exportsByFormat: Record<string, number>; // format -> count
  totalExports: number;

  // Undo/redo
  undoCount: number;
  redoCount: number;

  // Feature discovery -- panels/tabs opened at least once
  featuresUsed: Record<string, number>; // feature key -> open count

  // Error tracking over time
  dailyErrors: Record<string, number>; // date -> error count

  // LLM token usage
  totalInputTokens: number;
  totalOutputTokens: number;
  tokensByProvider: Record<string, { input: number; output: number }>;

  // Time series -- daily counts for graphable metrics
  dailyToolCalls: Record<string, number>;
  dailyGenerations: Record<string, number>;
  dailySessions: Record<string, number>;
  dailyPrompts: Record<string, number>;
  dailyEntityCreations: Record<string, number>;
  dailyShotCreations: Record<string, number>;
  dailyExports: Record<string, number>;
  dailyTokensUsed: Record<string, number>;

  // First-use tracking
  firstUsedDate: string; // ISO date of first activity
  lastActiveDate: string; // ISO date of last activity
}

export interface ProductionConfig {
  title: string;
  description: string;
  genre: string;
  resolution: [number, number];
  fps: number;
  aspectRatio: string;
}

export interface SettingsState {
  llm: ProviderCollectionConfig;
  image: ProviderCollectionConfig;
  video: ProviderCollectionConfig;
  audio: ProviderCollectionConfig;
  vision: ProviderCollectionConfig;
  renderPreset: string;
  usage: UsageStats;
  availableUpdate: string | null;
  production: ProductionConfig;
  styleGuide: StyleGuide;
  bootstrapped: boolean;
}

export interface PersistedSettingsState {
  llm?: ProviderCollectionConfig & { activeProvider?: string };
  image?: ProviderCollectionConfig & { activeProvider?: string };
  video?: ProviderCollectionConfig & { activeProvider?: string };
  audio?: ProviderCollectionConfig & { activeProvider?: string };
  vision?: ProviderCollectionConfig & { activeProvider?: string };
  renderPreset?: string;
  usage?: Partial<UsageStats>;
  production?: Partial<ProductionConfig>;
  styleGuide?: StyleGuide;
}
