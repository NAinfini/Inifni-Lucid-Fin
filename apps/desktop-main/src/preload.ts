import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  Canvas,
  PresetCategory,
  PresetDefinition,
  PresetLibraryExportPayload,
  PresetLibraryExportRequest,
  PresetLibraryImportPayload,
  PresetResetRequest,
  EquipmentLoadout,
} from '@lucid-fin/contracts';

type Callback = (...args: unknown[]) => void;

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args);
}

function subscribe(channel: string, cb: Callback): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => cb(...args);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

let appReady = false;
ipcRenderer.on('app:ready', () => { appReady = true; });

contextBridge.exposeInMainWorld('lucidAPI', {
  // Shell
  openExternal: (url: string) => invoke('shell:openExternal', { url }),
  settings: {
    load: () => invoke('settings:load'),
    save: (data: unknown) => invoke('settings:save', data),
  },
  app: {
    version: () => invoke<string>('app:version'),
  },

  // Project
  project: {
    create: (config: Record<string, unknown>) => invoke('project:create', config),
    open: (path: string) => invoke('project:open', { path }),
    save: () => invoke('project:save'),
    list: () => invoke('project:list'),
    snapshot: (name: string) => invoke('project:snapshot', { name }),
    snapshotList: () => invoke('project:snapshot:list'),
    snapshotRestore: (snapshotId: string) => invoke('project:snapshot:restore', { snapshotId }),
  },

  // Script
  script: {
    parse: (content: string, format?: string) => invoke('script:parse', { content, format }),
    save: (data: Record<string, unknown>) => invoke('script:save', data),
    load: () => invoke('script:load'),
    import: (filePath: string) => invoke('script:import', { filePath }),
  },

  // Scene
  scene: {
    list: () => invoke('scene:list'),
    create: (data: Record<string, unknown>) => invoke('scene:create', data),
    update: (id: string, data: Record<string, unknown>) => invoke('scene:update', { id, data }),
    delete: (id: string) => invoke('scene:delete', { id }),
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
  },

  // Equipment
  equipment: {
    list: (filter?: { type?: string }) =>
      invoke('equipment:list', filter ?? {}),
    get: (id: string) => invoke('equipment:get', { id }),
    save: (data: Record<string, unknown>) => invoke('equipment:save', data),
    delete: (id: string) => invoke('equipment:delete', { id }),
    setRefImage: (equipmentId: string, slot: string, assetHash: string, isStandard: boolean) =>
      invoke('equipment:setRefImage', { equipmentId, slot, assetHash, isStandard }),
    removeRefImage: (equipmentId: string, slot: string) =>
      invoke('equipment:removeRefImage', { equipmentId, slot }),
  },

  // Location
  location: {
    list: (filter?: { type?: string }) =>
      invoke('location:list', filter ?? {}),
    get: (id: string) => invoke('location:get', { id }),
    save: (data: Record<string, unknown>) => invoke('location:save', data),
    delete: (id: string) => invoke('location:delete', { id }),
    setRefImage: (locationId: string, slot: string, assetHash: string, isStandard: boolean) =>
      invoke('location:setRefImage', { locationId, slot, assetHash, isStandard }),
    removeRefImage: (locationId: string, slot: string) =>
      invoke('location:removeRefImage', { locationId, slot }),
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
    pickFile: (type: string) => invoke('asset:pickFile', { type }),
    query: (filter: Record<string, unknown>) => invoke('asset:query', filter),
    getPath: (hash: string, type: string, ext: string) =>
      invoke('asset:getPath', { hash, type, ext }),
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
    onUpdated: (cb: Callback) => subscribe('workflow:updated', cb),
    onTaskUpdated: (cb: Callback) => subscribe('workflow:task-updated', cb),
    onStageUpdated: (cb: Callback) => subscribe('workflow:stage-updated', cb),
  },

  // Keychain
  keychain: {
    isConfigured: (provider: string) => invoke('keychain:isConfigured', { provider }),
    get: (provider: string) => invoke<string | null>('keychain:get', { provider }),
    set: (provider: string, apiKey: string) => invoke('keychain:set', { provider, apiKey }),
    delete: (provider: string) => invoke('keychain:delete', { provider }),
    test: (provider: string, baseUrl?: string, model?: string) => invoke<{ ok: boolean; error?: string }>('keychain:test', { provider, baseUrl, model }),
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
  commander: {
    chat: (
      canvasId: string,
      message: string,
      history: Array<{ role: 'user' | 'assistant'; content: string }>,
      selectedNodeIds: string[],
      promptGuides?: Array<{ id: string; name: string; content: string }>,
      customLLMProvider?: { id: string; name: string; baseUrl: string; model: string },
      permissionMode?: 'auto' | 'normal' | 'strict',
    ) => invoke('commander:chat', { canvasId, message, history, selectedNodeIds, promptGuides, customLLMProvider, permissionMode }),
    cancel: (canvasId: string) => invoke('commander:cancel', { canvasId }),
    injectMessage: (canvasId: string, message: string) =>
      invoke('commander:inject-message', { canvasId, message }),
    confirmTool: (canvasId: string, toolCallId: string, approved: boolean) =>
      invoke('commander:tool:decision', { canvasId, toolCallId, approved }),
    answerQuestion: (canvasId: string, toolCallId: string, answer: string) =>
      invoke('commander:tool:answer', { canvasId, toolCallId, answer }),
    onStream: (
      cb: (data: {
        type: 'chunk' | 'tool_call' | 'tool_result' | 'done' | 'error' | 'tool_confirm' | 'tool_question';
        content?: string;
        toolName?: string;
        toolCallId?: string;
        arguments?: Record<string, unknown>;
        result?: unknown;
        error?: string;
        tier?: number;
        question?: string;
        options?: Array<{ label: string; description?: string }>;
        startedAt?: number;
        completedAt?: number;
      }) => void,
    ) => subscribe('commander:stream', cb as Callback),
    onCanvasUpdated: (cb: (data: { canvasId: string; canvas: Canvas }) => void) =>
      subscribe('commander:canvas:updated', cb as Callback),
    onEntitiesUpdated: (cb: (data: { toolName: string }) => void) =>
      subscribe('commander:entities:updated', cb as Callback),
  },

  // App events
  onReady: (cb: Callback) => {
    if (appReady) { cb(); return () => {}; }
    return subscribe('app:ready', cb);
  },
  onInitError: (cb: Callback) => subscribe('app:init-error', cb),

  // Auto-updater
  updater: {
    check: () => invoke('updater:check'),
    download: () => invoke('updater:download'),
    install: () => invoke('updater:install'),
    status: () => invoke('updater:status'),
    onProgress: (cb: Callback) => subscribe('updater:status', cb),
  },

  // Orchestration
  orchestration: {
    list: (sceneId: string) => invoke('orchestration:list', { sceneId }),
    save: (data: Record<string, unknown>) => invoke('orchestration:save', data),
    delete: (id: string) => invoke('orchestration:delete', { id }),
    reorder: (sceneId: string, segmentIds: string[]) =>
      invoke('orchestration:reorder', { sceneId, segmentIds }),
    generatePrompt: (segmentId: string) => invoke('orchestration:generatePrompt', { segmentId }),
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
    assetBundle: (outputPath: string) => invoke('export:assetBundle', { outputPath }),
    subtitles: (format: string, outputPath: string) =>
      invoke('export:subtitles', { format, outputPath }),
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
    load: (id: string) => invoke('canvas:load', { id }),
    save: (data: Record<string, unknown>) => invoke('canvas:save', data),
    create: (name: string) => invoke('canvas:create', { name }),
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
    estimateCost: (canvasId: string, nodeId: string, providerId: string, providerConfig?: { baseUrl: string; model: string; apiKey?: string }) =>
      invoke('canvas:estimateCost', { canvasId, nodeId, providerId, providerConfig }),
    onProgress: (
      cb: (data: {
        canvasId: string;
        nodeId: string;
        progress: number;
        currentStep?: string;
      }) => void,
    ) => {
      const handler = (_event: IpcRendererEvent, data: {
        canvasId: string;
        nodeId: string;
        progress: number;
        currentStep?: string;
      }) => cb(data);
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
      }) => void,
    ) => {
      const handler = (_event: IpcRendererEvent, data: {
        canvasId: string;
        nodeId: string;
        variants: string[];
        primaryAssetHash: string;
        cost?: number;
        generationTimeMs: number;
      }) => cb(data);
      ipcRenderer.on('canvas:generation:complete', handler);
      return () => ipcRenderer.removeListener('canvas:generation:complete', handler);
    },
    onFailed: (cb: (data: { canvasId: string; nodeId: string; error: string }) => void) => {
      const handler = (_event: IpcRendererEvent, data: {
        canvasId: string;
        nodeId: string;
        error: string;
      }) => cb(data);
      ipcRenderer.on('canvas:generation:failed', handler);
      return () => ipcRenderer.removeListener('canvas:generation:failed', handler);
    },
  },

  // Presets
  preset: {
    list: (filter?: { includeBuiltIn?: boolean; category?: PresetCategory; projectId?: string }) =>
      invoke<PresetDefinition[]>('preset:list', filter ?? {}),
    save: (data: PresetDefinition) => invoke<PresetDefinition>('preset:save', data),
    delete: (id: string) => invoke('preset:delete', { id }),
    reset: (request: PresetResetRequest) => invoke<PresetDefinition>('preset:reset', request),
    import: (payload: PresetLibraryImportPayload) =>
      invoke<PresetLibraryExportPayload>('preset:import', payload),
    export: (options?: PresetLibraryExportRequest) =>
      invoke<PresetLibraryExportPayload>('preset:export', options ?? {}),
  },
});
