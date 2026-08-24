import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  Canvas,
  CanvasDeliveryUpdateRequest,
  CanvasDeliveryUpdateResponse,
  CommanderToolAnswerResponse,
  CommanderToolDecisionResponse,
  CommanderStartRequest,
  CommanderStartResponse,
  CommanderRunGetResponse,
  CommanderRunControlRequest,
  CommanderRunControlResponse,
  CommanderRunTreeRequest,
  CommanderRunTreeResponse,
  CommanderEventsHydrateResponse,
  CommanderStreamPayload,
  LLMProviderRuntimeInput,
  PresetCategory,
  PresetDefinition,
  PresetLibraryExportPayload,
  PresetLibraryExportRequest,
  PresetLibraryImportPayload,
  PresetResetRequest,
  OAuthProviderStatus,
  OAuthProviderTarget,
  EquipmentLoadout,
  IpcChannel,
  IpcRequest,
  IpcResponse,
} from '@lucid-fin/contracts';

type Callback = (...args: unknown[]) => void;

/* ---------- IPC timeout ---------- */

const DEFAULT_TIMEOUT_MS = 30_000;

/** Channels that need longer timeouts (generation, AI, packaging, etc.) */
const LONG_TIMEOUT_CHANNELS = new Set([
  'deliveryPackage:start',
  'vision:describeImage',
  'colorStyle:extract',
]);
const LONG_TIMEOUT_MS = 300_000; // 5 minutes

/* ---------- invoke with timeout ---------- */

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
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
let appInitError: string | null = null;
ipcRenderer.on('app:ready', () => {
  appReady = true;
});
ipcRenderer.on('app:init-error', (_event, error: unknown) => {
  appInitError = typeof error === 'string' ? error : String(error);
});

