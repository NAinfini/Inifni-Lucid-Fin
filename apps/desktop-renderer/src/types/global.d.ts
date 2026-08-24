export {};

import type {
  AssetEntry,
  AssetMeta,
  AssetType,
  Canvas,
  Character,
  CharacterGender,
  OAuthProviderStatus,
  OAuthProviderTarget,
  CommanderPromptGuide,
  CommanderProcessBehaviorSettings,
  CommanderStartRequest,
  CommanderStartResponse,
  CommanderRunRecord,
  CommanderRunControlRequest,
  CommanderRunControlResponse,
  CommanderRunTreeRequest,
  CommanderRunTreeResponse,
  CommanderToolActionResponse,
  ColorStyle,
  TimelineEvent,
  WireEnvelope,
  Equipment,
  EquipmentLoadout,
  EquipmentType,
  Folder,
  FolderKind,
  IpcProcessPrompt,
  LLMProviderRuntimeInput,
  LLMProviderRuntimeConfig,
  Location,
  PresetCategory,
  PresetDefinition,
  PresetLibraryExportPayload,
  PresetLibraryExportRequest,
  PresetLibraryImportPayload,
  PresetResetRequest,
  ReferenceImage,
  TaskListSummary,
  TaskSummary,
  TaskDecision,
  PlanApprovalContext,
  PlanApprovalGateKey,
  DeliveryManifestContext,
  ApprovePlanGateResult,
  RevisePlanGateResult,
  RequestVisualAuditionChangesInput,
  RequestVisualAuditionChangesResult,
  SelectVisualConstitutionCandidateInput,
  VisualConstitutionSelectionResult,
  VisualAuditionContext,
  PromptAssemblyRecord,
} from '@lucid-fin/contracts';
import type { TargetDesktopApiV1 } from '@lucid-fin/target-contracts';

/** Parsed script structure */
interface ParsedScript {
  title: string;
  scenes: Array<{
    heading: string;
    elements: Array<{ type: string; text: string }>;
  }>;
  [key: string]: unknown;
}

