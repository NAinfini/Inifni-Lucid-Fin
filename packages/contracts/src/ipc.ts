import type { StyleGuide } from './dto/project.js';
import type { AssetRef, AssetMeta, AssetType } from './dto/asset.js';
import type { Job, GenerationRequest } from './dto/job.js';
import type {
  Character,
  ReferenceImage,
  EquipmentLoadout,
} from './dto/character.js';
import type { Equipment } from './dto/equipment.js';
import type { ScriptDocument, ParsedScene } from './dto/script.js';
import type { ColorStyle } from './dto/color-style.js';
import type {
  WorkflowActivitySummary,
  WorkflowStageRun,
  WorkflowTaskSummary,
} from './dto/workflow.js';
import type { Canvas } from './dto/canvas.js';
import type {
  PresetCategory,
  PresetDefinition,
  PresetLibraryExportPayload,
  PresetLibraryExportRequest,
  PresetLibraryImportPayload,
  PresetResetRequest,
} from './dto/presets/index.js';
import type { LLMProviderRuntimeConfig, LLMProviderRuntimeInput } from './llm-provider.js';

/** Session stored in SQLite — lightweight chat-history record. */
export interface IpcStoredSession {
  id: string;
  canvasId: string | null;
  title: string;
  messages: string;
  createdAt: number;
  updatedAt: number;
}

/** Snapshot metadata (data blob excluded for list responses). */
export interface IpcSnapshotMeta {
  id: string;
  sessionId: string;
  label: string;
  trigger: 'auto' | 'manual';
  createdAt: number;
}

