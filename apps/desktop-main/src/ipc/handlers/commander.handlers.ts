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
import { trackEvent } from '../../analytics.js';
import type { AdapterRegistry, LLMRegistry } from '@lucid-fin/adapters-ai';
import {
  runningSessions,
  setLastToolRegistry,
  touchSession,
  type RunningCommanderSession,
} from './commander-registry.js';
import { registerCommanderMetaHandlers } from './commander-meta.handlers.js';
import {
  AgentOrchestrator,
  AgentToolRegistry,
  canvasSyncMutatingToolNames,
  createAgentOrchestratorForRun,
  entityMutatingToolNames,
  freshRunId,
  type JobQueue,
  type WorkflowEngine,
  type HistoryEntry,
} from '@lucid-fin/application';
import type {
  LLMProviderRuntimeConfig,
  PresetDefinition,
  ProviderProfile,
  SessionId,
  CommanderProcessBehaviorSettings,
} from '@lucid-fin/contracts';
import { DEFAULT_PROVIDER_PROFILE, COMMANDER_WIRE_VERSION } from '@lucid-fin/contracts';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import type { CanvasStore } from './canvas.handlers.js';

// Extracted modules
import { requireCanvas, type ToolRegistrationDeps } from './commander-tool-deps/index.js';
import { registerAllTools } from './commander-tool-deps/index.js';
import { createEmitHandler, formatErrorDetail } from './commander-emit.js';
import { commanderStreamChannel } from '@lucid-fin/contracts-parse';
import { createRendererPushGateway } from '../../features/ipc/push-gateway.js';
import {
  buildContext,
  buildPersistentWorkflowContext,
  buildPersistentWorkflowManifest,
  buildWorkspaceSnapshot,
} from './commander-context.service.js';
import { selectConfiguredAdapter, validateHistoryEntries } from './commander-llm.js';

