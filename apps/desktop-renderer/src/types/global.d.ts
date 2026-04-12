export {};

import type {
  AssetType,
  Canvas,
  Character,
  CharacterGender,
  ColorStyle,
  Equipment,
  EquipmentLoadout,
  EquipmentType,
  LLMProviderRuntimeInput,
  LLMProviderRuntimeConfig,
  Location,
  LocationType,
  PresetCategory,
  PresetDefinition,
  PresetLibraryExportPayload,
  PresetLibraryExportRequest,
  PresetLibraryImportPayload,
  PresetResetRequest,
  ProjectManifest,
  ReferenceImage,
  WorkflowActivitySummary,
  WorkflowStageRun,
  WorkflowStageUpdatedEvent,
  WorkflowTaskSummary,
  WorkflowTaskUpdatedEvent,
  WorkflowUpdatedEvent,
} from '@lucid-fin/contracts';

/** Minimal project metadata returned by project:list */
interface ProjectMeta {
  id: string;
  title: string;
  path: string;
  updatedAt: number;
}

/** Parsed script structure */
interface ParsedScript {
  title: string;
  scenes: Array<{
    heading: string;
    elements: Array<{ type: string; text: string }>;
  }>;
  [key: string]: unknown;
}

/** Scene data */
interface SceneData {
  id: string;
  heading: string;
  synopsis?: string;
  order: number;
  title?: string;
  projectId?: string;
  keyframes?: unknown[];
  [key: string]: unknown;
}

/** Character data */
interface CharacterData {
  id: string;
  name: string;
  description?: string;
  referenceImage?: string;
}

/** Style guide */
interface StyleGuide {
  global?: {
    artStyle?: string;
    colorPalette?: {
      primary?: string;
      secondary?: string;
      forbidden?: string[];
    };
    lighting?: string;
    texture?: string;
    referenceImages?: string[];
    freeformDescription?: string;
    [key: string]: unknown;
  };
  sceneOverrides?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Orchestration segment */
interface SegmentData {
  id: string;
  sceneId: string;
  order?: number;
  startKeyframeId?: string;
  endKeyframeId?: string;
  motion?: string;
  camera?: string;
  mood?: string;
  moodIntensity?: number;
  negativePrompt?: string;
  seed?: number | null;
  duration?: number;
  shotType?: string;
  description?: string;
  prompt?: string;
}

/** Asset metadata */
interface AssetMeta {
  hash: string;
  type: string;
  mimeType: string;
  size: number;
  createdAt: string;
  [key: string]: unknown;
}

/** Job request */
interface JobRequest {
  type: string;
  providerId: string;
  prompt: string;
  projectId: string;
  width?: number;
  height?: number;
  duration?: number;
  seed?: number;
  params?: Record<string, unknown>;
  priority?: number;
}

/** Job summary */
interface JobSummary {
  id: string;
  adapter: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  result?: unknown;
  error?: string;
  [key: string]: unknown;
}

/** Snapshot */
interface SnapshotMeta {
  id: string;
  name: string;
  createdAt: string;
}

/** Render request (P2 — expand as render pipeline is built) */
interface RenderRequest {
  sceneId: string;
  segmentIds?: string[];
  outputFormat: 'mp4' | 'mov' | 'webm';
  resolution?: { width: number; height: number };
  fps?: number;
}

/** Render result */
interface RenderResult {
  outputPath: string;
  duration: number;
  format: string;
}

/** Export preset */
interface ExportPreset {
  format: 'fcpxml' | 'edl';
  includeAudio: boolean;
  includeSubtitles: boolean;
}

/** Export result */
interface ExportResult {
  outputPath: string;
  format: string;
  fileSize: number;
}

/** FFmpeg probe result */
interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  codec: string;
  fps: number;
}

/** Prompt template */
interface PromptEntry {
  code: string;
  name: string;
  type: string;
  hasCustom: boolean;
}

/** Prompt detail */
interface PromptDetail {
  code: string;
  name: string;
  defaultValue: string;
  customValue: string | null;
}

/** Series metadata */
interface SeriesData {
  id: string;
  title: string;
  description: string;
}

