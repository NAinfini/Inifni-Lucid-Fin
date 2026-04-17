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
  canvasSyncMutatingToolNames,
  entityMutatingToolNames,
  type JobQueue,
  type WorkflowEngine,
  type AgentContext,
  type HistoryEntry,
} from '@lucid-fin/application';
import type {
  LLMProviderRuntimeConfig,
  Canvas,
  CanvasNode,
  ImageNodeData,
  VideoNodeData,
  PresetDefinition,
  ProviderProfile,
} from '@lucid-fin/contracts';
import { DEFAULT_PROVIDER_PROFILE } from '@lucid-fin/contracts';
import { matchNode } from '@lucid-fin/shared-utils';
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

// Re-exported here so existing imports (tests, etc.) continue to resolve.
export { canvasSyncMutatingToolNames, entityMutatingToolNames };

// ---------------------------------------------------------------------------
// Mutating tool name sets — derived from `ToolCatalog` in `@lucid-fin/application`.
// `canvasSyncMutatingToolNames` drives canvas subtree re-broadcast; it's the
// set of all mutating tools minus those tagged with a `uiEffect.entity.refresh`.
// `entityMutatingToolNames` drives entity list refresh (character/location/
// equipment).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Context builder
// ---------------------------------------------------------------------------

const MAX_CONTEXT_SELECTED_NODES = 10;
const MAX_CONTEXT_SELECTED_NODE_SUMMARIES = 4;
const MAX_CONTEXT_PROMPT_GUIDES = 8;

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function summarizeCharacterRefIds(refs: unknown): string[] | undefined {
  if (!Array.isArray(refs) || refs.length === 0) return undefined;
  const result = refs.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const ref = entry as Record<string, unknown>;
    const characterId = normalizeOptionalString(ref.characterId);
    if (!characterId) return [];
    return [characterId];
  });
  return result.length > 0 ? result : undefined;
}

function summarizeLocationRefIds(refs: unknown): string[] | undefined {
  if (!Array.isArray(refs) || refs.length === 0) return undefined;
  const result = refs.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const ref = entry as Record<string, unknown>;
    const locationId = normalizeOptionalString(ref.locationId);
    if (!locationId) return [];
    return [locationId];
  });
  return result.length > 0 ? result : undefined;
}

function summarizeEquipmentRefIds(refs: unknown): string[] | undefined {
  if (!Array.isArray(refs) || refs.length === 0) return undefined;
  const result = refs.flatMap((entry) => {
    if (typeof entry === 'string') {
      return [entry];
    }
    if (!entry || typeof entry !== 'object') return [];
    const ref = entry as Record<string, unknown>;
    const equipmentId = normalizeOptionalString(ref.equipmentId);
    if (!equipmentId) return [];
    return [equipmentId];
  });
  return result.length > 0 ? result : undefined;
}

function summarizeSelectedNode(node: CanvasNode, _db: SqliteIndex): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    id: node.id,
    type: node.type,
    title: node.title,
    status: node.status,
  };

  return matchNode(node.type, {
    text: () => {
      const content = normalizeOptionalString((node.data as { content?: unknown }).content);
      if (content) summary.content = content;
      return summary;
    },
    image: addMediaFields,
    video: () => {
      addMediaFields();
      const videoData = node.data as VideoNodeData;
      if (typeof videoData.duration === 'number') summary.duration = videoData.duration;
      if (typeof videoData.fps === 'number') summary.fps = videoData.fps;
      const firstFrameNodeId = normalizeOptionalString(videoData.firstFrameNodeId);
      const lastFrameNodeId = normalizeOptionalString(videoData.lastFrameNodeId);
      if (firstFrameNodeId) summary.firstFrameNodeId = firstFrameNodeId;
      if (lastFrameNodeId) summary.lastFrameNodeId = lastFrameNodeId;
      return summary;
    },
    audio: addMediaFields,
    backdrop: addMediaFields,
  });

  function addMediaFields(): Record<string, unknown> {
    const mediaData = node.data as ImageNodeData | VideoNodeData;
    const prompt = normalizeOptionalString((mediaData as { prompt?: unknown }).prompt);
    const negativePrompt = normalizeOptionalString((mediaData as { negativePrompt?: unknown }).negativePrompt);
    const providerId = normalizeOptionalString((mediaData as { providerId?: unknown }).providerId);
    const sourceImageHash = normalizeOptionalString((mediaData as { sourceImageHash?: unknown }).sourceImageHash);

    if (prompt) summary.hasPrompt = true;
    if (negativePrompt) summary.hasNegativePrompt = true;
    if (providerId) summary.providerId = providerId;
    if (sourceImageHash) summary.sourceImageHash = sourceImageHash;

    const characterRefIds = summarizeCharacterRefIds((mediaData as { characterRefs?: unknown }).characterRefs);
    const locationRefIds = summarizeLocationRefIds((mediaData as { locationRefs?: unknown }).locationRefs);
    const equipmentRefIds = summarizeEquipmentRefIds((mediaData as { equipmentRefs?: unknown }).equipmentRefs);
    if (characterRefIds) summary.characterRefIds = characterRefIds;
    if (locationRefIds) summary.locationRefIds = locationRefIds;
    if (equipmentRefIds) summary.equipmentRefIds = equipmentRefIds;

    return summary;
  }
}

