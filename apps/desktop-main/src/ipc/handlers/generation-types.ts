import type { AdapterRegistry } from '@lucid-fin/adapters-ai';
import type { CompiledPrompt, PromptMode } from '@lucid-fin/application';
import type {
  AIProviderAdapter,
  Canvas,
  CanvasNode,
  GenerationEntityRef,
  GenerationRequest,
  GenerationType,
} from '@lucid-fin/contracts';
import type { CAS, Keychain, SqliteIndex } from '@lucid-fin/storage';
import type { CanvasStore } from './canvas.handlers.js';

export type CanvasGenerationDeps = {
  adapterRegistry: AdapterRegistry;
  cas: CAS;
  db: SqliteIndex;
  canvasStore: CanvasStore;
  keychain: Keychain;
  getWindow: () => import('electron').BrowserWindow | null;
};

export type SendTarget = {
  send: (channel: string, payload: unknown) => void;
};

export type RunningCanvasJob = {
  jobId: string;
  canvasId: string;
  nodeId: string;
  adapterId: string;
  providerJobIds: Set<string>;
  cancelled: boolean;
  cancelReason?: string;
};

export type ProviderConfigOverride = { baseUrl: string; model: string; apiKey?: string };

export type GenerateArgs = {
  canvasId: string;
  nodeId: string;
  providerId?: string;
  providerConfig?: ProviderConfigOverride;
  variantCount?: number;
  seed?: number;
};

export type EstimateArgs = {
  canvasId: string;
  nodeId: string;
  providerId: string;
  providerConfig?: ProviderConfigOverride;
};

export type CancelArgs = {
  canvasId: string;
  nodeId: string;
};

export type BuiltGenerationContext = {
  canvas: Canvas;
  node: CanvasNode;
  requestBase: GenerationRequest;
  adapter: AIProviderAdapter;
  nodeType: 'image' | 'video' | 'audio';
  generationType: GenerationType;
  mode: PromptMode;
  variantCount: number;
  baseSeed?: number;
  compiled: CompiledPrompt;
  resolvedEntityRefs: {
    characterRefs?: GenerationEntityRef[];
    equipmentRefs?: GenerationEntityRef[];
    locationRefs?: GenerationEntityRef[];
  };
};

export type GenerationMediaConfig = Pick<GenerationRequest, 'width' | 'height' | 'duration'> & {
  fps?: number;
};

export type MaterializedAsset = {
  filePath: string;
  cleanupPath?: string;
  sourceUrl?: string;
};

export type PollOptions = {
  /** Maximum number of poll iterations before timeout (default 120 = ~10 min at 5 s) */
  maxIterations?: number;
  /** Abort signal to cancel polling early */
  signal?: AbortSignal;
  /** Interval between polls in ms (default 5000) */
  intervalMs?: number;
};
