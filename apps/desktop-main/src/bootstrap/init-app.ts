import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ProjectFS, CAS, SqliteIndex, Keychain, PromptStore } from '@lucid-fin/storage';
import {
  AdapterRegistry,
  OpenAIDalleAdapter,
  RunwayAdapter,
  FluxAdapter,
  IdeogramAdapter,
  LLMRegistry,
  OpenAILLMAdapter,
  ClaudeLLMAdapter,
  GeminiLLMAdapter,
  OllamaLLMAdapter,
} from '@lucid-fin/adapters-ai';
import { AgentToolRegistry } from '@lucid-fin/application';
import type { LLMAdapter } from '@lucid-fin/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_DIR = path.join(os.homedir(), '.lucid-fin');

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

  // Register media AI adapters
  const adapterRegistry = new AdapterRegistry();
  adapterRegistry.register(new OpenAIDalleAdapter());
  adapterRegistry.register(new RunwayAdapter());
  adapterRegistry.register(new FluxAdapter());
  adapterRegistry.register(new IdeogramAdapter());

  // Register LLM adapters
  const llmRegistry = new LLMRegistry();
  llmRegistry.register(new OpenAILLMAdapter());
  llmRegistry.register(new ClaudeLLMAdapter());
  llmRegistry.register(new GeminiLLMAdapter());
  llmRegistry.register(new OllamaLLMAdapter());

  // Prompt template store
  const promptStore = new PromptStore(promptDbPath);

  // Agent system
  const toolRegistry = new AgentToolRegistry();

  return { db, projectFS, cas, keychain, adapterRegistry, llmRegistry, promptStore, toolRegistry };
}

export async function selectConfiguredLLMAdapter(
  adapters: readonly LLMAdapter[],
): Promise<LLMAdapter> {
  for (const adapter of adapters) {
    if (await adapter.validate()) {
      return adapter;
    }
  }
  throw new Error('No configured LLM adapter');
}

/** Restore saved API keys from keychain to adapters */
export async function restoreAdapterKeys(
  keychain: Keychain,
  registry: AdapterRegistry,
  llmRegistry: LLMRegistry,
): Promise<void> {
  for (const adapter of registry.list()) {
    const key = await keychain.getKey(adapter.id);
    if (key) adapter.configure(key);
  }
  for (const adapter of llmRegistry.list()) {
    const key = await keychain.getKey(adapter.id);
    if (key) adapter.configure(key);
  }
}
