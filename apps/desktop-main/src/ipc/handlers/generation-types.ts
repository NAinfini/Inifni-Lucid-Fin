import type { AdapterRegistry } from '@lucid-fin/adapters-ai';
import type { CompiledPrompt, PromptMode } from '@lucid-fin/application';
import type {
  AIProviderAdapter,
  Canvas,
  CanvasNode,
  GenerationEntityRef,
  GenerationRequest,
  GenerationType,
  LLMAdapter,
  PresetDefinition,
  ResolutionPreflightResult,
  VisualStyleProvenance,
} from '@lucid-fin/contracts';
import type { CAS, Keychain, SqliteIndex } from '@lucid-fin/storage';
import type { MediaProbeResult } from '@lucid-fin/media-engine';
import type { CanvasStore } from './canvas.handlers.js';
import type { PromptAssemblyService } from '../../services/prompt-assembly.service.js';

export type CanvasGenerationDeps = {
  adapterRegistry: AdapterRegistry;
  cas: CAS;
  db: SqliteIndex;
  canvasStore: CanvasStore;
  keychain: Keychain;
  getWindow: () => import('electron').BrowserWindow | null;
  resolvePresetCatalog: () => PresetDefinition[];
  promptAssemblyService: PromptAssemblyService;
  /** Active outer Commander model. Used only to attribute submitted output, never recursively called. */
  preferredPromptAssembler?: LLMAdapter;
  /** Effective editable task prompt supplied as an advisory assembly source. */
  resolveProcessPrompt?: (processKey: string) => string | null | undefined;
  /** Test seam; production uses the packaged ffprobe implementation. */
  probeMedia?: (filePath: string) => Promise<MediaProbeResult>;
};

export type SendTarget = {
  send: (channel: string, payload: unknown) => void;
};

export type ProviderConfigOverride = { baseUrl: string; model: string; apiKey?: string };

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
  promptAssemblyId?: string;
  visualStyle?: VisualStyleProvenance;
  resolutionPreflight?: Extract<ResolutionPreflightResult, { supported: true }> & {
    request: GenerationRequest;
  };
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