// Re-exported here so existing imports (tests, etc.) continue to resolve.
export { canvasSyncMutatingToolNames, entityMutatingToolNames };
export { buildContext, buildWorkspaceSnapshot } from './commander-context.service.js';

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
    promptStore: import('@lucid-fin/storage').PromptStore;
    finalExportService: import('../../services/final-export.service.js').FinalExportService;
    productionMediaService: import('../../services/production-media.service.js').ProductionMediaService;
    resolvePrompt: (code: string) => string;
    resolveProcessPrompt: (processKey: string) => string | null;
    listProcessPromptKeys?: () => Array<{ processKey: string; name: string }>;
  },
): void {
  // Shared gateway for all push sends originating from commander handlers.
  // Individual call sites pass typed channel defs from
  // `@lucid-fin/contracts-parse` so payload drift throws loudly in main.
  const gateway = createRendererPushGateway({ getWindow });

  ipcMain.handle(
    'commander:chat',
    async (
      _event,
      args: {
        canvasId: string;
        sessionId?: string;
        message: string;
        history: HistoryEntry[];
        selectedNodeIds: string[];
        promptGuides?: Array<{ id: string; name: string; content: string; autoInject?: boolean }>;
        customLLMProvider?: LLMProviderRuntimeConfig;
        permissionMode?: 'danger' | 'auto' | 'normal' | 'strict';
        locale?: string;
        maxSteps?: number;
        temperature?: number;
        maxTokens?: number;
        defaultProviders?: Record<string, string>;
        processSettings?: CommanderProcessBehaviorSettings;
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

      const MAX_STEPS = 200;
      const MAX_TOKENS = 200_000;
      const MAX_HISTORY = 200;
      if (typeof args.maxSteps === 'number' && args.maxSteps > MAX_STEPS) {
        throw new Error(`maxSteps exceeds limit (${MAX_STEPS})`);
      }
      if (typeof args.maxTokens === 'number' && args.maxTokens > MAX_TOKENS) {
        throw new Error(`maxTokens exceeds limit (${MAX_TOKENS})`);
      }
      if (args.history.length > MAX_HISTORY) {
        throw new Error(`history length exceeds limit (${MAX_HISTORY})`);
      }

      if (runningSessions.has(args.canvasId)) {
        throw new Error('Commander already has an active session for this canvas');
      }

      let session: RunningCommanderSession | undefined;
      // Hoisted so the `finally` block can access them for G2-5 graph save.
      let orchestrator: AgentOrchestrator | undefined;
      let persistedSessionId: SessionId | null = null;
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

        trackEvent('commander_session_started');

        const llmAdapter = await selectConfiguredAdapter(
          deps.llmRegistry,
          deps.keychain,
          args.customLLMProvider,
        );

        // Build tool registry
        const registry = new AgentToolRegistry();
        const compactRef: {
          compact?: (
            instructions?: string,
          ) => Promise<{ freedChars: number; messageCount: number; toolCount: number }>;
        } = {};
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
          promptStore: deps.promptStore,
          finalExportService: deps.finalExportService,
          productionMediaService: deps.productionMediaService,
        };
        const processPromptGuides = (deps.listProcessPromptKeys?.() ?? [])
          .map((entry) => ({
            id: `process:${entry.processKey}`,
            name: entry.name,
            content: deps.resolveProcessPrompt(entry.processKey) ?? '',
          }))
          .filter((g) => g.content.length > 0);
        registerAllTools(
          registry,
          toolDeps,
          getWindow,
          args.promptGuides ?? [],
          compactRef,
          args.sessionId ?? args.canvasId,
          args.defaultProviders as Record<string, string> | undefined,
          gateway,
          processPromptGuides,
        );
        setLastToolRegistry(registry);

        // Create orchestrator. Phase D: factory is the only supported
        // construction path — do not replace with direct `new AgentOrchestrator`.
        const adapterProfile: ProviderProfile = llmAdapter.profile ?? DEFAULT_PROVIDER_PROFILE;
        const orchestratorInstance = createAgentOrchestratorForRun({
          variant: 'production',
          llmAdapter,
          toolRegistry: registry,
          resolvePrompt: deps.resolvePrompt,
          canvasStore: deps.canvasStore,
          options: {
            maxSteps: typeof args.maxSteps === 'number' ? args.maxSteps : undefined,
            temperature: typeof args.temperature === 'number' ? args.temperature : undefined,
            // Legacy renderer field `maxTokens` is the user context-window
            // cap. It must never be forwarded as a provider output limit.
            contextWindowTokens: typeof args.maxTokens === 'number' ? args.maxTokens : undefined,
            profile: adapterProfile,
            qualityGateBehavior: args.processSettings?.qualityGateBehavior,
            requireStylePlateBeforeRefImage: args.processSettings?.requireStylePlateBeforeRefImage,
            resolvePersistentContext: () => buildPersistentWorkflowContext(deps.db, args.canvasId),
            onBeforeCompact: () => {
              const projection = buildPersistentWorkflowContext(deps.db, args.canvasId);
              const policy = projection.workflowToolPolicy;
              if (!policy) return true;
              if (!policy.workflowRunId || policy.phase === 'blocked') return false;
              const runId = policy.workflowRunId as import('@lucid-fin/contracts').WorkflowRunId;
              const documentRefs = Object.fromEntries(
                [
                  ['productionPlan', 'production-plan'],
                  ['visualConstitution', 'visual-constitution'],
                  ['finalExport', 'final-export'],
                ].flatMap(([label, logicalKey]) => {
                  const document = deps.db.repos.workflows.getLatestDocument(runId, logicalKey);
                  return document
                    ? [[label, { revision: document.revision, contentHash: document.contentHash }]]
                    : [];
                }),
              );
              deps.workflowEngine.createContextCheckpoint(policy.workflowRunId, {
                canvasId: args.canvasId,
                rowVersion: policy.rowVersion,
                phase: policy.phase,
                gate: policy.gate ?? null,
                documentRefs,
              });
              return true;
            },
            onPostCompact: () => {
              try {
                const currentCanvas = deps.canvasStore.get(args.canvasId);
                if (!currentCanvas) return null;
                const workspace = buildWorkspaceSnapshot(
                  currentCanvas,
                  args.selectedNodeIds,
                  deps.db,
                );
                const workflowManifest = buildPersistentWorkflowManifest(deps.db, args.canvasId);
                return [workspace, workflowManifest].filter(Boolean).join('\n\n');
              } catch {
                return null;
              }
            },
          },
        });
        orchestrator = orchestratorInstance;
        compactRef.compact = (instructions?: string) =>
          orchestratorInstance.compactNow(instructions);
        session = {
          aborted: false,
          canvasId: args.canvasId,
          orchestrator: orchestratorInstance,
          lastActivity: Date.now(),
        };
        runningSessions.set(args.canvasId, session);

        // G2-5: rehydrate ContextGraph from storage. Seeds graph-only items
        // (entity-snapshot, session-summary) that aren't derivable from the
        // message history — cache warm-up on resume without replaying raw
        // messages. No-op when the session is brand-new or has no saved
        // graph yet; fail-soft on malformed JSON (SessionRepository returns
        // null via parseOrDegrade in that case).
        const persistedSessionIdLocal: SessionId | null =
          typeof args.sessionId === 'string' && args.sessionId.length > 0
            ? (args.sessionId as SessionId)
            : null;
        persistedSessionId = persistedSessionIdLocal;
        if (persistedSessionIdLocal) {
          try {
            const persistedGraph = deps.db.repos.sessions.getContextGraph(persistedSessionIdLocal);
            if (persistedGraph && persistedGraph.length > 0) {
              orchestratorInstance.seedContextGraph(persistedGraph);
            }
          } catch (err) {
            log.warn('ContextGraph rehydrate skipped', {
              category: 'commander',
              sessionId: persistedSessionIdLocal,
              detail: err instanceof Error ? err.message : String(err),
            });
          }
        }

        const context = buildContext(
          canvas,
          deps.presetLibrary,
          args.selectedNodeIds,
          deps.db,
          args.promptGuides,
        );
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
          canvasSyncMutatingToolNames,
          entityMutatingToolNames,
          gateway,
          persistedSessionIdLocal
            ? {
                sessionId: persistedSessionIdLocal,
                eventRepo: deps.db.repos.commanderEvents,
              }
            : undefined,
        );

        await orchestratorInstance.execute(args.message, context, emit, {
          history: args.history,
          isAborted: () => session?.aborted ?? false,
          permissionMode: args.permissionMode ?? 'normal',
          onLLMRequest: (diagnostics) => {
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
              estimatedTokensUsed: diagnostics.estimatedTokensUsed,
              contextWindowTokens: diagnostics.contextWindowTokens,
              cacheChars: diagnostics.cacheChars,
              cacheEntryCount: diagnostics.cacheEntryCount,
              utilizationRatio: diagnostics.utilizationRatio,
            });
            // `commander:stream` `context_usage` is emitted from the
            // orchestrator itself so it picks up `runId`/`step`/`emittedAt`
            // automatically. This hook is log-only.
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
        // Error event emitted outside the orchestrator's stamped wrapper.
        // We mint a fresh `runId`, then emit `assistant_text` + `run_end`
        // (status: 'failed') so the renderer's timeline closes the run
        // cleanly without a follow-up frame.
        const errorRunId = freshRunId();
        const now = Date.now();
        const errorMessage = error instanceof Error ? error.message : String(error);
        gateway.emit(commanderStreamChannel, {
          wireVersion: COMMANDER_WIRE_VERSION,
          event: {
            kind: 'assistant_text',
            content: errorMessage,
            isDelta: false,
            runId: errorRunId,
            step: 0,
            seq: 0,
            emittedAt: now,
          },
        });
        gateway.emit(commanderStreamChannel, {
          wireVersion: COMMANDER_WIRE_VERSION,
          event: {
            kind: 'run_end',
            status: 'failed',
            runId: errorRunId,
            step: 0,
            seq: 1,
            emittedAt: now,
          },
        });
      } finally {
        // G2-5: persist the serialized ContextGraph side-channel so the
        // next resume can warm up cache without replaying messages. Runs
        // on BOTH success and error paths — a crash mid-turn should still
        // save whatever items have accumulated. Wrapped in try/catch so a
        // persistence failure cannot mask the original error.
        //
        // Skip the save when the orchestrator produced an empty snapshot:
        // early-abort / construction-time failures leave
        // `getSerializedContextGraph()` empty, and overwriting persisted
        // warm-up state with `[]` would lose prior-session data
        // (entity-snapshots, session-summaries). The orchestrator already
        // falls back to the seed on early abort, so `items.length > 0`
        // captures both real results AND preserved-seed cases.
        if (persistedSessionId && orchestrator) {
          try {
            const items = orchestrator.getSerializedContextGraph();
            if (items.length > 0) {
              deps.db.repos.sessions.saveContextGraph(persistedSessionId, items);
            }
          } catch (err) {
            log.warn('ContextGraph save failed', {
              category: 'commander',
              sessionId: persistedSessionId,
              detail: err instanceof Error ? err.message : String(err),
            });
          }
        }
        runningSessions.delete(args.canvasId);
      }
    },
  );

  // v2cut Phase 5: hydrate the renderer's timeline slice from persisted
  // `commander_events` rows. Payload column is stored as stringified JSON;
  // each row's `payload` is the full stamped `TimelineEvent`.
  ipcMain.handle(
    'commander:events:hydrate',
    async (_event, args: { sessionId: string }): Promise<{ events: unknown[] }> => {
      if (!args || typeof args.sessionId !== 'string' || !args.sessionId.trim()) {
        throw new Error('sessionId is required');
      }
      const rows = deps.db.repos.commanderEvents.listBySession(args.sessionId as SessionId);
      const events: unknown[] = [];
      for (const row of rows) {
        try {
          events.push(JSON.parse(row.payload));
        } catch (err) {
          log.warn('Commander event hydrate parse failed', {
            category: 'commander',
            sessionId: args.sessionId,
            runId: row.runId,
            seq: row.seq,
            detail: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return { events };
    },
  );

  registerCommanderMetaHandlers(ipcMain);
}