contextBridge.exposeInMainWorld('lucidAPI', {
  // Shell
  openExternal: (url: string) => invoke('shell:openExternal', { url }),
  settings: {
    load: () => typedInvoke('settings:load', undefined as IpcRequest<'settings:load'>),
    save: (data: Record<string, unknown>) => typedInvoke('settings:save', data),
    onProviderKeyUpdated: (cb: (data: { providerId: string; hasKey: boolean }) => void) =>
      subscribe('settings:providerKeyUpdated', cb as Callback),
    setAnalyticsEnabled: (enabled: boolean) =>
      invoke<void>('settings:set-analytics-enabled', { enabled }),
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
    copy: (ids: string[], targetFolderId: string | null) =>
      invoke('character:copy', { ids, targetFolderId }),
    delete: (ids: string[]) => invoke('character:delete', { ids }),
    setRefImage: (characterId: string, slot: string, assetHash: string, isStandard: boolean) =>
      invoke('character:setRefImage', { characterId, slot, assetHash, isStandard }),
    removeRefImage: (characterId: string, slot: string) =>
      invoke('character:removeRefImage', { characterId, slot }),
    saveLoadout: (characterId: string, loadout: EquipmentLoadout) =>
      invoke('character:saveLoadout', { characterId, loadout }),
    deleteLoadout: (characterId: string, loadoutId: string) =>
      invoke('character:deleteLoadout', { characterId, loadoutId }),
    setFolder: (ids: string[], folderId: string | null) =>
      invoke('character:setFolder', { ids, folderId }),
  },

  // Equipment
  equipment: {
    list: (filter?: { type?: string }) => invoke('equipment:list', filter ?? {}),
    get: (id: string) => invoke('equipment:get', { id }),
    save: (data: Record<string, unknown>) => invoke('equipment:save', data),
    copy: (ids: string[], targetFolderId: string | null) =>
      invoke('equipment:copy', { ids, targetFolderId }),
    delete: (ids: string[]) => invoke('equipment:delete', { ids }),
    setRefImage: (equipmentId: string, slot: string, assetHash: string, isStandard: boolean) =>
      invoke('equipment:setRefImage', { equipmentId, slot, assetHash, isStandard }),
    removeRefImage: (equipmentId: string, slot: string) =>
      invoke('equipment:removeRefImage', { equipmentId, slot }),
    setFolder: (ids: string[], folderId: string | null) =>
      invoke('equipment:setFolder', { ids, folderId }),
  },

  // Location
  location: {
    list: (filter?: { type?: string }) => invoke('location:list', filter ?? {}),
    get: (id: string) => invoke('location:get', { id }),
    save: (data: Record<string, unknown>) => invoke('location:save', data),
    copy: (ids: string[], targetFolderId: string | null) =>
      invoke('location:copy', { ids, targetFolderId }),
    delete: (ids: string[]) => invoke('location:delete', { ids }),
    setRefImage: (locationId: string, slot: string, assetHash: string, isStandard: boolean) =>
      invoke('location:setRefImage', { locationId, slot, assetHash, isStandard }),
    removeRefImage: (locationId: string, slot: string) =>
      invoke('location:removeRefImage', { locationId, slot }),
    setFolder: (ids: string[], folderId: string | null) =>
      invoke('location:setFolder', { ids, folderId }),
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

  // Logical Asset library entries
  assetEntry: {
    import: (filePath: string, type: string) => invoke('assetEntry:import', { filePath, type }),
    importBuffer: (buffer: ArrayBuffer, fileName: string, type: string) =>
      invoke('assetEntry:importBuffer', { buffer, fileName, type }),
    pickFile: (type: string) => invoke('assetEntry:pickFile', { type }),
    query: (filter: Record<string, unknown>) => invoke('assetEntry:query', filter),
    copy: (entryIds: string[], targetFolderId: string | null) =>
      invoke('assetEntry:copy', { entryIds, targetFolderId }),
    move: (entryIds: string[], folderId: string | null) =>
      invoke('assetEntry:move', { entryIds, folderId }),
    rename: (entryId: string, displayName: string) =>
      invoke('assetEntry:rename', { entryId, displayName }),
    delete: (entryIds: string[]) => invoke('assetEntry:delete', { entryIds }),
  },

  // Hash-addressed CAS content operations
  assetContent: {
    getPath: (hash: string, type: string, ext: string) =>
      invoke('assetContent:getPath', { hash, type, ext }),
    inspect: (hash: string) => invoke('assetContent:inspect', { hash }),
    export: (args: { hash: string; type: string; format: string; name?: string }) =>
      invoke('assetContent:export', args),
  },

  // Jobs
  // Persistent Task Lists. Execution mutations are Commander tools.
  taskLists: {
    list: (filter?: Record<string, unknown>) => invoke('taskList:list', filter ?? {}),
    get: (id: string) => invoke('taskList:get', { id }),
    getTasks: (taskListId: string) => invoke('taskList:getTasks', { taskListId }),
    startMedia: (request: Record<string, unknown>) => invoke('taskList:startMedia', request),
    cancelMedia: (request: { canvasId: string; nodeId: string }) =>
      invoke('taskList:cancelMedia', request),
    retryMediaEvaluation: (taskListId: string) =>
      invoke('taskList:retryMediaEvaluation', { taskListId }),
    retryMedia: (request: { canvasId: string; nodeId: string; providerId?: string }) =>
      invoke('taskList:retryMedia', request),
    getPendingApproval: (taskListId: string) =>
      invoke('taskList:getPendingApproval', { taskListId }),
    getVisualAuditions: (taskListId: string) =>
      invoke('taskList:getVisualAuditions', { taskListId }),
    getDelivery: (taskListId: string) => invoke('taskList:getDelivery', { taskListId }),
    selectVisualCandidate: (request: Record<string, unknown>) =>
      invoke('taskList:selectVisualCandidate', request),
    requestVisualAuditionChanges: (request: Record<string, unknown>) =>
      invoke('taskList:requestVisualAuditionChanges', request),
    approveGate: (request: Record<string, unknown>) => invoke('taskList:approveGate', request),
    requestChanges: (request: Record<string, unknown>) =>
      invoke('taskList:requestChanges', request),
    rejectGate: (request: Record<string, unknown>) => invoke('taskList:rejectGate', request),
    listPendingDecisions: (request: Record<string, unknown>) =>
      invoke('taskList:listPendingDecisions', request),
  },

  promptAssembly: {
    get: (id: string) => invoke('promptAssembly:get', { id }),
  },

  // Keychain
  keychain: {
    isConfigured: (provider: string) => invoke('keychain:isConfigured', { provider }),
    getMasked: (provider: string) => invoke<string | null>('keychain:getMasked', { provider }),
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

  // Capability-scoped OAuth. Tokens and authorization URLs never cross IPC.
  providerOAuth: {
    status: (request: { target: OAuthProviderTarget }) =>
      invoke<OAuthProviderStatus>('providerOAuth:status', request),
    login: (request: { target: OAuthProviderTarget }) =>
      invoke<OAuthProviderStatus>('providerOAuth:login', request),
    cancelLogin: (request: { target: OAuthProviderTarget }) =>
      invoke<OAuthProviderStatus>('providerOAuth:cancelLogin', request),
    logout: (request: { target: OAuthProviderTarget }) =>
      invoke<OAuthProviderStatus>('providerOAuth:logout', request),
    onChanged: (cb: (status: OAuthProviderStatus) => void) =>
      subscribe('providerOAuth:changed', cb as Callback),
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
    start: (request: CommanderStartRequest) =>
      invoke<CommanderStartResponse>('commander:start', request),
    cancel: (request: { runId: string }) => invoke<void>('commander:cancel', request),
    cancelStep: (request: { runId: string }) =>
      invoke<{ escalated: boolean }>('commander:cancel-step', request),
    compact: (request: { runId: string }) =>
      invoke<{ freedChars: number; messageCount: number; toolCount: number }>(
        'commander:compact',
        request,
      ),
    injectMessage: (request: { runId: string; message: string }) =>
      invoke<void>('commander:inject-message', request),
    toolDecision: (request: {
      runId: string;
      sessionId: string;
      toolCallId: string;
      approved: boolean;
    }) => invoke<CommanderToolDecisionResponse>('commander:tool:decision', request),
    toolAnswer: (request: {
      runId: string;
      sessionId: string;
      toolCallId: string;
      answer: string;
    }) => invoke<CommanderToolAnswerResponse>('commander:tool:answer', request),
    runGet: (request: { runId: string }) =>
      invoke<CommanderRunGetResponse>('commander:run:get', request),
    runControl: (request: CommanderRunControlRequest) =>
      invoke<CommanderRunControlResponse>('commander:run:control', request),
    runTree: (request: CommanderRunTreeRequest) =>
      invoke<CommanderRunTreeResponse>('commander:run:tree', request),
    eventsHydrate: (request: { runId: string; afterSeq: number }) =>
      invoke<CommanderEventsHydrateResponse>('commander:events:hydrate', request),
    onStream: (cb: (envelope: CommanderStreamPayload) => void) => {
      // Main emits v2 envelopes directly — no wrapping needed at the bridge.
      const wrapped: Callback = (...args: unknown[]) => {
        cb(args[0] as CommanderStreamPayload);
      };
      return subscribe('commander:stream', wrapped);
    },
    onCanvasDispatch: (cb: (data: { canvasId: string; canvas: Canvas }) => void) =>
      subscribe('commander:canvas:dispatch', cb as Callback),
    onEntitiesUpdated: (cb: (data: { toolName: string }) => void) =>
      subscribe('commander:entities:updated', cb as Callback),
    onSettingsDispatch: (
      cb: (data: { action: string; payload: Record<string, unknown> }) => void,
    ) => subscribe('commander:settings:dispatch', cb as Callback),
  },

  // Session history
  session: {
    upsert: (s: {
      id: string;
      defaultCanvasId: string | null;
      title: string;
      messages: string;
      createdAt: number;
      updatedAt: number;
    }) => invoke<void>('session:upsert', s),
    list: (limit?: number) =>
      invoke<
        Array<{
          id: string;
          defaultCanvasId: string | null;
          title: string;
          messageCount: number;
          createdAt: number;
          updatedAt: number;
        }>
      >('session:list', { limit }),
    get: (id: string) =>
      invoke<{
        id: string;
        defaultCanvasId: string | null;
        title: string;
        messages: string;
        createdAt: number;
        updatedAt: number;
      }>('session:get', { id }),
    delete: (id: string) => invoke<{ success: true }>('session:delete', { id }),
    move: (id: string, defaultCanvasId: string | null) =>
      invoke<{ success: true }>('session:move', { id, defaultCanvasId }),
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
  onInitError: (cb: Callback) => {
    if (appInitError !== null) {
      cb(appInitError);
      return () => {};
    }
    return subscribe('app:init-error', cb);
  },
  onFlushBeforeQuit: (cb: Callback) => subscribe('app:flush-before-quit', cb),
  sendFlushComplete: () => {
    ipcRenderer.send('app:flush-complete');
  },

  // Auto-updater
  updater: {
    check: () => invoke('updater:check'),
    download: () => invoke('updater:download'),
    install: () => invoke('updater:install'),
    status: () => invoke('updater:status'),
    onProgress: (cb: Callback) => subscribe('updater:progress', cb),
    onToast: (cb: Callback) => subscribe('updater:toast', cb),
  },

  // Authoritative Delivery package
  deliveryPackage: {
    start: (request: Record<string, unknown>) => invoke('deliveryPackage:start', request),
    status: (attemptId: string) => invoke('deliveryPackage:status', { attemptId }),
    cancel: (attemptId: string) => invoke('deliveryPackage:cancel', { attemptId }),
    retry: (attemptId: string) => invoke('deliveryPackage:retry', { attemptId }),
    open: (attemptId: string) => invoke('deliveryPackage:open', { attemptId }),
  },

  // Derived Review Cut preview
  reviewCut: {
    start: (request: Record<string, unknown>) => invoke('reviewCut:start', request),
    status: (jobId: string) => invoke('reviewCut:status', { jobId }),
    cancel: (jobId: string) => invoke('reviewCut:cancel', { jobId }),
    open: (jobId: string) => invoke('reviewCut:open', { jobId }),
  },

  // FFmpeg
  ffmpeg: {
    probe: (filePath: string) => invoke('ffmpeg:probe', { filePath }),
    thumbnail: (filePath: string, timestamp: number) =>
      invoke('ffmpeg:thumbnail', { filePath, timestamp }),
    transcode: (input: string, output: string, options?: Record<string, unknown>) =>
      invoke('ffmpeg:transcode', { input, output, options }),
  },


  // Canvas
  canvas: {
    list: () => invoke('canvas:list'),
    loadAll: () => invoke<Canvas[]>('canvas:loadAll'),
    load: (id: string) => typedInvoke('canvas:load', { id }),
    save: (data: Canvas) => typedInvoke('canvas:save', data),
    patch: (args: IpcRequest<'canvas:patch'>) => typedInvoke('canvas:patch', args),
    create: (name: string) => typedInvoke('canvas:create', { name }),
    delete: (id: string) => invoke('canvas:delete', { id }),
    restore: (id: string) => invoke('canvas:restore', { id }),
    deletePermanent: (id: string) => invoke('canvas:deletePermanent', { id }),
    rename: (id: string, name: string) => invoke('canvas:rename', { id, name }),
  },
  canvasDelivery: {
    update: (request: CanvasDeliveryUpdateRequest) =>
      invoke<CanvasDeliveryUpdateResponse>('canvasDelivery:update', request),
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
    openPath: (filePath: string) => invoke('storage:openPath', { path: filePath }),
    showInFolder: (filePath: string) => invoke('storage:showInFolder', { path: filePath }),
    clearLogs: () => invoke<{ cleared: number }>('storage:clearLogs'),
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
