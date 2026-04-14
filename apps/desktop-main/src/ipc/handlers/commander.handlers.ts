/**
 * Commander IPC handler — the thin orchestration shell.
 *
 * Delegates to:
 *  - commander-tool-deps.ts   — tool registration & canvas/entity helpers
 *  - commander-image-gen.ts   — image generation & asset materialisation
 *  - commander-emit.ts        — event mapping, window emission, logging
 *  - commander-registry.ts    — running session bookkeeping
 *  - commander-meta.handlers.ts — meta IPC (abort, confirm, etc.)
 */
import type { BrowserWindow, IpcMain } from 'electron';
import log from '../../logger.js';
import type { AdapterRegistry, LLMRegistry } from '@lucid-fin/adapters-ai';
import { runningSessions, setLastToolRegistry, touchSession, type RunningCommanderSession } from './commander-registry.js';
import { registerCommanderMetaHandlers } from './commander-meta.handlers.js';
import {
  AgentOrchestrator,
  AgentToolRegistry,
  type JobQueue,
  type WorkflowEngine,
  type AgentContext,
  type HistoryEntry,
} from '@lucid-fin/application';
import type {
  LLMProviderRuntimeConfig,
  Canvas,
  PresetDefinition,
} from '@lucid-fin/contracts';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import type { CanvasStore } from './canvas.handlers.js';
import {
  createConfiguredLLMAdapter,
  getLLMProviderLogFields,
  resolveLLMProviderRuntimeConfig,
} from '../../llm-provider-runtime.js';

// Extracted modules
import { requireCanvas, type ToolRegistrationDeps } from './commander-tool-deps.js';
import { registerAllTools } from './commander-tool-deps.js';
import { createEmitHandler, formatErrorDetail, emitToWindow } from './commander-emit.js';

// ---------------------------------------------------------------------------
// Mutating tool name sets (used by emit handler for sync dispatch)
// ---------------------------------------------------------------------------

export const mutatingToolNames = new Set([
  'canvas.addNode',
  'canvas.renameCanvas',
  'canvas.deleteCanvas',
  'canvas.connectNodes',
  'canvas.layout',
  'canvas.generate',
  'canvas.cancelGeneration',
  'canvas.deleteNode',
  'canvas.deleteEdge',
  'canvas.updateNodes',
  'canvas.setNodeRefs',
  'canvas.batchCreate',
  'canvas.writeNodePresetTracks',
  'canvas.updateBackdrop',
  'canvas.presetEntry',
  'canvas.applyShotTemplate',
  'canvas.setVideoFrames',
  'canvas.swapEdgeDirection',
  'canvas.disconnectNode',
  'canvas.selectVariant',
  'canvas.undo',
  'canvas.redo',
  'preset.save',
  'shotTemplate.save',
  'shotTemplate.delete',
]);

export const entityMutatingToolNames = new Set([
  'character.create',
  'character.update',
  'character.delete',
  'character.refImage',
  'equipment.create',
  'equipment.update',
  'equipment.delete',
  'equipment.refImage',
  'location.create',
  'location.update',
  'location.delete',
  'location.refImage',
  'scene.create',
  'scene.update',
  'scene.delete',
  'scene.refImage',
]);

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

const MAX_CONTEXT_SELECTED_NODES = 10;

export function buildContext(
  canvas: Canvas,
  _presetLibrary: PresetDefinition[],
  selectedNodeIds: string[],
  _db: SqliteIndex,
  _promptGuides?: Array<{ id: string; name: string; content: string }>,
): AgentContext {
  const extra: Record<string, unknown> = {
    canvasId: canvas.id,
    nodeCount: canvas.nodes.length,
    edgeCount: canvas.edges.length,
    selectedNodeIds: selectedNodeIds.slice(0, MAX_CONTEXT_SELECTED_NODES),
  };
  return { page: 'canvas', extra };
}

// ---------------------------------------------------------------------------
// LLM adapter selection
// ---------------------------------------------------------------------------