function detectInitialProcessPrompts(
  canvas: Canvas,
  selectedNodeIds: string[],
  userMessage?: string,
): string[] {
  const prompts = new Set<string>();
  const selectedNodes = selectedNodeIds
    .map((nodeId) => canvas.nodes.find((node) => node.id === nodeId))
    .filter((node): node is CanvasNode => Boolean(node));

  for (const node of selectedNodes) {
    matchNode(node.type, {
      image:    () => { prompts.add('image-node-generation'); },
      backdrop: () => { prompts.add('image-node-generation'); },
      video:    () => { prompts.add('video-node-generation'); },
      audio:    () => {},
      text:     () => {},
    });
  }

  const normalizedMessage = userMessage?.toLowerCase() ?? '';
  const requestsRefImage = /\b(ref(?:erence)?(?:\s+image|\s+sheet)?|model\s+sheet|turnaround|expression\s+sheet)\b/.test(
    normalizedMessage,
  ) || /front\s+side\s+back/.test(normalizedMessage);
  const requestsCharacterRef = /\b(character|person|face|expression)\b/.test(normalizedMessage);
  const requestsLocationRef = /\b(location|environment|set|background|establishing|key\s+angle)\b/.test(
    normalizedMessage,
  );
  const requestsEquipmentRef = /\b(equipment|prop|object|weapon|tool)\b/.test(normalizedMessage);

  if (requestsRefImage) {
    if (requestsLocationRef) {
      prompts.add('location-ref-image-generation');
    }
    if (requestsEquipmentRef) {
      prompts.add('equipment-ref-image-generation');
    }
    if (requestsCharacterRef || (!requestsLocationRef && !requestsEquipmentRef)) {
      prompts.add('character-ref-image-generation');
    }
  }

  return Array.from(prompts);
}

export function buildContext(
  canvas: Canvas,
  _presetLibrary: PresetDefinition[],
  selectedNodeIds: string[],
  db: SqliteIndex,
  promptGuides?: Array<{ id: string; name: string; content: string }>,
  userMessage?: string,
): AgentContext {
  const limitedSelectedNodeIds = selectedNodeIds.slice(0, MAX_CONTEXT_SELECTED_NODES);
  const extra: Record<string, unknown> = {
    canvasId: canvas.id,
    nodeCount: canvas.nodes.length,
    edgeCount: canvas.edges.length,
    selectedNodeIds: limitedSelectedNodeIds,
    selectedNodes: limitedSelectedNodeIds
      .slice(0, MAX_CONTEXT_SELECTED_NODE_SUMMARIES)
      .map((nodeId) => canvas.nodes.find((node) => node.id === nodeId))
      .filter((node): node is CanvasNode => Boolean(node))
      .map((node) => summarizeSelectedNode(node, db)),
  };
  const initialProcessPrompts = detectInitialProcessPrompts(canvas, limitedSelectedNodeIds, userMessage);
  if (initialProcessPrompts.length > 0) {
    extra.initialProcessPrompts = initialProcessPrompts;
  }
  if (Array.isArray(promptGuides) && promptGuides.length > 0) {
    extra.availablePromptGuides = promptGuides
      .slice(0, MAX_CONTEXT_PROMPT_GUIDES)
      .map(({ id, name }) => ({ id, name }));
  }
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
    resolveProcessPrompt: (processKey: string) => string | null;
  },
): void {
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
        promptGuides?: Array<{ id: string; name: string; content: string }>;
        customLLMProvider?: LLMProviderRuntimeConfig;
        permissionMode?: 'auto' | 'normal' | 'strict';
        locale?: string;
        maxSteps?: number;
        temperature?: number;
        maxTokens?: number;
        defaultProviders?: Record<string, string>;
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
      if (runningSessions.has(args.canvasId)) {
        throw new Error('Commander already has an active session for this canvas');
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
        registerAllTools(
          registry,
          toolDeps,
          getWindow,
          args.promptGuides ?? [],
          compactRef,
          args.sessionId ?? args.canvasId,
          args.defaultProviders as Record<string, string> | undefined,
        );
        setLastToolRegistry(registry);

        // Create orchestrator
        const adapterProfile: ProviderProfile = llmAdapter.profile ?? DEFAULT_PROVIDER_PROFILE;
        const orchestrator = new AgentOrchestrator(llmAdapter, registry, deps.resolvePrompt, {
          maxSteps: typeof args.maxSteps === 'number' ? args.maxSteps : undefined,
          temperature: typeof args.temperature === 'number' ? args.temperature : undefined,
          maxTokens: typeof args.maxTokens === 'number' ? args.maxTokens : undefined,
          profile: adapterProfile,
          resolveProcessPrompt: deps.resolveProcessPrompt,
        });
        compactRef.compact = (instructions?: string) => orchestrator.compactNow(instructions);
        session = { aborted: false, canvasId: args.canvasId, orchestrator, lastActivity: Date.now() };
        runningSessions.set(args.canvasId, session);

        const context = buildContext(
          canvas,
          deps.presetLibrary,
          args.selectedNodeIds,
          deps.db,
          args.promptGuides,
          args.message,
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
        );

        await orchestrator.execute(args.message, context, emit, {
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
            emitToWindow(getWindow, 'commander:stream', {
              type: 'context_usage',
              estimatedTokensUsed: diagnostics.estimatedTokensUsed,
              contextWindowTokens: diagnostics.contextWindowTokens,
              messageCount: diagnostics.messageCount,
              systemPromptChars: diagnostics.systemPromptChars,
              toolSchemaChars: diagnostics.toolSchemaChars,
              messageChars: diagnostics.messageChars,
              cacheChars: diagnostics.cacheChars,
              cacheEntryCount: diagnostics.cacheEntryCount,
              historyMessagesTrimmed: diagnostics.historyMessagesTrimmed,
              utilizationRatio: diagnostics.utilizationRatio,
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
