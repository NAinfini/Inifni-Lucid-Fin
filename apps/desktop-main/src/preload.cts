import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  Canvas,
  TimelineEvent,
  WireEnvelope,
  LLMProviderRuntimeInput,
  LLMProviderRuntimeConfig,
  PresetCategory,
  PresetDefinition,
  PresetLibraryExportPayload,
  PresetLibraryExportRequest,
  PresetLibraryImportPayload,
  PresetResetRequest,
  EquipmentLoadout,
  IpcChannel,
  IpcRequest,
  IpcResponse,
} from '@lucid-fin/contracts';

type Callback = (...args: unknown[]) => void;

/* ---------- IPC timeout ---------- */

const DEFAULT_TIMEOUT_MS = 30_000;

/** Channels that need longer timeouts (generation, AI, export, etc.) */
const LONG_TIMEOUT_CHANNELS = new Set([
  'ai:chat',
  'canvas:generate',
  'video:clone',
  'lipsync:process',
  'render:start',
  'export:nle',
  'export:assetBundle',
  'export:storyboard',
  'export:metadata',
  'export:capcut',
  'asset:reindexEmbeddings',
  'entity:generateReferenceImage',
  'vision:describeImage',
  'colorStyle:extract',
]);
const LONG_TIMEOUT_MS = 300_000; // 5 minutes

/** Channels where the handler streams events separately and can run indefinitely. */
const NO_TIMEOUT_CHANNELS = new Set(['commander:chat']);

/* ---------- IPC rate limiting ---------- */

const RATE_LIMITED_CHANNELS: Record<string, { maxPerSecond: number }> = {
  'canvas:generate': { maxPerSecond: 2 },
  'entity:generateReferenceImage': { maxPerSecond: 2 },
};

const rateLimitState = new Map<string, number[]>();

function checkRateLimit(channel: string): void {
  const config = RATE_LIMITED_CHANNELS[channel];
  if (!config) return;

  const now = Date.now();
  const window = 1000; // 1-second sliding window
  let timestamps = rateLimitState.get(channel) ?? [];
  timestamps = timestamps.filter((t) => now - t < window);

  if (timestamps.length >= config.maxPerSecond) {
    throw new Error(`IPC rate limited: ${channel} exceeds ${config.maxPerSecond} calls/sec`);
  }

  timestamps.push(now);
  rateLimitState.set(channel, timestamps);
}

/* ---------- invoke with timeout + rate limiting ---------- */

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  checkRateLimit(channel);

  if (NO_TIMEOUT_CHANNELS.has(channel)) {
    return ipcRenderer.invoke(channel, ...args) as Promise<T>;
  }

  const timeoutMs = LONG_TIMEOUT_CHANNELS.has(channel) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`IPC timeout: ${channel} did not respond within ${timeoutMs}ms`));
    }, timeoutMs);

    ipcRenderer
      .invoke(channel, ...args)
      .then((result) => {
        clearTimeout(timer);
        resolve(result as T);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function typedInvoke<C extends IpcChannel>(
  channel: C,
  request: IpcRequest<C>,
): Promise<IpcResponse<C>> {
  checkRateLimit(channel);

  const timeoutMs = LONG_TIMEOUT_CHANNELS.has(channel) ? LONG_TIMEOUT_MS : DEFAULT_TIMEOUT_MS;

  return new Promise<IpcResponse<C>>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`IPC timeout: ${channel} did not respond within ${timeoutMs}ms`));
    }, timeoutMs);

    (ipcRenderer.invoke(channel, request) as Promise<IpcResponse<C>>)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function subscribe(channel: string, cb: Callback): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

let appReady = false;
ipcRenderer.on('app:ready', () => {
  appReady = true;
});