async function selectConfiguredAdapter(
  llmRegistry: LLMRegistry,
  keychain: import('@lucid-fin/storage').Keychain,
  customProvider?: LLMProviderRuntimeConfig,
) {
  const logAttempt = (level: 'info' | 'warn' | 'error', message: string, detail: Record<string, unknown>) => {
    log[level](message, { category: 'provider', ...detail });
  };

  if (customProvider?.id) {
    if (!customProvider.baseUrl || !customProvider.model) {
      const runtimeConfig = resolveLLMProviderRuntimeConfig(customProvider);
      logAttempt('warn', 'Selected LLM provider is missing runtime connection fields', {
        ...getLLMProviderLogFields(runtimeConfig),
      });
      throw new Error(
        `Selected LLM provider "${runtimeConfig.name}" is missing a base URL or model.`,
      );
    }

    const runtimeConfig = resolveLLMProviderRuntimeConfig(customProvider);
    const apiKey = await keychain.getKey(runtimeConfig.id);
    const configuredAdapter = createConfiguredLLMAdapter(llmRegistry, runtimeConfig, apiKey);
    const source = llmRegistry.list().find((adapter) => adapter.id === runtimeConfig.id)
      ? 'selected-registered-provider'
      : 'selected-custom-provider';

    if (!apiKey && runtimeConfig.authStyle !== 'none') {
      logAttempt('warn', 'Selected LLM provider has no stored API key', {
        ...getLLMProviderLogFields(runtimeConfig),
        source,
      });
      throw new Error(`Selected LLM provider "${runtimeConfig.name}" has no API key configured.`);
    }

    logAttempt('info', 'Selected LLM provider configured for commander chat', {
      ...getLLMProviderLogFields(runtimeConfig),
      source,
    });
    return configuredAdapter;
  }

  logAttempt('warn', 'Commander chat requested without a selected LLM provider runtime config', {
    source: 'missing-selected-provider',
  });
  throw new Error('No configured LLM adapter. Please configure an AI provider in Settings.');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateHistoryEntries(history: HistoryEntry[]): void {
  for (const entry of history) {
    if (!entry || typeof entry.content !== 'string') {
      throw new Error('history entries must contain a valid role and content');
    }
    if (entry.role === 'tool') {
      if (typeof (entry as { toolCallId?: unknown }).toolCallId !== 'string') {
        throw new Error('tool history entries must contain a toolCallId');
      }
    } else if (entry.role !== 'user' && entry.role !== 'assistant') {
      throw new Error('history entries must contain a valid role and content');
    }
  }
}

// ---------------------------------------------------------------------------
// Main registration
// ---------------------------------------------------------------------------

export function registerCommanderHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  deps: {
    adapterRegistry: AdapterRegistry;
    llmRegistry: LLMRegistry;
    canvasStore: CanvasStore;
    presetLibrary: PresetDefinition[];
    jobQueue: JobQueue;
    workflowEngine: WorkflowEngine;
    db: SqliteIndex;
    cas: CAS;
    keychain: import('@lucid-fin/storage').Keychain;
    resolvePrompt: (code: string) => string;
  },
): void {
  ipcMain.handle(
    'commander:chat',
    async (
      _event,
      args: {
        canvasId: string;
        message: string;
        history: HistoryEntry[];
        selectedNodeIds: string[];
        promptGuides?: Array<{ id: string; name: string; content: string }>;
        customLLMProvider?: LLMProviderRuntimeConfig;
        permissionMode?: 'auto' | 'normal' | 'strict';
        locale?: string;
        maxSteps?: number;
        temperature?: number;
        maxTokens?: number;
      },
    ) => {
      if (!args || typeof args.canvasId !== 'string' || !args.canvasId.trim()) {
        throw new Error('canvasId is required');
      }
      if (!args.message || typeof args.message !== 'string' || !args.message.trim()) {
        throw new Error('message is required');
      }
      if (!Array.isArray(args.history)) {
        throw new Error('history must be an array');
      }
      if (!Array.isArray(args.selectedNodeIds)) {
        throw new Error('selectedNodeIds must be an array');
      }
      validateHistoryEntries(args.history);
      if (runningSessions.size > 0) {
        throw new Error('Commander already has an active session');
      }

      let session: RunningCommanderSession | undefined;
      try {
        const canvas = requireCanvas(deps.canvasStore, args.canvasId);
        log.debug('Commander chat request received', {
          category: 'commander',
          canvasId: args.canvasId,
          selectedNodeCount: args.selectedNodeIds.length,
          historyCount: args.history.length,
          promptGuideCount: Array.isArray(args.promptGuides) ? args.promptGuides.length : 0,
          promptGuideChars: Array.isArray(args.promptGuides)
            ? args.promptGuides.reduce((sum, guide) => sum + guide.content.length, 0)
            : 0,
          providerId: args.customLLMProvider?.id,
          providerBaseUrl: args.customLLMProvider?.baseUrl,
          providerModel: args.customLLMProvider?.model,
          providerProtocol: args.customLLMProvider?.protocol,
          providerAuthStyle: args.customLLMProvider?.authStyle,
          permissionMode: args.permissionMode ?? 'normal',
        });

        const llmAdapter = await selectConfiguredAdapter(deps.llmRegistry, deps.keychain, args.customLLMProvider);

        // Build tool registry
        const registry = new AgentToolRegistry();
        const compactRef: { compact?: (instructions?: string) => Promise<{ freedChars: number; messageCount: number; toolCount: number }> } = {};
        const toolDeps: ToolRegistrationDeps = {
          adapterRegistry: deps.adapterRegistry,
          llmRegistry: deps.llmRegistry,
          canvasStore: deps.canvasStore,
          presetLibrary: deps.presetLibrary,
          jobQueue: deps.jobQueue,
          workflowEngine: deps.workflowEngine,
          db: deps.db,
          cas: deps.cas,
          keychain: deps.keychain,
        };
        registerAllTools(registry, toolDeps, getWindow, args.promptGuides ?? [], compactRef);
        setLastToolRegistry(registry);

        // Create orchestrator
        const orchestrator = new AgentOrchestrator(llmAdapter, registry, deps.resolvePrompt, {
          maxSteps: typeof args.maxSteps === 'number' ? args.maxSteps : undefined,
          temperature: typeof args.temperature === 'number' ? args.temperature : undefined,
          maxTokens: typeof args.maxTokens === 'number' ? args.maxTokens : undefined,
        });
        compactRef.compact = (instructions?: string) => orchestrator.compactNow(instructions);
        session = { aborted: false, canvasId: args.canvasId, orchestrator, lastActivity: Date.now() };
        runningSessions.set(args.canvasId, session);

        const context = buildContext(canvas, deps.presetLibrary, args.selectedNodeIds, deps.db, args.promptGuides);
        if (args.locale && typeof args.locale === 'string') {
          const extra = context.extra as Record<string, unknown>;
          extra['Current language'] = args.locale;
        }
        const contextExtra = context.extra as Record<string, unknown> | undefined;
        log.debug('Commander context prepared', {
          category: 'commander',
          canvasId: args.canvasId,
          contextKeys: contextExtra ? Object.keys(contextExtra) : [],
          compactPromptGuideChars: 0,
          compactPromptGuideCount: 0,
        });

        // Build emit handler
        const emit = createEmitHandler(
          getWindow,
          args.canvasId,
          deps.canvasStore,
          mutatingToolNames,
          entityMutatingToolNames,
        );

        await orchestrator.execute(args.message, context, emit, {
          history: args.history,
          isAborted: () => session?.aborted ?? false,
          permissionMode: args.permissionMode ?? 'normal',
          onLLMRequest: (diagnostics: {
            step: number;
            toolCount: number;
            toolSchemaChars: number;
            messageCount: number;
            messageChars: number;
            systemPromptChars: number;
            promptGuideChars: number;
          }) => {
            touchSession(args.canvasId);
            log.debug('Commander LLM request prepared', {
              category: 'commander',
              canvasId: args.canvasId,
              providerId: args.customLLMProvider?.id,
              providerBaseUrl: args.customLLMProvider?.baseUrl,
              providerModel: args.customLLMProvider?.model,
              step: diagnostics.step,
              toolCount: diagnostics.toolCount,
              toolSchemaChars: diagnostics.toolSchemaChars,
              messageCount: diagnostics.messageCount,
              messageChars: diagnostics.messageChars,
              systemPromptChars: diagnostics.systemPromptChars,
              promptGuideChars: diagnostics.promptGuideChars,
            });
          },
        });
      } catch (error) {
        log.error('Commander chat failed', {
          category: 'commander',
          canvasId: args.canvasId,
          selectedNodeCount: args.selectedNodeIds.length,
          historyCount: args.history.length,
          providerId: args.customLLMProvider?.id,
          providerBaseUrl: args.customLLMProvider?.baseUrl,
          providerModel: args.customLLMProvider?.model,
          providerProtocol: args.customLLMProvider?.protocol,
          providerAuthStyle: args.customLLMProvider?.authStyle,
          detail: formatErrorDetail(error),
        });
        emitToWindow(getWindow, 'commander:stream', {
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        runningSessions.delete(args.canvasId);
      }
    },
  );

  registerCommanderMetaHandlers(ipcMain);
}