/** Character data */
interface CharacterData {
  id: string;
  name: string;
  description?: string;
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

/** Snapshot */
interface SnapshotMeta {
  id: string;
  name: string;
  createdAt: string;
}

/** FFmpeg probe result */
interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  codec: string;
  fps: number;
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

/** Per-kind folder CRUD surface exposed to the renderer. */
interface FolderKindApi {
  list: () => Promise<Folder[]>;
  create: (parentId: string | null, name: string) => Promise<Folder>;
  rename: (id: string, name: string) => Promise<Folder>;
  move: (id: string, newParentId: string | null) => Promise<Folder>;
  delete: (id: string) => Promise<void>;
}

declare global {
  interface Window {
    lucidTarget?: TargetDesktopApiV1;
    lucidAPI: {
      openExternal: (url: string) => Promise<void>;
      settings: {
        load: () => Promise<unknown>;
        save: (data: unknown) => Promise<void>;
        onProviderKeyUpdated: (
          cb: (data: { providerId: string; hasKey: boolean }) => void,
        ) => () => void;
        setAnalyticsEnabled: (enabled: boolean) => Promise<void>;
      };
      script: {
        parse: (content: string, format?: string) => Promise<unknown>;
        save: (data: Record<string, unknown>) => Promise<void>;
        load: () => Promise<ParsedScript | null>;
        import: (filePath: string) => Promise<ParsedScript>;
      };
      character: {
        list: () => Promise<Character[]>;
        get: (id: string) => Promise<Character>;
        save: (
          data: (Omit<CharacterData, 'id'> & { id?: string }) | Record<string, unknown>,
        ) => Promise<Character>;
        copy: (ids: string[], targetFolderId: string | null) => Promise<{ created: Character[] }>;
        delete: (ids: string[]) => Promise<{ deletedIds: string[] }>;
        setRefImage: (
          characterId: string,
          slot: string,
          assetHash: string,
          isStandard: boolean,
        ) => Promise<ReferenceImage>;
        removeRefImage: (characterId: string, slot: string) => Promise<void>;
        saveLoadout: (characterId: string, loadout: EquipmentLoadout) => Promise<EquipmentLoadout>;
        deleteLoadout: (characterId: string, loadoutId: string) => Promise<void>;
        setFolder: (ids: string[], folderId: string | null) => Promise<{ movedIds: string[] }>;
      };
      equipment: {
        list: (filter?: { type?: string }) => Promise<Equipment[]>;
        get: (id: string) => Promise<Equipment>;
        save: (data: Record<string, unknown>) => Promise<Equipment>;
        copy: (ids: string[], targetFolderId: string | null) => Promise<{ created: Equipment[] }>;
        delete: (ids: string[]) => Promise<{ deletedIds: string[] }>;
        setRefImage: (
          equipmentId: string,
          slot: string,
          assetHash: string,
          isStandard: boolean,
        ) => Promise<ReferenceImage>;
        removeRefImage: (equipmentId: string, slot: string) => Promise<void>;
        setFolder: (ids: string[], folderId: string | null) => Promise<{ movedIds: string[] }>;
      };
      location: {
        list: (filter?: { type?: string }) => Promise<Location[]>;
        get: (id: string) => Promise<Location>;
        save: (data: Record<string, unknown>) => Promise<Location>;
        copy: (ids: string[], targetFolderId: string | null) => Promise<{ created: Location[] }>;
        delete: (ids: string[]) => Promise<{ deletedIds: string[] }>;
        setRefImage: (
          locationId: string,
          slot: string,
          assetHash: string,
          isStandard: boolean,
        ) => Promise<ReferenceImage>;
        removeRefImage: (locationId: string, slot: string) => Promise<void>;
        setFolder: (ids: string[], folderId: string | null) => Promise<{ movedIds: string[] }>;
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
        ) => Promise<{ taskListId: string }>;
      };
      assetEntry: {
        import: (filePath: string, type: string) => Promise<AssetEntry>;
        importBuffer: (buffer: ArrayBuffer, fileName: string, type: string) => Promise<AssetEntry>;
        pickFile: (type: string) => Promise<AssetEntry | null>;
        query: (filter: Record<string, unknown>) => Promise<AssetEntry[]>;
        copy: (entryIds: string[], targetFolderId: string | null) => Promise<AssetEntry[]>;
        move: (entryIds: string[], folderId: string | null) => Promise<{ movedEntryIds: string[] }>;
        rename: (entryId: string, displayName: string) => Promise<AssetEntry>;
        delete: (entryIds: string[]) => Promise<{ deletedEntryIds: string[] }>;
      };
      assetContent: {
        getPath: (hash: string, type: string, ext: string) => Promise<string>;
        inspect: (hash: string) => Promise<AssetMeta>;
        export: (args: {
          hash: string;
          type: AssetType;
          format: string;
          name?: string;
        }) => Promise<{ success: true; path: string } | null>;
      };
      taskLists: {
        list: (filter?: Record<string, unknown>) => Promise<TaskListSummary[]>;
        get: (id: string) => Promise<TaskListSummary>;
        getTasks: (taskListId: string) => Promise<TaskSummary[]>;
        startMedia: (request: {
          canvasId: string;
          nodeId: string;
          commanderSessionId: string;
          providerId?: string;
          seed?: number;
          commanderIntent?: string;
        }) => Promise<{ taskListId: string; promptAssemblyId: string }>;
        cancelMedia: (request: {
          canvasId: string;
          nodeId: string;
          commanderSessionId: string;
        }) => Promise<
          | { ok: true; taskListId: string; status: TaskListSummary['status'] }
          | { ok: false; code: 'no_active_task' }
        >;
        retryMediaEvaluation: (request: {
          taskListId: string;
          commanderSessionId: string;
        }) => Promise<{ taskListId: string; status: TaskListSummary['status'] }>;
        retryMedia: (request: {
          canvasId: string;
          nodeId: string;
          commanderSessionId: string;
          providerId?: string;
        }) => Promise<{ taskListId: string; promptAssemblyId: string }>;
        getPendingApproval: (taskListId: string) => Promise<PlanApprovalContext | null>;
        getVisualAuditions: (taskListId: string) => Promise<VisualAuditionContext | null>;
        getDelivery: (taskListId: string) => Promise<DeliveryManifestContext | null>;
        selectVisualCandidate: (
          request: SelectVisualConstitutionCandidateInput,
        ) => Promise<VisualConstitutionSelectionResult>;
        requestVisualAuditionChanges: (
          request: RequestVisualAuditionChangesInput,
        ) => Promise<RequestVisualAuditionChangesResult>;
        approveGate: (request: {
          taskListId: string;
          gateKey: PlanApprovalGateKey;
          expectedRowVersion: number;
          expectedSubjectRevision: number;
          expectedSubjectHash: string;
        }) => Promise<ApprovePlanGateResult>;
        requestChanges: (request: {
          taskListId: string;
          gateKey: PlanApprovalGateKey;
          expectedRowVersion: number;
          expectedSubjectRevision: number;
          expectedSubjectHash: string;
          reason: string;
        }) => Promise<RevisePlanGateResult>;
        rejectGate: (request: {
          taskListId: string;
          gateKey: PlanApprovalGateKey;
          expectedRowVersion: number;
          expectedSubjectRevision: number;
          expectedSubjectHash: string;
          reason: string;
        }) => Promise<RevisePlanGateResult>;
        listPendingDecisions: (request: {
          taskListId?: string;
          canvasId?: string;
        }) => Promise<TaskDecision[]>;
      };
      promptAssembly: {
        get: (id: string) => Promise<PromptAssemblyRecord | null>;
      };
      keychain: {
        isConfigured: (provider: string) => Promise<boolean>;
        getMasked: (provider: string) => Promise<string | null>;
        set: (provider: string, apiKey: string) => Promise<void>;
        delete: (provider: string) => Promise<void>;
        test: (
          provider: string,
          providerConfig?: LLMProviderRuntimeInput,
          group?: 'llm' | 'image' | 'video' | 'audio' | 'vision',
        ) => Promise<{ ok: boolean; error?: string }>;
      };
      providerOAuth: {
        status: (request: { target: OAuthProviderTarget }) => Promise<OAuthProviderStatus>;
        login: (request: { target: OAuthProviderTarget }) => Promise<OAuthProviderStatus>;
        cancelLogin: (request: { target: OAuthProviderTarget }) => Promise<OAuthProviderStatus>;
        logout: (request: { target: OAuthProviderTarget }) => Promise<OAuthProviderStatus>;
        onChanged: (cb: (status: OAuthProviderStatus) => void) => () => void;
      };
      processPrompt: {
        list: () => Promise<IpcProcessPrompt[]>;
        get: (processKey: string) => Promise<IpcProcessPrompt>;
        setCustom: (processKey: string, value: string) => Promise<void>;
        reset: (processKey: string) => Promise<void>;
      };
      folder: {
        character: FolderKindApi;
        equipment: FolderKindApi;
        location: FolderKindApi;
        asset: FolderKindApi;
      };
      commander: {
        start: (request: CommanderStartRequest) => Promise<CommanderStartResponse>;
        cancel: (request: { runId: string }) => Promise<void>;
        cancelStep: (request: { runId: string }) => Promise<{ escalated: boolean }>;
        compact: (request: {
          runId: string;
        }) => Promise<{ freedChars: number; messageCount: number; toolCount: number }>;
        injectMessage: (request: { runId: string; message: string }) => Promise<void>;
        toolDecision: (request: {
          sessionId: string;
          runId: string;
          toolCallId: string;
          approved: boolean;
        }) => Promise<CommanderToolActionResponse>;
        toolAnswer: (request: {
          sessionId: string;
          runId: string;
          toolCallId: string;
          answer: string;
        }) => Promise<CommanderToolActionResponse>;
        runGet: (request: { runId: string }) => Promise<CommanderRunRecord>;
        runControl: (request: CommanderRunControlRequest) => Promise<CommanderRunControlResponse>;
        runTree: (request: CommanderRunTreeRequest) => Promise<CommanderRunTreeResponse>;
        eventsHydrate: (request: {
          runId: string;
          afterSeq: number;
        }) => Promise<{ run: CommanderRunRecord; events: TimelineEvent[] }>;
        onStream: (
          cb: (envelope: WireEnvelope<TimelineEvent> & { sessionId: string }) => void,
        ) => () => void;
        onCanvasDispatch: (cb: (data: { canvasId: string; canvas: Canvas }) => void) => () => void;
        onEntitiesUpdated: (cb: (data: { toolName: string }) => void) => () => void;
        onSettingsDispatch: (
          cb: (data: { action: string; payload: Record<string, unknown> }) => void,
        ) => () => void;
      };
      session: {
        upsert: (s: {
          id: string;
          defaultCanvasId: string | null;
          title: string;
          messages: string;
          createdAt: number;
          updatedAt: number;
        }) => Promise<void>;
        list: (limit?: number) => Promise<
          Array<{
            id: string;
            defaultCanvasId: string | null;
            title: string;
            messageCount: number;
            createdAt: number;
            updatedAt: number;
          }>
        >;
        get: (id: string) => Promise<{
          id: string;
          defaultCanvasId: string | null;
          title: string;
          messages: string;
          createdAt: number;
          updatedAt: number;
        }>;
        delete: (id: string) => Promise<{ success: true }>;
        move: (id: string, defaultCanvasId: string | null) => Promise<{ success: true }>;
      };
      snapshot: {
        capture: (
          sessionId: string,
          label: string,
          trigger?: 'auto' | 'manual',
        ) => Promise<Record<string, unknown>>;
        list: (sessionId: string) => Promise<
          Array<{
            id: string;
            sessionId: string;
            label: string;
            trigger: string;
            createdAt: number;
          }>
        >;
        restore: (snapshotId: string) => Promise<{ success: true }>;
        delete: (snapshotId: string) => Promise<{ success: true }>;
      };
      clipboard: {
        onAIDetected: (cb: (data: { text: string }) => void) => () => void;
        setEnabled: (enabled: boolean) => Promise<void>;
      };
      onReady: (cb: () => void) => () => void;
      onInitError: (cb: (error: string) => void) => () => void;
      onFlushBeforeQuit: (cb: () => void) => () => void;
      sendFlushComplete: () => void;
      updater: {
        check: () => Promise<void>;
        download: () => Promise<void>;
        install: () => Promise<void>;
        status: () => Promise<UpdaterStatus>;
        onProgress: (cb: (status: UpdaterStatus) => void) => () => void;
        onToast: (cb: (data: { version: string }) => void) => () => void;
      };
      app: {
        version: () => Promise<string>;
        restart: () => Promise<void>;
      };
      logger: {
        getRecent: () => Promise<MainLoggerEntry[]>;
        onEntry: (cb: (entry: MainLoggerEntry) => void) => () => void;
      };
      deliveryPackage: {
        start: (request: {
          taskListId: string;
          canvasId: string;
          expectedManifestRevision: number;
          expectedManifestHash: string;
        }) => Promise<
          | { cancelled: true }
          | {
              cancelled: false;
              attempt: import('@lucid-fin/contracts').DeliveryPackageAttemptView;
            }
        >;
        status: (
          attemptId: string,
        ) => Promise<import('@lucid-fin/contracts').DeliveryPackageAttemptView | null>;
        cancel: (attemptId: string) => Promise<{
          attempt: import('@lucid-fin/contracts').DeliveryPackageAttemptView | null;
        }>;
        retry: (attemptId: string) => Promise<{
          attempt: import('@lucid-fin/contracts').DeliveryPackageAttemptView;
        }>;
        open: (attemptId: string) => Promise<{ opened: true }>;
      };
      reviewCut: {
        start: (request: {
          taskListId: string;
          canvasId: string;
          expectedManifestRevision: number;
          expectedManifestHash: string;
        }) => Promise<
          | { cancelled: true }
          | {
              cancelled: false;
              job: {
                jobId: string;
                status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
                progress: number;
                outputPath: string;
                manifestRevision: number;
                manifestHash: string;
                error?: string;
              };
            }
        >;
        status: (jobId: string) => Promise<{
          jobId: string;
          status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
          progress: number;
          outputPath: string;
          manifestRevision: number;
          manifestHash: string;
          error?: string;
        } | null>;
        cancel: (jobId: string) => Promise<{
          job: {
            jobId: string;
            status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
            progress: number;
            outputPath: string;
            manifestRevision: number;
            manifestHash: string;
            error?: string;
          } | null;
        }>;
        open: (jobId: string) => Promise<{ opened: true }>;
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
      canvas: {
        list: () => Promise<
          Array<{ id: string; name: string; updatedAt: number; archivedAt?: number }>
        >;
        loadAll: () => Promise<Canvas[]>;
        load: (id: string) => Promise<Canvas>;
        save: (data: Canvas) => Promise<void>;
        create: (name: string) => Promise<Canvas>;
        delete: (id: string) => Promise<void>;
        restore: (id: string) => Promise<void>;
        deletePermanent: (id: string) => Promise<void>;
        rename: (id: string, name: string) => Promise<void>;
        patch: (args: { canvasId: string; patch: unknown }) => Promise<void>;
      };
      canvasDelivery: {
        update: (args: {
          canvasId: string;
          expectedRevision: number;
          deliverySequence: import('@lucid-fin/contracts').OrderedDeliverySequence;
        }) => Promise<{ deliverySequence: import('@lucid-fin/contracts').OrderedDeliverySequence }>;
      };
      preset: {
        list: (filter?: {
          includeBuiltIn?: boolean;
          category?: PresetCategory;
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
      storage: {
        getOverview: () => Promise<{
          appRoot: string;
          dbSize: number;
          globalAssetsSize: number;
          globalAssetCount: number;
          logsSize: number;
          totalSize: number;
          paths: { appRoot: string; database: string; globalAssets: string; logs: string };
        }>;
        openFolder: (folderPath: string) => Promise<void>;
        openPath: (filePath: string) => Promise<void>;
        showInFolder: (filePath: string) => Promise<void>;
        clearLogs: () => Promise<{ cleared: number }>;
        vacuumDatabase: () => Promise<{ success: boolean; error?: string }>;
        backupDatabase: (destPath: string) => Promise<{ success: boolean; error?: string }>;
        restoreDatabase: (
          sourcePath: string,
        ) => Promise<{ success: boolean; error?: string; backupCreated?: string }>;
        pickFolder: () => Promise<string | null>;
        pickSaveFile: (defaultName: string) => Promise<string | null>;
        pickOpenFile: (extensions: string[]) => Promise<string | null>;
      };
      /** IPC health check for connection monitoring */
      ipc: {
        ping: () => Promise<'pong'>;
      };
    };
  }
}