contextBridge.exposeInMainWorld('lucidAPI', {
  // Shell
  openExternal: (url: string) => invoke('shell:openExternal', { url }),
  settings: {
    load: () => typedInvoke('settings:load', undefined as IpcRequest<'settings:load'>),
    save: (data: Record<string, unknown>) => typedInvoke('settings:save', data),
    onProviderKeyUpdated: (cb: (data: { providerId: string; hasKey: boolean }) => void) =>
      subscribe('settings:providerKeyUpdated', cb as Callback),
  },
  app: {
    version: () => invoke<string>('app:version'),
    restart: () => invoke<void>('app:restart', {}),
  },
  logger: {
    getRecent: () =>
      invoke<
        Array<{
          id: string;
          timestamp: number;
          level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
          category: string;
          message: string;
          detail?: string;
        }>
      >('logger:getRecent'),
    onEntry: (cb: Callback) => subscribe('logger:entry', cb),
  },

  // Script
  script: {
    parse: (content: string, format?: string) => invoke('script:parse', { content, format }),
    save: (data: Record<string, unknown>) => invoke('script:save', data),
    load: () => invoke('script:load'),
    import: (filePath: string) => invoke('script:import', { filePath }),
  },

  // Character
  character: {
    list: () => invoke('character:list'),
    get: (id: string) => invoke('character:get', { id }),
    save: (data: Record<string, unknown>) => invoke('character:save', data),
    delete: (id: string) => invoke('character:delete', { id }),
    setRefImage: (characterId: string, slot: string, assetHash: string, isStandard: boolean) =>
      invoke('character:setRefImage', { characterId, slot, assetHash, isStandard }),
    removeRefImage: (characterId: string, slot: string) =>
      invoke('character:removeRefImage', { characterId, slot }),
    saveLoadout: (characterId: string, loadout: EquipmentLoadout) =>
      invoke('character:saveLoadout', { characterId, loadout }),
    deleteLoadout: (characterId: string, loadoutId: string) =>
      invoke('character:deleteLoadout', { characterId, loadoutId }),
    setFolder: (id: string, folderId: string | null) =>
      invoke<void>('character:setFolder', { id, folderId }),
  },

  // Equipment
  equipment: {
    list: (filter?: { type?: string }) => invoke('equipment:list', filter ?? {}),
    get: (id: string) => invoke('equipment:get', { id }),
    save: (data: Record<string, unknown>) => invoke('equipment:save', data),
    delete: (id: string) => invoke('equipment:delete', { id }),
    setRefImage: (equipmentId: string, slot: string, assetHash: string, isStandard: boolean) =>
      invoke('equipment:setRefImage', { equipmentId, slot, assetHash, isStandard }),
    removeRefImage: (equipmentId: string, slot: string) =>
      invoke('equipment:removeRefImage', { equipmentId, slot }),
    setFolder: (id: string, folderId: string | null) =>
      invoke<void>('equipment:setFolder', { id, folderId }),
  },

  // Location
  location: {
    list: (filter?: { type?: string }) => invoke('location:list', filter ?? {}),
    get: (id: string) => invoke('location:get', { id }),
    save: (data: Record<string, unknown>) => invoke('location:save', data),
    delete: (id: string) => invoke('location:delete', { id }),
    setRefImage: (locationId: string, slot: string, assetHash: string, isStandard: boolean) =>
      invoke('location:setRefImage', { locationId, slot, assetHash, isStandard }),
    removeRefImage: (locationId: string, slot: string) =>
      invoke('location:removeRefImage', { locationId, slot }),
    setFolder: (id: string, folderId: string | null) =>
      invoke<void>('location:setFolder', { id, folderId }),
  },
  entity: {
    generateReferenceImage: (request: {
      entityType: 'character' | 'equipment' | 'location';
      entityId: string;
      description: string;
      provider: string;
      variantCount?: number;
      seed?: number;
    }) => invoke<{ variants: string[] }>('entity:generateReferenceImage', request),
  },

  // Style Guide
  style: {
    save: (data: Record<string, unknown>) => invoke('style:save', data),
    load: () => invoke('style:load'),
  },

  // Color Style Library
  colorStyle: {
    list: () => invoke('colorStyle:list'),
    save: (data: Record<string, unknown>) => invoke('colorStyle:save', data),
    delete: (id: string) => invoke('colorStyle:delete', { id }),
    extract: (assetHash: string, assetType: 'image' | 'video') =>
      invoke('colorStyle:extract', { assetHash, assetType }),
  },

  // Assets
  asset: {
    import: (filePath: string, type: string) => invoke('asset:import', { filePath, type }),
    importBuffer: (buffer: ArrayBuffer, fileName: string, type: string) =>
      invoke('asset:importBuffer', { buffer, fileName, type }),
    pickFile: (type: string) => invoke('asset:pickFile', { type }),
    query: (filter: Record<string, unknown>) => invoke('asset:query', filter),
    getPath: (hash: string, type: string, ext: string) =>
      invoke('asset:getPath', { hash, type, ext }),
    export: (args: { hash: string; type: string; format: string; name?: string }) =>
      invoke('asset:export', args),
    exportBatch: (args: { items: Array<{ hash: string; type: string; name?: string }> }) =>
      invoke('asset:exportBatch', args),
    delete: (hash: string) => invoke('asset:delete', { hash }),
    setFolder: (hash: string, folderId: string | null) =>
      invoke<void>('asset:setFolder', { hash, folderId }),
  },

  // Jobs
  job: {
    submit: (request: Record<string, unknown>) => invoke('job:submit', request),
    list: (filter?: Record<string, unknown>) => invoke('job:list', filter ?? {}),
    cancel: (jobId: string) => invoke('job:cancel', { jobId }),
    pause: (jobId: string) => invoke('job:pause', { jobId }),
    resume: (jobId: string) => invoke('job:resume', { jobId }),
    onProgress: (cb: Callback) => subscribe('job:progress', cb),
    onComplete: (cb: Callback) => subscribe('job:complete', cb),
    onSubmitted: (cb: Callback) => subscribe('job:submitted', cb),
    onFailed: (cb: Callback) => subscribe('job:failed', cb),
    onCancelled: (cb: Callback) => subscribe('job:cancelled', cb),
    onPaused: (cb: Callback) => subscribe('job:paused', cb),
    onResumed: (cb: Callback) => subscribe('job:resumed', cb),
  },

  refimage: {
    onStart: (cb: Callback) => subscribe('refimage:start', cb),
    onComplete: (cb: Callback) => subscribe('refimage:complete', cb),
    onFailed: (cb: Callback) => subscribe('refimage:failed', cb),
  },

  // Workflows
  workflow: {
    list: (filter?: Record<string, unknown>) => invoke('workflow:list', filter ?? {}),
    get: (id: string) => invoke('workflow:get', { id }),
    getStages: (workflowRunId: string) => invoke('workflow:getStages', { workflowRunId }),
    getTasks: (workflowRunId: string) => invoke('workflow:getTasks', { workflowRunId }),
    start: (request: Record<string, unknown>) => invoke('workflow:start', request),
    pause: (id: string) => invoke('workflow:pause', { id }),
    resume: (id: string) => invoke('workflow:resume', { id }),
    cancel: (id: string) => invoke('workflow:cancel', { id }),
    retryTask: (taskRunId: string) => invoke('workflow:retryTask', { taskRunId }),
    retryStage: (stageRunId: string) => invoke('workflow:retryStage', { stageRunId }),
    retryWorkflow: (id: string) => invoke('workflow:retryWorkflow', { id }),
  },

  // Keychain
  keychain: {
    isConfigured: (provider: string) => invoke('keychain:isConfigured', { provider }),
    get: (provider: string) => invoke<string | null>('keychain:get', { provider }),
    set: (provider: string, apiKey: string) => invoke('keychain:set', { provider, apiKey }),
    delete: (provider: string) => invoke('keychain:delete', { provider }),
    test: (
      provider: string,
      providerConfig?: LLMProviderRuntimeInput,
      group?: 'llm' | 'image' | 'video' | 'audio' | 'vision',
    ) =>
      invoke<{ ok: boolean; error?: string }>('keychain:test', {
        provider,
        providerConfig,
        group,
      }),
  },

  // AI Commander
  ai: {
    chat: (message: string, context?: Record<string, unknown>) =>
      invoke('ai:chat', { message, context }),
    onStream: (cb: Callback) => subscribe('ai:stream', cb),
    onEvent: (cb: Callback) => subscribe('ai:event', cb),
    promptList: () => invoke('ai:prompt:list'),
    promptGet: (code: string) => invoke('ai:prompt:get', { code }),
    promptSetCustom: (code: string, value: string) =>
      invoke('ai:prompt:setCustom', { code, value }),
    promptClearCustom: (code: string) => invoke('ai:prompt:clearCustom', { code }),
  },
  processPrompt: {
    list: () => typedInvoke('processPrompt:list', undefined as IpcRequest<'processPrompt:list'>),
    get: (processKey: string) => typedInvoke('processPrompt:get', { processKey }),
    setCustom: (processKey: string, value: string) =>
      typedInvoke('processPrompt:setCustom', { processKey, value }),
    reset: (processKey: string) => typedInvoke('processPrompt:reset', { processKey }),
  },

  // Folders (per-kind CRUD for character/equipment/location/asset)
  folder: {
    character: {
      list: () => invoke('folder.character:list'),
      create: (parentId: string | null, name: string) =>
        invoke('folder.character:create', { parentId, name }),
      rename: (id: string, name: string) => invoke('folder.character:rename', { id, name }),
      move: (id: string, newParentId: string | null) =>
        invoke('folder.character:move', { id, newParentId }),
      delete: (id: string) => invoke<void>('folder.character:delete', { id }),
    },
    equipment: {
      list: () => invoke('folder.equipment:list'),
      create: (parentId: string | null, name: string) =>
        invoke('folder.equipment:create', { parentId, name }),
      rename: (id: string, name: string) => invoke('folder.equipment:rename', { id, name }),
      move: (id: string, newParentId: string | null) =>
        invoke('folder.equipment:move', { id, newParentId }),
      delete: (id: string) => invoke<void>('folder.equipment:delete', { id }),
    },
    location: {
      list: () => invoke('folder.location:list'),
      create: (parentId: string | null, name: string) =>
        invoke('folder.location:create', { parentId, name }),
      rename: (id: string, name: string) => invoke('folder.location:rename', { id, name }),
      move: (id: string, newParentId: string | null) =>
        invoke('folder.location:move', { id, newParentId }),
      delete: (id: string) => invoke<void>('folder.location:delete', { id }),
    },
    asset: {
      list: () => invoke('folder.asset:list'),
      create: (parentId: string | null, name: string) =>
        invoke('folder.asset:create', { parentId, name }),
      rename: (id: string, name: string) => invoke('folder.asset:rename', { id, name }),
      move: (id: string, newParentId: string | null) =>
        invoke('folder.asset:move', { id, newParentId }),
      delete: (id: string) => invoke<void>('folder.asset:delete', { id }),
    },
  },
  commander: {
    chat: (
      canvasId: string,
      message: string,
      history: Array<Record<string, unknown>>,
      selectedNodeIds: string[],
      promptGuides?: Array<{ id: string; name: string; content: string; autoInject?: boolean }>,
      customLLMProvider?: LLMProviderRuntimeConfig,
      permissionMode?: 'auto' | 'normal' | 'strict',
      locale?: string,
      maxSteps?: number,
      temperature?: number,
      maxTokens?: number,
      sessionId?: string,
      defaultProviders?: Record<string, string>,
    ) =>
      invoke<void>('commander:chat', {
        canvasId,
        message,
        history,
        selectedNodeIds,
        promptGuides,
        customLLMProvider,
        permissionMode,
        locale,
        maxSteps,
        temperature,
        maxTokens,
        sessionId,
        defaultProviders,
      }),
    cancel: (canvasId: string) => invoke('commander:cancel', { canvasId }),
    cancelCurrentStep: (canvasId: string) =>
      invoke<{ escalated: boolean }>('commander:cancel-step', { canvasId }),
    compact: (canvasId: string) =>
      invoke<{ freedChars: number; messageCount: number; toolCount: number }>('commander:compact', {
        canvasId,
      }),
    injectMessage: (canvasId: string, message: string) =>
      invoke('commander:inject-message', { canvasId, message }),
    confirmTool: (canvasId: string, toolCallId: string, approved: boolean) =>
      invoke('commander:tool:decision', { canvasId, toolCallId, approved }),
    answerQuestion: (canvasId: string, toolCallId: string, answer: string) =>
      invoke('commander:tool:answer', { canvasId, toolCallId, answer }),
    toolList: () =>
      invoke<
        Array<{
          name: string;
          description: string;
          tags?: string[];
          tier: number;
        }>
      >('commander:tool-list'),
    toolSearch: (query?: string) =>
      invoke<
        Array<{
          name: string;
          description: string;
        }>
      >('commander:tool-search', { query }),
    hydrateEvents: (sessionId: string) =>
      invoke<{ events: unknown[] }>('commander:events:hydrate', { sessionId }),
    onStream: (cb: (envelope: WireEnvelope<TimelineEvent>) => void) => {
      // Main emits v2 envelopes directly — no wrapping needed at the bridge.
      const wrapped: Callback = (...args: unknown[]) => {
        cb(args[0] as WireEnvelope<TimelineEvent>);
      };
      return subscribe('commander:stream', wrapped);
    },
    onCanvasUpdated: (cb: (data: { canvasId: string; canvas: Canvas }) => void) =>
      subscribe('commander:canvas:dispatch', cb as Callback),
    onEntitiesUpdated: (cb: (data: { toolName: string }) => void) =>
      subscribe('commander:entities:updated', cb as Callback),
    onSettingsDispatch: (
      cb: (data: { action: string; payload: Record<string, unknown> }) => void,
    ) => subscribe('commander:settings:dispatch', cb as Callback),
    onUndoDispatch: (cb: (data: { action: 'undo' | 'redo' }) => void) =>
      subscribe('commander:undo:dispatch', cb as Callback),
  },

  // Session history
  session: {
    upsert: (s: {
      id: string;
      canvasId: string | null;
      title: string;
      messages: string;
      createdAt: number;
      updatedAt: number;
    }) => invoke<void>('session:upsert', s),
    list: (limit?: number) =>
      invoke<
        Array<{
          id: string;
          canvasId: string | null;
          title: string;
          createdAt: number;
          updatedAt: number;
        }>
      >('session:list', { limit }),
    get: (id: string) =>
      invoke<{
        id: string;
        canvasId: string | null;
        title: string;
        messages: string;
        createdAt: number;
        updatedAt: number;
      }>('session:get', { id }),
    delete: (id: string) => invoke<{ success: true }>('session:delete', { id }),
  },

  // Snapshots
  snapshot: {
    capture: (sessionId: string, label: string, trigger?: 'auto' | 'manual') =>
      invoke<{ id: string; sessionId: string; label: string; trigger: string; createdAt: number }>(
        'snapshot:capture',
        { sessionId, label, trigger: trigger ?? 'auto' },
      ),
    list: (sessionId: string) =>
      invoke<
        Array<{ id: string; sessionId: string; label: string; trigger: string; createdAt: number }>
      >('snapshot:list', { sessionId }),
    restore: (snapshotId: string) => invoke<{ success: true }>('snapshot:restore', { snapshotId }),
    delete: (snapshotId: string) => invoke<{ success: true }>('snapshot:delete', { snapshotId }),
  },

  // Clipboard watcher
  clipboard: {
    onAIDetected: (cb: (data: { text: string }) => void) =>
      subscribe('clipboard:ai-detected', cb as Callback),
    setEnabled: (enabled: boolean) => invoke('clipboard:setEnabled', { enabled }),
  },

  // App events
  onReady: (cb: Callback) => {
    if (appReady) {
      cb();
      return () => {};
    }
    return subscribe('app:ready', cb);
  },
  onInitError: (cb: Callback) => subscribe('app:init-error', cb),

  // Auto-updater
  updater: {
    check: () => invoke('updater:check'),
    download: () => invoke('updater:download'),
    install: () => invoke('updater:install'),
    status: () => invoke('updater:status'),
    onProgress: (cb: Callback) => subscribe('updater:progress', cb),
    onToast: (cb: Callback) => subscribe('updater:toast', cb),
  },

  // Render
  render: {
    start: (request: Record<string, unknown>) => invoke('render:start', request),
    status: (jobId: string) => invoke('render:status', { jobId }),
    cancel: (jobId: string) => invoke('render:cancel', { jobId }),
  },

  // Export
  export: {
    nle: (preset: Record<string, unknown>) => invoke('export:nle', preset),
    assetBundle: (assetHashes: string[], outputPath?: string) =>
      invoke('export:assetBundle', { assetHashes, outputPath }),
    subtitles: (format: string, outputPath: string) =>
      invoke('export:subtitles', { format, outputPath }),
    storyboard: (
      nodes: Array<Record<string, unknown>>,
      projectTitle?: string,
      outputPath?: string,
    ) => invoke('export:storyboard', { nodes, projectTitle, outputPath }),
    metadata: (
      format: 'csv' | 'json',
      nodes: Array<Record<string, unknown>>,
      projectTitle?: string,
      outputPath?: string,
    ) => invoke('export:metadata', { format, nodes, projectTitle, outputPath }),
    importSrt: (canvasId: string, filePath: string, alignToNodes?: boolean) =>
      invoke('import:srt', { canvasId, filePath, alignToNodes }),
    capcut: (nodes: Array<Record<string, unknown>>, projectTitle?: string, outputDir?: string) =>
      invoke<{ draftDir: string }>('export:capcut', { nodes, projectTitle, outputDir }),
  },

  // FFmpeg
  ffmpeg: {
    probe: (filePath: string) => invoke('ffmpeg:probe', { filePath }),
    thumbnail: (filePath: string, timestamp: number) =>
      invoke('ffmpeg:thumbnail', { filePath, timestamp }),
    transcode: (input: string, output: string, options?: Record<string, unknown>) =>
      invoke('ffmpeg:transcode', { input, output, options }),
  },

  // Series
  series: {
    get: () => invoke('series:get'),
    save: (data: Record<string, unknown>) => invoke('series:save', data),
    delete: () => invoke('series:delete'),
    episodes: {
      list: () => invoke('series:episodes:list'),
      add: (episode: Record<string, unknown>) => invoke('series:episodes:add', episode),
      remove: (id: string) => invoke('series:episodes:remove', { id }),
      reorder: (ids: string[]) => invoke('series:episodes:reorder', { ids }),
    },
  },

  // Canvas
  canvas: {
    list: () => invoke('canvas:list'),
    load: (id: string) => typedInvoke('canvas:load', { id }),
    save: (data: Canvas) => typedInvoke('canvas:save', data),
    patch: (args: IpcRequest<'canvas:patch'>) => typedInvoke('canvas:patch', args),
    create: (name: string) => typedInvoke('canvas:create', { name }),
    delete: (id: string) => invoke('canvas:delete', { id }),
    rename: (id: string, name: string) => invoke('canvas:rename', { id, name }),
  },
  canvasGeneration: {
    generate: (
      canvasId: string,
      nodeId: string,
      providerId?: string,
      variantCount?: number,
      seed?: number,
      providerConfig?: { baseUrl: string; model: string; apiKey?: string },
    ) =>
      invoke('canvas:generate', {
        canvasId,
        nodeId,
        providerId,
        providerConfig,
        variantCount,
        seed,
      }),
    cancel: (canvasId: string, nodeId: string) =>
      invoke('canvas:cancelGeneration', { canvasId, nodeId }),
    estimateCost: (
      canvasId: string,
      nodeId: string,
      providerId: string,
      providerConfig?: { baseUrl: string; model: string; apiKey?: string },
    ) => invoke('canvas:estimateCost', { canvasId, nodeId, providerId, providerConfig }),
    extractLastFrame: (canvasId: string, nodeId: string) =>
      invoke('video:extractLastFrame', { canvasId, nodeId }),
    onProgress: (
      cb: (data: {
        canvasId: string;
        nodeId: string;
        progress: number;
        currentStep?: string;
      }) => void,
    ) => {
      const handler = (
        _event: IpcRendererEvent,
        data: {
          canvasId: string;
          nodeId: string;
          progress: number;
          currentStep?: string;
        },
      ) => cb(data);
      ipcRenderer.on('canvas:generation:progress', handler);
      return () => ipcRenderer.removeListener('canvas:generation:progress', handler);
    },
    onComplete: (
      cb: (data: {
        canvasId: string;
        nodeId: string;
        variants: string[];
        primaryAssetHash: string;
        cost?: number;
        generationTimeMs: number;
        characterRefs?: Array<{ entityId: string; imageHashes: string[] }>;
        equipmentRefs?: Array<{ entityId: string; imageHashes: string[] }>;
        locationRefs?: Array<{ entityId: string; imageHashes: string[] }>;
        frameReferenceHashes?: { first?: string; last?: string };
        sourceImageHash?: string;
        model?: string;
      }) => void,
    ) => {
      const handler = (
        _event: IpcRendererEvent,
        data: {
          canvasId: string;
          nodeId: string;
          variants: string[];
          primaryAssetHash: string;
          cost?: number;
          generationTimeMs: number;
          characterRefs?: Array<{ entityId: string; imageHashes: string[] }>;
          equipmentRefs?: Array<{ entityId: string; imageHashes: string[] }>;
          locationRefs?: Array<{ entityId: string; imageHashes: string[] }>;
          frameReferenceHashes?: { first?: string; last?: string };
          sourceImageHash?: string;
          model?: string;
        },
      ) => cb(data);
      ipcRenderer.on('canvas:generation:complete', handler);
      return () => ipcRenderer.removeListener('canvas:generation:complete', handler);
    },
    onFailed: (cb: (data: { canvasId: string; nodeId: string; error: string }) => void) => {
      const handler = (
        _event: IpcRendererEvent,
        data: {
          canvasId: string;
          nodeId: string;
          error: string;
        },
      ) => cb(data);
      ipcRenderer.on('canvas:generation:failed', handler);
      return () => ipcRenderer.removeListener('canvas:generation:failed', handler);
    },
  },

  // Presets
  preset: {
    list: (filter?: { includeBuiltIn?: boolean; category?: PresetCategory }) =>
      invoke<PresetDefinition[]>('preset:list', filter ?? {}),
    save: (data: PresetDefinition) => invoke<PresetDefinition>('preset:save', data),
    delete: (id: string) => invoke('preset:delete', { id }),
    reset: (request: PresetResetRequest) => invoke<PresetDefinition>('preset:reset', request),
    import: (payload: PresetLibraryImportPayload) =>
      invoke<PresetLibraryExportPayload>('preset:import', payload),
    export: (options?: PresetLibraryExportRequest) =>
      invoke<PresetLibraryExportPayload>('preset:export', options ?? {}),
  },

  // Vision
  vision: {
    describeImage: (assetHash: string, assetType: 'image' | 'video', style?: string) =>
      invoke<{ prompt: string }>('vision:describeImage', { assetHash, assetType, style }),
  },

  // Embedding (Semantic Search)
  embedding: {
    generate: (assetHash: string) => invoke('asset:generateEmbedding', { assetHash }),
    search: (query: string, limit?: number) =>
      invoke<{ hash: string; score: number; description: string }[]>('asset:searchSemantic', {
        query,
        limit,
      }),
    reindex: () => invoke('asset:reindexEmbeddings'),
  },

  // Video Clone (F1)
  video: {
    pickFile: () => invoke<string | null>('video:pickFile'),
    clone: (filePath: string, threshold?: number) =>
      invoke<{ canvasId: string; nodeCount: number }>('video:clone', { filePath, threshold }),
    onCloneProgress: (
      cb: (data: { step: string; current: number; total: number; message: string }) => void,
    ) => {
      const handler = (
        _event: IpcRendererEvent,
        data: { step: string; current: number; total: number; message: string },
      ) => cb(data);
      ipcRenderer.on('video:clone:progress', handler);
      return () => ipcRenderer.removeListener('video:clone:progress', handler);
    },
  },

  // Lip Sync (F2)
  lipsync: {
    process: (canvasId: string, nodeId: string) => invoke('lipsync:process', { canvasId, nodeId }),
    checkAvailability: () =>
      invoke<{ available: boolean; backend: string }>('lipsync:checkAvailability'),
  },

  // Storage Management
  storage: {
    getOverview: () =>
      invoke<{
        appRoot: string;
        dbSize: number;
        globalAssetsSize: number;
        globalAssetCount: number;
        logsSize: number;
        totalSize: number;
        paths: { appRoot: string; database: string; globalAssets: string; logs: string };
      }>('storage:getOverview'),
    openFolder: (folderPath: string) => invoke('storage:openFolder', { path: folderPath }),
    showInFolder: (filePath: string) => invoke('storage:showInFolder', { path: filePath }),
    clearLogs: () => invoke<{ cleared: number }>('storage:clearLogs'),
    clearEmbeddings: () => invoke<{ success: boolean; error?: string }>('storage:clearEmbeddings'),
    vacuumDatabase: () => invoke<{ success: boolean; error?: string }>('storage:vacuumDatabase'),
    backupDatabase: (destPath: string) =>
      invoke<{ success: boolean; error?: string }>('storage:backupDatabase', { destPath }),
    restoreDatabase: (sourcePath: string) =>
      invoke<{ success: boolean; error?: string; backupCreated?: string }>(
        'storage:restoreDatabase',
        { sourcePath },
      ),
    pickFolder: () => {
      return new Promise<string | null>((resolve) => {
        ipcRenderer
          .invoke('storage:pickFolder')
          .then(resolve)
          .catch(() => resolve(null));
      });
    },
    pickSaveFile: (defaultName: string) => {
      return new Promise<string | null>((resolve) => {
        ipcRenderer
          .invoke('storage:pickSaveFile', { defaultName })
          .then(resolve)
          .catch(() => resolve(null));
      });
    },
    pickOpenFile: (extensions: string[]) => {
      return new Promise<string | null>((resolve) => {
        ipcRenderer
          .invoke('storage:pickOpenFile', { extensions })
          .then(resolve)
          .catch(() => resolve(null));
      });
    },
  },

  // IPC health check
  ipc: {
    ping: () => invoke<'pong'>('ipc:ping'),
  },
});
