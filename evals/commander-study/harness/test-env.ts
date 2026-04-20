/**
 * Per-user temp environment. Boots the same SQLite + CAS + stores the
 * production main process uses, minus the Electron-only surface (windows,
 * IPC wiring, settings-cache, log forwarder). The electron shim (imported
 * upstream by run-*.ts before this file loads) lets us re-use the real
 * desktop-main modules without a running Electron runtime.
 *
 * Each user gets their own temp dir under `os.tmpdir()` so parallel runs
 * can't step on each other.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { CAS, SqliteIndex, Keychain, PromptStore, ProcessPromptStore } from '@lucid-fin/storage';
import {
  AdapterRegistry,
  LLMRegistry,
  buildRuntimeLLMAdapter,
  listBuiltinLLMProviderPresets,
  ReplicateAdapter,
} from '@lucid-fin/adapters-ai';
import {
  AgentToolRegistry,
  JobQueue,
  WorkflowEngine,
  registerDefaultWorkflows,
} from '@lucid-fin/application';
import type { Canvas } from '@lucid-fin/contracts';

import { createCanvasStore, type CanvasStore } from '../../../apps/desktop-main/src/ipc/handlers/canvas.handlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TestEnv {
  dir: string;
  db: SqliteIndex;
  cas: CAS;
  keychain: Keychain;
  canvasStore: CanvasStore;
  adapterRegistry: AdapterRegistry;
  llmRegistry: LLMRegistry;
  promptStore: PromptStore;
  processPromptStore: ProcessPromptStore;
  jobQueue: JobQueue;
  workflowEngine: WorkflowEngine;
  toolRegistry: AgentToolRegistry;
  close: () => Promise<void>;
}

export interface CreateTestEnvOptions {
  dir?: string;
  canvasName?: string;
}

export interface TestEnvWithCanvas {
  env: TestEnv;
  canvasId: string;
}

export async function createTestEnv(options: CreateTestEnvOptions = {}): Promise<TestEnvWithCanvas> {
  const dir = options.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-fin-fake-'));
  fs.mkdirSync(dir, { recursive: true });

  const dbPath = path.join(dir, 'lucid-fin.db');
  const promptDbPath = path.join(dir, 'prompts.db');
  const assetsRoot = path.join(dir, 'assets');

  const db = new SqliteIndex(dbPath);
  // Hash worker path is only touched when CAS.putBuffer() runs; harness mocks
  // all gen tools so assets are never materialised. A dummy path is safe.
  const cas = new CAS(assetsRoot, path.join(__dirname, 'noop-hash.worker.js'));
  const keychain = new Keychain();

  const adapterRegistry = new AdapterRegistry();
  adapterRegistry.register(new ReplicateAdapter());

  const llmRegistry = new LLMRegistry();
  for (const preset of listBuiltinLLMProviderPresets()) {
    llmRegistry.register(buildRuntimeLLMAdapter(preset));
  }

  const promptStore = new PromptStore(promptDbPath);
  const processPromptStore = new ProcessPromptStore(promptDbPath);

  const canvasStore = createCanvasStore(db);

  const jobQueue = new JobQueue(db.repos.jobs, adapterRegistry);
  await jobQueue.recover();
  jobQueue.start();

  const workflowEngine = new WorkflowEngine({
    db,
    registry: registerDefaultWorkflows(),
    // Harness mocks every media-gen tool; workflow handlers aren't needed.
    handlers: [],
  });

  const toolRegistry = new AgentToolRegistry();

  const now = Date.now();
  const canvasId = randomUUID();
  const canvas: Canvas = {
    id: canvasId,
    name: options.canvasName ?? `fake-user-${canvasId.slice(0, 8)}`,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: now,
    updatedAt: now,
  };
  canvasStore.save(canvas);

  const env: TestEnv = {
    dir,
    db,
    cas,
    keychain,
    canvasStore,
    adapterRegistry,
    llmRegistry,
    promptStore,
    processPromptStore,
    jobQueue,
    workflowEngine,
    toolRegistry,
    close: async () => {
      try { jobQueue.stop?.(); } catch { /* noop */ }
      try { db.close?.(); } catch { /* noop */ }
    },
  };

  return { env, canvasId };
}