export interface IpcProcessPrompt {
  id: number;
  processKey: string;
  name: string;
  description: string;
  defaultValue: string;
  customValue: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface IpcChannelMap {
  // --- Settings ---
  'settings:load': {
    request: void;
    response: Record<string, unknown>;
  };
  'settings:save': {
    request: Record<string, unknown>;
    response: void;
  };

  // --- Script ---
  'script:parse': {
    request: { content: string; format?: 'fountain' | 'fdx' | 'plaintext' };
    response: ParsedScene[];
  };
  'script:save': {
    request: { content: string; format: string; parsedScenes: ParsedScene[] };
    response: void;
  };
  'script:load': {
    request: void;
    response: ScriptDocument | null;
  };
  'script:import': {
    request: { filePath: string };
    response: ScriptDocument;
  };

  // --- Character ---
  'character:list': {
    request: void;
    response: Character[];
  };
  'character:get': {
    request: { id: string };
    response: Character;
  };
  'character:save': {
    request: Character;
    response: Character;
  };
  'character:delete': {
    request: { id: string };
    response: void;
  };
  'character:setRefImage': {
    request: { characterId: string; slot: string; assetHash: string; isStandard: boolean };
    response: ReferenceImage;
  };
  'character:removeRefImage': {
    request: { characterId: string; slot: string };
    response: void;
  };
  'character:saveLoadout': {
    request: { characterId: string; loadout: EquipmentLoadout };
    response: EquipmentLoadout;
  };
  'character:deleteLoadout': {
    request: { characterId: string; loadoutId: string };
    response: void;
  };

  // --- Equipment ---
  'equipment:list': {
    request: { type?: string } | void;
    response: Equipment[];
  };
  'equipment:get': {
    request: { id: string };
    response: Equipment;
  };
  'equipment:save': {
    request: Equipment;
    response: Equipment;
  };
  'equipment:delete': {
    request: { id: string };
    response: void;
  };
  'equipment:setRefImage': {
    request: { equipmentId: string; slot: string; assetHash: string; isStandard: boolean };
    response: ReferenceImage;
  };
  'equipment:removeRefImage': {
    request: { equipmentId: string; slot: string };
    response: void;
  };

  // --- Entity generation ---
  'entity:generateReferenceImage': {
    request: {
      entityType: 'character' | 'equipment' | 'location';
      entityId: string;
      description: string;
      provider: string;
      variantCount?: number;
      seed?: number;
    };
    response: { variants: string[] };
  };

  // --- Style Guide ---
  'style:save': {
    request: StyleGuide;
    response: void;
  };
  'style:load': {
    request: void;
    response: StyleGuide;
  };

  // --- Asset ---
  'asset:import': {
    request: { filePath: string; type: 'image' | 'video' | 'audio' };
    response: AssetRef;
  };
  'asset:query': {
    request: { type?: string; tags?: string[]; search?: string; limit?: number; offset?: number };
    response: AssetMeta[];
  };
  'asset:export': {
    request: { hash: string; type: AssetType; format: string; name?: string };
    response: { success: true; path: string } | null;
  };

  // --- Job ---
  'job:submit': {
    request: GenerationRequest & { segmentId?: string };
    response: { jobId: string };
  };
  'job:list': {
    request: { status?: string } | void;
    response: Job[];
  };
  'job:cancel': {
    request: { jobId: string };
    response: void;
  };
  'job:pause': {
    request: { jobId: string };
    response: void;
  };
  'job:resume': {
    request: { jobId: string };
    response: void;
  };

  // --- Workflow ---
  'workflow:list': {
    request: { status?: string } | void;
    response: WorkflowActivitySummary[];
  };
  'workflow:get': {
    request: { id: string };
    response: WorkflowActivitySummary;
  };
  'workflow:getStages': {
    request: { workflowRunId: string };
    response: WorkflowStageRun[];
  };
  'workflow:getTasks': {
    request: { workflowRunId: string };
    response: WorkflowTaskSummary[];
  };
  'workflow:start': {
    request: {
      workflowType: string;
      entityType: string;
      entityId?: string;
      triggerSource?: string;
      input?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    };
    response: { workflowRunId: string };
  };
  'workflow:pause': {
    request: { id: string };
    response: void;
  };
  'workflow:resume': {
    request: { id: string };
    response: void;
  };
  'workflow:cancel': {
    request: { id: string };
    response: void;
  };
  'workflow:retryTask': {
    request: { taskRunId: string };
    response: void;
  };
  'workflow:retryStage': {
    request: { stageRunId: string };
    response: void;
  };
  'workflow:retryWorkflow': {
    request: { id: string };
    response: void;
  };

  // --- Keychain ---
  'keychain:isConfigured': {
    request: { provider: string };
    response: boolean;
  };
  'keychain:set': {
    request: { provider: string; apiKey: string };
    response: void;
  };
  'keychain:delete': {
    request: { provider: string };
    response: void;
  };
  'keychain:test': {
    request: {
      provider: string;
      group?: 'llm' | 'image' | 'video' | 'audio';
      providerConfig?: LLMProviderRuntimeInput;
      baseUrl?: string;
      model?: string;
    };
    response: { ok: boolean; error?: string };
  };

  // --- AI Commander ---
  'ai:chat': {
    request: {
      message: string;
      context?: {
        page: string;
        characterId?: string;
        extra?: Record<string, unknown>;
      };
    };
    response: string;
  };

  // --- AI Prompt Templates ---
  'ai:prompt:list': {
    request: void;
    response: Array<{ code: string; name: string; type: string; hasCustom: boolean }>;
  };
  'ai:prompt:get': {
    request: { code: string };
    response: { code: string; name: string; defaultValue: string; customValue: string | null };
  };
  'ai:prompt:setCustom': {
    request: { code: string; value: string };
    response: void;
  };
  'ai:prompt:clearCustom': {
    request: { code: string };
    response: void;
  };

  // --- Process Prompts ---
  'processPrompt:list': {
    request: void;
    response: IpcProcessPrompt[];
  };
  'processPrompt:get': {
    request: { processKey: string };
    response: IpcProcessPrompt;
  };
  'processPrompt:setCustom': {
    request: { processKey: string; value: string };
    response: void;
  };
  'processPrompt:reset': {
    request: { processKey: string };
    response: void;
  };

  // --- Commander ---
  'commander:chat': {
    request: {
      canvasId: string;
      sessionId?: string;
      message: string;
      history: Array<{ role: 'user' | 'assistant'; content: string }>;
      selectedNodeIds: string[];
      promptGuides?: Array<{ id: string; name: string; content: string }>;
      customLLMProvider?: LLMProviderRuntimeConfig;
      permissionMode?: 'auto' | 'normal' | 'strict';
    };
    response: void;
  };
  'commander:cancel': {
    request: { canvasId: string };
    response: void;
  };
  'commander:compact': {
    request: { canvasId: string };
    response: { freedChars: number; messageCount: number; toolCount: number };
  };
  'commander:inject-message': {
    request: { canvasId: string; message: string };
    response: void;
  };
  'commander:tool:decision': {
    request: { canvasId: string; toolCallId: string; approved: boolean };
    response: void;
  };
  'commander:tool:answer': {
    request: { canvasId: string; toolCallId: string; answer: string };
    response: void;
  };
  'commander:tool-list': {
    request: void;
    response: Array<{
      name: string;
      description: string;
      tags?: string[];
      tier: number;
    }>;
  };
  'commander:tool-search': {
    request: { query?: string } | void;
    response: Array<{
      name: string;
      description: string;
    }>;
  };
  'commander:stream': {
    request: {
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
    };
    response: void;
  };
  'commander:canvas:updated': {
    request: { canvasId: string; canvas: Canvas };
    response: void;
  };
  'commander:entities:updated': {
    request: { toolName: string };
    response: void;
  };

  // --- Color Style ---
  'colorStyle:list': {
    request: void;
    response: ColorStyle[];
  };
  'colorStyle:save': {
    request: ColorStyle;
    response: ColorStyle;
  };
  'colorStyle:delete': {
    request: { id: string };
    response: void;
  };
  'colorStyle:extract': {
    request: { assetHash: string; assetType: 'image' | 'video' };
    response: { workflowRunId: string };
  };

  // --- Preset ---
  'preset:list': {
    request:
      | {
          includeBuiltIn?: boolean;
          category?: PresetCategory;
        }
      | void;
    response: PresetDefinition[];
  };
  'preset:save': {
    request: PresetDefinition;
    response: PresetDefinition;
  };
  'preset:delete': {
    request: { id: string };
    response: void;
  };
  'preset:reset': {
    request: PresetResetRequest;
    response: PresetDefinition;
  };
  'preset:import': {
    request: PresetLibraryImportPayload;
    response: PresetLibraryExportPayload;
  };
  'preset:export': {
    request: PresetLibraryExportRequest | void;
    response: PresetLibraryExportPayload;
  };

  // --- Canvas Generation ---
  'canvas:generate': {
    request: {
      canvasId: string;
      nodeId: string;
      providerId?: string;
      providerConfig?: { baseUrl: string; model: string; apiKey?: string };
      variantCount?: number;
      seed?: number;
    };
    response: { jobId: string };
  };
  'canvas:cancelGeneration': {
    request: { canvasId: string; nodeId: string };
    response: void;
  };
  'canvas:estimateCost': {
    request: { canvasId: string; nodeId: string; providerId: string; providerConfig?: { baseUrl: string; model: string; apiKey?: string } };
    response: { estimatedCost: number; currency: string };
  };
  'canvas:generation:progress': {
    request: { canvasId: string; nodeId: string; progress: number; currentStep?: string };
    response: void;
  };
  'canvas:generation:complete': {
    request: {
      canvasId: string;
      nodeId: string;
      variants: string[];
      primaryAssetHash: string;
      cost?: number;
      generationTimeMs: number;
    };
    response: void;
  };
  'canvas:generation:failed': {
    request: { canvasId: string; nodeId: string; error: string };
    response: void;
  };

  // --- Canvas ---
  'canvas:list': {
    request: void;
    response: Array<{ id: string; name: string; updatedAt: number }>;
  };
  'canvas:load': {
    request: { id: string };
    response: Canvas;
  };
  'canvas:save': {
    request: Canvas;
    response: void;
  };
  'canvas:create': {
    request: { name: string };
    response: Canvas;
  };
  'canvas:delete': {
    request: { id: string };
    response: void;
  };
  'canvas:rename': {
    request: { id: string; name: string };
    response: void;
  };
  'canvas:patch': {
    request: {
      canvasId: string;
      patch: {
        canvasId: string;
        timestamp: number;
        nameChange?: string;
        addedNodes?: import('./dto/canvas.js').CanvasNode[];
        removedNodeIds?: string[];
        updatedNodes?: Array<{ id: string; changes: Record<string, unknown> }>;
        addedEdges?: import('./dto/canvas.js').CanvasEdge[];
        removedEdgeIds?: string[];
      };
    };
    response: void;
  };

  // --- Session ---
  'session:upsert': {
    request: IpcStoredSession;
    response: void;
  };
  'session:get': {
    request: { id: string };
    response: IpcStoredSession;
  };
  'session:list': {
    request: { limit?: number } | void;
    response: Array<Omit<IpcStoredSession, 'messages'>>;
  };
  'session:delete': {
    request: { id: string };
    response: { success: true };
  };

  // --- Snapshot ---
  'snapshot:capture': {
    request: { sessionId: string; label: string; trigger?: 'auto' | 'manual' };
    response: IpcSnapshotMeta;
  };
  'snapshot:list': {
    request: { sessionId: string };
    response: IpcSnapshotMeta[];
  };
  'snapshot:restore': {
    request: { snapshotId: string };
    response: { success: true };
  };
  'snapshot:delete': {
    request: { snapshotId: string };
    response: { success: true };
  };
}