/** Episode metadata */
interface EpisodeData {
  id: string;
  title: string;
  projectId: string;
  order: number;
  status: 'draft' | 'in_progress' | 'review' | 'final';
  createdAt: number;
  updatedAt: number;
}

interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
}

interface UpdaterStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
  progress?: number;
  info?: UpdateInfo;
  error?: string;
}

interface MainLoggerEntry {
  id: string;
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  category: string;
  message: string;
  detail?: string;
}

interface CommanderToolSummary {
  name: string;
  description: string;
  tags?: string[];
  tier: number;
}

interface CommanderToolSearchResult {
  name: string;
  description: string;
}

declare global {
  interface Window {
    lucidAPI: {
      openExternal: (url: string) => Promise<void>;
      settings: {
        load: () => Promise<unknown>;
        save: (data: unknown) => Promise<void>;
      };
      project: {
        create: (config: { title: string; description?: string; genre?: string; resolution?: [number, number]; fps?: number; basePath?: string }) => Promise<ProjectManifest>;
        open: (path: string) => Promise<ProjectManifest>;
        save: () => Promise<void>;
        list: () => Promise<ProjectMeta[]>;
        snapshot: (name: string) => Promise<SnapshotMeta>;
        snapshotList: () => Promise<SnapshotMeta[]>;
        snapshotRestore: (snapshotId: string) => Promise<void>;
      };
      script: {
        parse: (content: string, format?: string) => Promise<unknown>;
        save: (data: Record<string, unknown>) => Promise<void>;
        load: () => Promise<ParsedScript | null>;
        import: (filePath: string) => Promise<ParsedScript>;
      };
      scene: {
        list: () => Promise<SceneData[]>;
        create: (data: Omit<SceneData, 'id'>) => Promise<SceneData>;
        update: (id: string, data: Partial<SceneData>) => Promise<SceneData>;
        delete: (id: string) => Promise<void>;
      };
      character: {
        list: () => Promise<Character[]>;
        get: (id: string) => Promise<Character>;
        save: (
          data: (Omit<CharacterData, 'id'> & { id?: string }) | Record<string, unknown>,
        ) => Promise<Character>;
        delete: (id: string) => Promise<void>;
        setRefImage: (
          characterId: string,
          slot: string,
          assetHash: string,
          isStandard: boolean,
        ) => Promise<ReferenceImage>;
        removeRefImage: (characterId: string, slot: string) => Promise<void>;
        saveLoadout: (
          characterId: string,
          loadout: EquipmentLoadout,
        ) => Promise<EquipmentLoadout>;
        deleteLoadout: (characterId: string, loadoutId: string) => Promise<void>;
      };
      equipment: {
        list: (filter?: { type?: string }) => Promise<Equipment[]>;
        get: (id: string) => Promise<Equipment>;
        save: (
          data: Record<string, unknown>,
        ) => Promise<Equipment>;
        delete: (id: string) => Promise<void>;
        setRefImage: (
          equipmentId: string,
          slot: string,
          assetHash: string,
          isStandard: boolean,
        ) => Promise<ReferenceImage>;
        removeRefImage: (equipmentId: string, slot: string) => Promise<void>;
      };
      location: {
        list: (filter?: { type?: string }) => Promise<Location[]>;
        get: (id: string) => Promise<Location>;
        save: (data: Record<string, unknown>) => Promise<Location>;
        delete: (id: string) => Promise<void>;
        setRefImage: (
          locationId: string,
          slot: string,
          assetHash: string,
          isStandard: boolean,
        ) => Promise<ReferenceImage>;
        removeRefImage: (locationId: string, slot: string) => Promise<void>;
      };
      entity: {
        generateReferenceImage: (request: {
          entityType: 'character' | 'equipment' | 'location';
          entityId: string;
          description: string;
          provider: string;
          variantCount?: number;
          seed?: number;
        }) => Promise<{ variants: string[] }>;
      };
      style: {
        save: (data: Partial<StyleGuide>) => Promise<void>;
        load: () => Promise<StyleGuide | null>;
      };
      colorStyle: {
        list: () => Promise<ColorStyle[]>;
        save: (data: Record<string, unknown>) => Promise<ColorStyle>;
        delete: (id: string) => Promise<void>;
        extract: (
          assetHash: string,
          assetType: 'image' | 'video',
        ) => Promise<{ workflowRunId: string }>;
      };
      orchestration: {
        list: (sceneId: string) => Promise<SegmentData[]>;
        save: (data: Omit<SegmentData, 'id'> & { id?: string }) => Promise<SegmentData>;
        delete: (id: string) => Promise<void>;
        reorder: (sceneId: string, segmentIds: string[]) => Promise<void>;
        generatePrompt: (segmentId: string) => Promise<string | { prompt: string }>;
      };
      asset: {
        import: (filePath: string, type: string) => Promise<AssetMeta>;
        importBuffer: (buffer: ArrayBuffer, fileName: string, type: string) => Promise<AssetMeta>;
        pickFile: (type: string) => Promise<AssetMeta | null>;
        query: (filter: Record<string, unknown>) => Promise<AssetMeta[]>;
        getPath: (hash: string, type: string, ext: string) => Promise<string>;
        export: (args: {
          hash: string;
          type: AssetType;
          format: string;
          name?: string;
        }) => Promise<{ success: true; path: string } | null>;
        exportBatch: (args: {
          items: Array<{ hash: string; type: string; name?: string }>;
        }) => Promise<{ success: true; count: number; directory: string } | null>;
        delete: (hash: string) => Promise<{ success: true }>;
      };
      job: {
        submit: (request: JobRequest) => Promise<JobSummary>;
        list: (filter?: Record<string, unknown>) => Promise<JobSummary[]>;
        cancel: (jobId: string) => Promise<void>;
        pause: (jobId: string) => Promise<void>;
        resume: (jobId: string) => Promise<void>;
        onProgress: (cb: (job: JobSummary) => void) => () => void;
        onComplete: (cb: (job: JobSummary) => void) => () => void;
      };
      workflow: {
        list: (filter?: Record<string, unknown>) => Promise<WorkflowActivitySummary[]>;
        get: (id: string) => Promise<WorkflowActivitySummary>;
        getStages: (workflowRunId: string) => Promise<WorkflowStageRun[]>;
        getTasks: (workflowRunId: string) => Promise<WorkflowTaskSummary[]>;
        start: (request: Record<string, unknown>) => Promise<{ workflowRunId: string }>;
        pause: (id: string) => Promise<void>;
        resume: (id: string) => Promise<void>;
        cancel: (id: string) => Promise<void>;
        retryTask: (taskRunId: string) => Promise<void>;
        retryStage: (stageRunId: string) => Promise<void>;
        retryWorkflow: (id: string) => Promise<void>;
        onUpdated: (cb: (event: WorkflowUpdatedEvent) => void) => () => void;
        onTaskUpdated: (cb: (event: WorkflowTaskUpdatedEvent) => void) => () => void;
        onStageUpdated: (cb: (event: WorkflowStageUpdatedEvent) => void) => () => void;
      };
      keychain: {
        isConfigured: (provider: string) => Promise<boolean>;
        get: (provider: string) => Promise<string | null>;
        set: (provider: string, apiKey: string) => Promise<void>;
        delete: (provider: string) => Promise<void>;
        test: (
          provider: string,
          providerConfig?: LLMProviderRuntimeInput,
          group?: 'llm' | 'image' | 'video' | 'audio' | 'vision',
        ) => Promise<{ ok: boolean; error?: string }>;
      };
      ai: {
        chat: (message: string, context?: Record<string, unknown>) => Promise<unknown>;
        onStream: (cb: (...args: unknown[]) => void) => () => void;
        onEvent: (cb: (event: Record<string, unknown>) => void) => () => void;
        promptList: () => Promise<PromptEntry[]>;
        promptGet: (code: string) => Promise<PromptDetail>;
        promptSetCustom: (code: string, value: string) => Promise<void>;
        promptClearCustom: (code: string) => Promise<void>;
      };
      commander: {
        chat: (
          canvasId: string,
          message: string,
          history: Array<Record<string, unknown>>,
          selectedNodeIds: string[],
          promptGuides?: Array<{ id: string; name: string; content: string }>,
          customLLMProvider?: LLMProviderRuntimeConfig,
          permissionMode?: 'auto' | 'normal' | 'strict',
          locale?: string,
          maxSteps?: number,
          temperature?: number,
          maxTokens?: number,
        ) => Promise<void>;
        cancel: (canvasId: string) => Promise<void>;
        compact: (canvasId: string) => Promise<{ freedChars: number; messageCount: number; toolCount: number }>;
        injectMessage: (canvasId: string, message: string) => Promise<void>;
        confirmTool: (canvasId: string, toolCallId: string, approved: boolean) => Promise<void>;
        answerQuestion: (canvasId: string, toolCallId: string, answer: string) => Promise<void>;
        toolList: () => Promise<CommanderToolSummary[]>;
        toolSearch: (query?: string) => Promise<CommanderToolSearchResult[]>;
        onStream: (cb: (data: {
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
        }) => void) => () => void;
        onCanvasUpdated: (cb: (data: { canvasId: string; canvas: Canvas }) => void) => () => void;
        onEntitiesUpdated: (cb: (data: { toolName: string }) => void) => () => void;
        onSettingsDispatch: (cb: (data: { action: string; payload: Record<string, unknown> }) => void) => () => void;
        onUndoDispatch: (cb: (data: { action: 'undo' | 'redo' }) => void) => () => void;
      };
      clipboard: {
        onAIDetected: (cb: (data: { text: string }) => void) => () => void;
        setEnabled: (enabled: boolean) => Promise<void>;
      };
      onReady: (cb: () => void) => () => void;
      onInitError: (cb: (error: string) => void) => () => void;
      updater: {
        check: () => Promise<void>;
        download: () => Promise<void>;
        install: () => Promise<void>;
        status: () => Promise<UpdaterStatus>;
        onProgress: (cb: (status: UpdaterStatus) => void) => () => void;
      };
      app: {
        version: () => Promise<string>;
      };
      logger: {
        getRecent: () => Promise<MainLoggerEntry[]>;
        onEntry: (cb: (entry: MainLoggerEntry) => void) => () => void;
      };
      render: {
        start: (request: RenderRequest) => Promise<RenderResult>;
        status: (jobId: string) => Promise<{ progress: number; stage: string }>;
        cancel: (jobId: string) => Promise<void>;
      };
      export: {
        nle: (preset: ExportPreset) => Promise<ExportResult>;
        assetBundle: (assetHashes: string[], outputPath?: string) => Promise<ExportResult | null>;
        subtitles: (format: 'srt' | 'vtt', outputPath: string) => Promise<void>;
        storyboard: (nodes: Array<Record<string, unknown>>, projectTitle?: string, outputPath?: string) => Promise<ExportResult | null>;
        metadata: (format: 'csv' | 'json', nodes: Array<Record<string, unknown>>, projectTitle?: string, outputPath?: string) => Promise<ExportResult | null>;
        importSrt: (canvasId: string, filePath: string, alignToNodes?: boolean) => Promise<{ importedCount: number; alignedCount: number; noVideoNodes?: boolean }>;
        capcut: (nodes: Array<Record<string, unknown>>, projectTitle?: string, outputDir?: string) => Promise<{ draftDir: string } | null>;
      };
      ffmpeg: {
        probe: (filePath: string) => Promise<ProbeResult>;
        thumbnail: (filePath: string, timestamp: number) => Promise<string>;
        transcode: (
          input: string,
          output: string,
          options?: Record<string, unknown>,
        ) => Promise<void>;
      };
      series: {
        get: () => Promise<SeriesData | null>;
        save: (data: SeriesData) => Promise<SeriesData>;
        delete: () => Promise<void>;
        episodes: {
          list: () => Promise<EpisodeData[]>;
          add: (episode: EpisodeData) => Promise<EpisodeData>;
          remove: (id: string) => Promise<void>;
          reorder: (ids: string[]) => Promise<void>;
        };
      };
      canvas: {
        list: () => Promise<Array<{ id: string; name: string; updatedAt: number }>>;
        load: (id: string) => Promise<Canvas>;
        save: (data: Canvas) => Promise<void>;
        create: (name: string) => Promise<Canvas>;
        delete: (id: string) => Promise<void>;
        rename: (id: string, name: string) => Promise<void>;
        patch: (args: { canvasId: string; patch: unknown }) => Promise<void>;
      };
      canvasGeneration: {
        generate: (
          canvasId: string,
          nodeId: string,
          providerId?: string,
          variantCount?: number,
          seed?: number,
          providerConfig?: { baseUrl: string; model: string; apiKey?: string },
        ) => Promise<{ jobId: string }>;
        cancel: (canvasId: string, nodeId: string) => Promise<void>;
        estimateCost: (
          canvasId: string,
          nodeId: string,
          providerId: string,
          providerConfig?: { baseUrl: string; model: string; apiKey?: string },
        ) => Promise<{ estimatedCost: number; currency: string }>;
        extractLastFrame: (canvasId: string, nodeId: string) => Promise<void>;
        onProgress: (cb: (data: {
          canvasId: string;
          nodeId: string;
          progress: number;
          currentStep?: string;
        }) => void) => () => void;
        onComplete: (cb: (data: {
          canvasId: string;
          nodeId: string;
          variants: string[];
          primaryAssetHash: string;
          cost?: number;
          generationTimeMs: number;
        }) => void) => () => void;
        onFailed: (cb: (data: {
          canvasId: string;
          nodeId: string;
          error: string;
        }) => void) => () => void;
      };
      preset: {
        list: (filter?: {
          includeBuiltIn?: boolean;
          category?: PresetCategory;
          projectId?: string;
        }) => Promise<PresetDefinition[]>;
        save: (data: PresetDefinition) => Promise<PresetDefinition>;
        delete: (id: string) => Promise<void>;
        reset: (request: PresetResetRequest) => Promise<PresetDefinition>;
        import: (payload: PresetLibraryImportPayload) => Promise<PresetLibraryExportPayload>;
        export: (options?: PresetLibraryExportRequest) => Promise<PresetLibraryExportPayload>;
      };
      vision: {
        describeImage: (
          assetHash: string,
          assetType: 'image' | 'video',
          style?: 'prompt' | 'description' | 'style-analysis',
        ) => Promise<{ prompt: string }>;
      };
      embedding: {
        generate: (assetHash: string) => Promise<{ ok: boolean }>;
        search: (
          query: string,
          limit?: number,
        ) => Promise<{ hash: string; score: number; description: string }[]>;
        reindex: () => Promise<{ indexed: number; failed: number }>;
      };
      lipsync: {
        process: (canvasId: string, nodeId: string) => Promise<void>;
        checkAvailability: () => Promise<{ available: boolean; backend: string }>;
      };
      video: {
        pickFile: () => Promise<string | null>;
        clone: (filePath: string, projectId: string, threshold?: number) => Promise<{ canvasId: string; nodeCount: number }>;
        onCloneProgress: (cb: (data: { step: string; current: number; total: number; message: string }) => void) => () => void;
      };
      storage: {
        getOverview: () => Promise<{
          appRoot: string;
          dbSize: number;
          globalAssetsSize: number;
          globalAssetCount: number;
          projectsSize: number;
          logsSize: number;
          totalSize: number;
          projects: Array<{ name: string; path: string; size: number }>;
          paths: { appRoot: string; database: string; globalAssets: string; projects: string; logs: string };
        }>;
        openFolder: (folderPath: string) => Promise<void>;
        showInFolder: (filePath: string) => Promise<void>;
        clearLogs: () => Promise<{ cleared: number }>;
        clearEmbeddings: () => Promise<{ success: boolean; error?: string }>;
        vacuumDatabase: () => Promise<{ success: boolean; error?: string }>;
        backupDatabase: (destPath: string) => Promise<{ success: boolean; error?: string }>;
        restoreDatabase: (sourcePath: string) => Promise<{ success: boolean; error?: string; backupCreated?: string }>;
        getProjectsPath: () => Promise<string>;
        setProjectsPath: (newPath: string) => Promise<{ success: boolean; error?: string }>;
        pickFolder: () => Promise<string | null>;
        pickSaveFile: (defaultName: string) => Promise<string | null>;
        pickOpenFile: (extensions: string[]) => Promise<string | null>;
      };
    };
  }
}
