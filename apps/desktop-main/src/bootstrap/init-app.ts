import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import log from '../logger.js';
import { CAS, SqliteIndex, Keychain, PromptStore, ProcessPromptStore } from '@lucid-fin/storage';
import {
  AdapterRegistry,
  // Image adapters
  OpenAIDalleAdapter,
  ReplicateAdapter,
  IdeogramAdapter,
  GoogleImagen3Adapter,
  RecraftAdapter,
  LeonardoAdapter,
  FalAdapter,
  TogetherMediaAdapter,
  SiliconFlowImageAdapter,
  XAIImagineAdapter,
  ZhipuImageAdapter,
  BFLFluxAdapter,
  StabilityImageAdapter,
  BriaAdapter,
  KreaAdapter,
  SegmindAdapter,
  FreepikAdapter,
  BaiduQianfanAdapter,
  StepFunImageAdapter,
  VolcengineImageAdapter,
  AlibabaWanImageAdapter,
  // Video adapters
  RunwayAdapter,
  VeoAdapter,
  LumaAdapter,
  MiniMaxAdapter,
  KlingAdapter,
  SeedanceAdapter,
  HiggsfieldAdapter,
  PixVerseAdapter,
  AlibabaWanVideoAdapter,
  LtxAdapter,
  SiliconFlowVideoAdapter,
  ZhipuVideoAdapter,
  ViduAdapter,
  VolcengineVideoAdapter,
  // Audio adapters
  ElevenLabsAdapter,
  ElevenLabsSFXAdapter,
  OpenAITTSAdapter,
  CartesiaSonicAdapter,
  PlayHTAdapter,
  FishAudioAdapter,
  StabilityAudioAdapter,
  // Music adapters
  SunoAdapter,
  UdioAdapter,
  MusicGenAdapter,
  // Local adapters
  OllamaAdapter,
  ComfyUIAdapter,
  SDWebUIAdapter,
  // LLM adapters
  LLMRegistry,
  buildRuntimeLLMAdapter,
  listBuiltinLLMProviderPresets,
  providerHealth,
} from '@lucid-fin/adapters-ai';
import { ToolRegistry } from '@lucid-fin/application';
import {
  listBuiltinMediaProviders,
  listBuiltinVisionProviderPresets,
  type LLMAdapter,
} from '@lucid-fin/contracts';
import type { CodexRuntime } from '../codex/codex-runtime.js';
import { CodexImageGenAdapter } from '../codex/codex-imagegen.adapter.js';
import { CodexLLMAdapter } from '../codex/codex-llm.adapter.js';
import type { ProviderOAuthManager } from '../oauth/provider-oauth-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.join(os.homedir(), '.lucid-fin');

export function createAdapterRegistry(codexRuntime?: CodexRuntime): AdapterRegistry {
  const adapterRegistry = new AdapterRegistry();
  // Image
  adapterRegistry.register(new OpenAIDalleAdapter());
  adapterRegistry.register(new ReplicateAdapter());
  adapterRegistry.register(new IdeogramAdapter());
  adapterRegistry.register(new GoogleImagen3Adapter());
  adapterRegistry.register(new RecraftAdapter());
  adapterRegistry.register(new LeonardoAdapter());
  adapterRegistry.register(new FalAdapter());
  adapterRegistry.register(new TogetherMediaAdapter());
  adapterRegistry.register(new SiliconFlowImageAdapter());
  adapterRegistry.register(new XAIImagineAdapter());
  adapterRegistry.register(new ZhipuImageAdapter());
  adapterRegistry.register(new BFLFluxAdapter());
  adapterRegistry.register(new StabilityImageAdapter());
  adapterRegistry.register(new StepFunImageAdapter());
  adapterRegistry.register(new VolcengineImageAdapter());
  adapterRegistry.register(new AlibabaWanImageAdapter());
  adapterRegistry.register(new BriaAdapter());
  adapterRegistry.register(new KreaAdapter());
  adapterRegistry.register(new HiggsfieldAdapter());
  adapterRegistry.register(new SegmindAdapter());
  adapterRegistry.register(new FreepikAdapter());
  adapterRegistry.register(new BaiduQianfanAdapter());
  if (codexRuntime) {
    adapterRegistry.register(new CodexImageGenAdapter(codexRuntime));
  }
  // Video
  adapterRegistry.register(new RunwayAdapter());
  adapterRegistry.register(new VeoAdapter());
  adapterRegistry.register(new LumaAdapter());
  adapterRegistry.register(new MiniMaxAdapter());
  adapterRegistry.register(new KlingAdapter());
  adapterRegistry.register(new SeedanceAdapter());
  adapterRegistry.register(new PixVerseAdapter());
  adapterRegistry.register(new AlibabaWanVideoAdapter());
  adapterRegistry.register(new LtxAdapter());
  adapterRegistry.register(new SiliconFlowVideoAdapter());
  adapterRegistry.register(new ZhipuVideoAdapter());
  adapterRegistry.register(new ViduAdapter());
  adapterRegistry.register(new VolcengineVideoAdapter());
  // Audio
  adapterRegistry.register(new ElevenLabsAdapter());
  adapterRegistry.register(new ElevenLabsSFXAdapter());
  adapterRegistry.register(new OpenAITTSAdapter());
  adapterRegistry.register(new CartesiaSonicAdapter());
  adapterRegistry.register(new PlayHTAdapter());
  adapterRegistry.register(new FishAudioAdapter());
  adapterRegistry.register(new StabilityAudioAdapter());
  // Music
  adapterRegistry.register(new SunoAdapter());
  adapterRegistry.register(new UdioAdapter());
  adapterRegistry.register(new MusicGenAdapter());
  // Local
  adapterRegistry.register(new OllamaAdapter());
  adapterRegistry.register(new ComfyUIAdapter());
  adapterRegistry.register(new SDWebUIAdapter());
  return adapterRegistry;
}

