import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import log from '../logger.js';
import { ProjectFS, CAS, SqliteIndex, Keychain, PromptStore } from '@lucid-fin/storage';
import {
  AdapterRegistry,
  // Image adapters
  OpenAIDalleAdapter,
  ReplicateAdapter,
  IdeogramAdapter,
  GoogleImagen3Adapter,
  RecraftAdapter,
  // Video adapters
  RunwayAdapter,
  VeoAdapter,
  LumaAdapter,
  MiniMaxAdapter,
  PikaAdapter,
  KlingAdapter,
  WanAdapter,
  SeedanceAdapter,
  HunyuanVideoAdapter,
  // Audio adapters
  ElevenLabsAdapter,
  ElevenLabsSFXAdapter,
  OpenAITTSAdapter,
  CartesiaSonicAdapter,
  PlayHTAdapter,
  FishAudioAdapter,
  StabilityAudioAdapter,
  // LLM adapters
  LLMRegistry,
  OpenAILLMAdapter,
  ClaudeLLMAdapter,
  GeminiLLMAdapter,
  buildRuntimeLLMAdapter,
  listBuiltinLLMProviderPresets,
} from '@lucid-fin/adapters-ai';
import { AgentToolRegistry } from '@lucid-fin/application';
import type { LLMAdapter } from '@lucid-fin/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.join(os.homedir(), '.lucid-fin');

const MEDIA_PROVIDER_KEY_ALIASES: Record<string, readonly string[]> = {
  'openai-dalle': ['openai-image', 'openai'],
  'google-imagen3': ['google-image'],
  'google-veo-2': ['google-video'],
  'recraft-v3': ['recraft-v4', 'recraft'],
  'runway-gen4': ['runway'],
  'luma-ray2': ['luma'],
  'minimax-video01': ['minimax'],
  'pika-v2': ['pika'],
  'elevenlabs-v2': ['elevenlabs'],
  'openai-tts-1-hd': ['openai-tts', 'openai'],
  'cartesia-sonic': ['cartesia'],
  'playht-3': ['playht'],
  'fish-audio-v1': ['fish-audio'],
};

export function resolveMediaProviderIds(providerId: string): string[] {
  const ids = new Set<string>([providerId]);
  const aliases = MEDIA_PROVIDER_KEY_ALIASES[providerId];
  if (aliases) {
    for (const alias of aliases) {
      ids.add(alias);
    }
  }
  for (const [adapterId, legacyIds] of Object.entries(MEDIA_PROVIDER_KEY_ALIASES)) {
    if (legacyIds.includes(providerId)) {
      ids.add(adapterId);
    }
  }
  return Array.from(ids);
}

export function createAdapterRegistry(): AdapterRegistry {
  const adapterRegistry = new AdapterRegistry();
  // Image
  adapterRegistry.register(new OpenAIDalleAdapter());
  adapterRegistry.register(new ReplicateAdapter());
  adapterRegistry.register(new IdeogramAdapter());
  adapterRegistry.register(new GoogleImagen3Adapter());
  adapterRegistry.register(new RecraftAdapter());
  // Video
  adapterRegistry.register(new RunwayAdapter());
  adapterRegistry.register(new VeoAdapter());
  adapterRegistry.register(new LumaAdapter());
  adapterRegistry.register(new MiniMaxAdapter());
  adapterRegistry.register(new PikaAdapter());
  adapterRegistry.register(new KlingAdapter());
  adapterRegistry.register(new WanAdapter());
  adapterRegistry.register(new SeedanceAdapter());
  adapterRegistry.register(new HunyuanVideoAdapter());
  // Audio
  adapterRegistry.register(new ElevenLabsAdapter());
  adapterRegistry.register(new ElevenLabsSFXAdapter());
  adapterRegistry.register(new OpenAITTSAdapter());
  adapterRegistry.register(new CartesiaSonicAdapter());
  adapterRegistry.register(new PlayHTAdapter());
  adapterRegistry.register(new FishAudioAdapter());
  adapterRegistry.register(new StabilityAudioAdapter());
  return adapterRegistry;
}

export function createLLMRegistry(): LLMRegistry {
  const llmRegistry = new LLMRegistry();
  for (const preset of listBuiltinLLMProviderPresets()) {
    llmRegistry.register(buildRuntimeLLMAdapter(preset));
  }
  return llmRegistry;
}

export function initApp() {
  // Ensure app directory exists before DB/assets creation
  if (!fs.existsSync(APP_DIR)) {
    fs.mkdirSync(APP_DIR, { recursive: true });
  }

  const dbPath = path.join(APP_DIR, 'lucid-fin.db');
  const promptDbPath = path.join(APP_DIR, 'prompts.db');
  const assetsRoot = path.join(APP_DIR, 'assets');

  const db = new SqliteIndex(dbPath);
  const projectFS = new ProjectFS();
  const workerPath = path.join(__dirname, '../workers/hash.worker.js');
  const cas = new CAS(assetsRoot, workerPath);
  const keychain = new Keychain();

  const adapterRegistry = createAdapterRegistry();
  const llmRegistry = createLLMRegistry();

  // Prompt template store
  const promptStore = new PromptStore(promptDbPath);

  // Agent system
  const toolRegistry = new AgentToolRegistry();

  return { db, projectFS, cas, keychain, adapterRegistry, llmRegistry, promptStore, toolRegistry };
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

  const mediaResults = await Promise.all(
    mediaAdapters.map(async (adapter) => {
      const key = await getFirstConfiguredKey(keychain, resolveMediaProviderIds(adapter.id));
      return { adapter, key };
    }),
  );
  for (const { adapter, key } of mediaResults) {
    if (key) adapter.configure(key);
  }

  const llmResults = await Promise.all(
    llmAdapters.map(async (adapter) => {
      const key = await getFirstConfiguredKey(keychain, [adapter.id]);
      return { adapter, key };
    }),
  );
  for (const { adapter, key } of llmResults) {
    if (key) adapter.configure(key);
  }
}

async function getFirstConfiguredKey(
  keychain: Keychain,
  providerIds: readonly string[],
): Promise<string | null> {
  for (const providerId of providerIds) {
    const key = await keychain.getKey(providerId);
    if (key) {
      return key;
    }
  }
  return null;
}