export function createLLMRegistry(): LLMRegistry {
  const llmRegistry = new LLMRegistry();
  for (const preset of listBuiltinLLMProviderPresets()) {
    llmRegistry.register(buildRuntimeLLMAdapter(preset));
  }
  for (const preset of listBuiltinVisionProviderPresets()) {
    llmRegistry.register(buildRuntimeLLMAdapter(preset));
  }
  return llmRegistry;
}

export function initApp(codexRuntime?: CodexRuntime) {
  // Wire provider health tracker warn logger
  providerHealth.setWarnLogger((message, meta) => log.warn(message, meta));

  // Ensure app directory exists before DB/assets creation
  if (!fs.existsSync(APP_DIR)) {
    fs.mkdirSync(APP_DIR, { recursive: true });
  }

  const dbPath = path.join(APP_DIR, 'lucid-fin.db');
  const promptDbPath = path.join(APP_DIR, 'prompts.db');
  const assetsRoot = path.join(APP_DIR, 'assets');

  const db = new SqliteIndex(dbPath);
  const workerPath = path.join(__dirname, '../workers/hash.worker.js');
  const cas = new CAS(assetsRoot, workerPath);
  const keychain = new Keychain();

  const adapterRegistry = createAdapterRegistry(codexRuntime);
  const llmRegistry = createLLMRegistry();

  // Prompt template store
  const promptStore = new PromptStore(promptDbPath);
  const processPromptStore = new ProcessPromptStore(promptDbPath);

  // Agent system
  const toolRegistry = new ToolRegistry();

  return {
    db,
    cas,
    keychain,
    adapterRegistry,
    llmRegistry,
    promptStore,
    processPromptStore,
    toolRegistry,
  };
}

export function registerOAuthAdapters(
  manager: ProviderOAuthManager,
  adapterRegistry: AdapterRegistry,
  llmRegistry: LLMRegistry,
): void {
  adapterRegistry.register(new CodexImageGenAdapter(manager.getCodexRuntime('image')));
  llmRegistry.register(
    new CodexLLMAdapter('chatgpt-oauth', 'ChatGPT (OAuth)', 'llm', manager.getCodexRuntime('llm')),
  );
  llmRegistry.register(
    new CodexLLMAdapter(
      'chatgpt-vision-oauth',
      'ChatGPT Vision (OAuth)',
      'vision',
      manager.getCodexRuntime('vision'),
    ),
  );
}

export async function selectConfiguredLLMAdapter(
  adapters: readonly LLMAdapter[],
): Promise<LLMAdapter> {
  // Check all adapters in parallel, return first valid one by original order
  const results = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        const valid = await adapter.validate();
        return { adapter, valid };
      } catch (err) {
        log.warn('adapter.validate() threw', {
          category: 'provider',
          adapterId: adapter.id,
          error: String(err),
        });
        return { adapter, valid: false };
      }
    }),
  );
  const found = results.find((r) => r.valid);
  if (found) {
    log.info('Selected configured LLM adapter', {
      category: 'provider',
      adapterId: found.adapter.id,
      adapterName: found.adapter.name,
      adapterCount: adapters.length,
    });
    return found.adapter;
  }
  log.warn('No configured LLM adapters found', {
    category: 'provider',
    adapterCount: adapters.length,
  });
  throw new Error('No configured LLM adapter');
}

/** Restore saved API keys from keychain to adapters */
export async function restoreAdapterKeys(
  keychain: Keychain,
  registry: AdapterRegistry,
  llmRegistry: LLMRegistry,
): Promise<void> {
  // Run all keychain lookups in parallel to avoid sequential blocking
  const mediaAdapters = registry.list();
  const llmAdapters = llmRegistry.list();

  const configuredMediaAdapters = new Set<string>();
  const catalogBindings = listBuiltinMediaProviders()
    .filter((entry) => entry.access !== 'managed')
    .map((entry) => ({
      entry,
      adapter: registry.resolve(entry.providerId, entry.group),
    }))
    .filter((binding) => binding.adapter !== undefined);
  const catalogResults = await Promise.all(
    catalogBindings.map(async ({ entry, adapter }) => ({
      entry,
      adapter,
      key: await keychain.getKey(entry.credentialId),
    })),
  );
  for (const { entry, adapter, key } of catalogResults) {
    if (!adapter || !key) continue;
    adapter.configure(key, { generationType: entry.group });
    configuredMediaAdapters.add(adapter.id);
  }

  // Preserve existing installations whose secrets were stored under legacy
  // adapter IDs, and restore non-image/video adapters that are not catalogued.
  const legacyMediaResults = await Promise.all(
    mediaAdapters
      .filter(
        (adapter) => adapter.credentialMode !== 'oauth' && !configuredMediaAdapters.has(adapter.id),
      )
      .map(async (adapter) => ({ adapter, key: await keychain.getKey(adapter.id) })),
  );
  for (const { adapter, key } of legacyMediaResults) {
    if (key) adapter.configure(key);
  }

  const llmResults = await Promise.all(
    llmAdapters
      .filter((adapter) => adapter.credentialMode !== 'oauth')
      .map(async (adapter) => {
        const key = await keychain.getKey(adapter.id);
        return { adapter, key };
      }),
  );
  for (const { adapter, key } of llmResults) {
    if (key) adapter.configure(key);
  }
}
