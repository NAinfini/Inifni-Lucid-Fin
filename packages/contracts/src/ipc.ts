import type { StyleGuide } from './dto/project.js';
import type { AssetEntry, AssetType } from './dto/asset.js';
import type { Character, ReferenceImage, EquipmentLoadout } from './dto/character.js';
import type { Equipment } from './dto/equipment.js';
import type { ScriptDocument, ParsedScene } from './dto/script.js';
import type { ColorStyle } from './dto/color-style.js';
import type { TaskListSummary, TaskSummary } from './dto/task-execution.js';
import type { Canvas } from './dto/canvas.js';
import type {
  PresetCategory,
  PresetDefinition,
  PresetLibraryExportPayload,
  PresetLibraryExportRequest,
  PresetLibraryImportPayload,
  PresetResetRequest,
} from './dto/presets/index.js';
import type { LLMProviderRuntimeInput } from './llm-provider.js';
import type {
  CommanderRunRecord,
  CommanderStartRequest,
  CommanderStreamPayload,
  CommanderToolActionResponse,
} from './ipc/channels/batch-09.js';

/** Session stored in SQLite — lightweight chat-history record. */
export interface IpcStoredSession {
  id: string;
  defaultCanvasId: string | null;
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

/**
 * @deprecated Since Phase B the single source of truth for channels is the
 * registry in `@lucid-fin/contracts-parse` (`allChannels` — 169 entries).
 *
 * This map is frozen and retained only for:
 *  - Legacy typecheck tests that assert handler response shapes.
 *  - Backward compatibility with any out-of-tree consumer still importing
 *    `IpcChannelMap` / `IpcRequest<C>` / `IpcResponse<C>`.
 *
 * New code MUST NOT extend this map. Add zod channels to the appropriate
 * `packages/contracts-parse/src/ipc/channels/batch-NN.ts` and mirror the
 * pure-type shape in `packages/contracts/src/ipc/channels/batch-NN.ts`.
 *
 * Deletion is gated on the preload runtime cutover: renderer must first
 * migrate from the hand-written `apps/desktop-main/src/preload.cts` to
 * `preload.generated.cts` (positional-arg → single-object-arg form) and
 * from the hand-written `apps/desktop-renderer/src/types/global.d.ts`
 * shape to `LucidAPI` from `lucid-api.generated.ts`. That migration is
 * scope-disproportionate to the channel registration PR chain and is
 * tracked as a follow-up task.
 */
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
    request: { ids: string[] };
    response: { deletedIds: string[] };
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
    request: { ids: string[] };
    response: { deletedIds: string[] };
  };
  'equipment:setRefImage': {
    request: { equipmentId: string; slot: string; assetHash: string; isStandard: boolean };
    response: ReferenceImage;
  };
  'equipment:removeRefImage': {
    request: { equipmentId: string; slot: string };
    response: void;
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
  'assetEntry:import': {
    request: { filePath: string; type: 'image' | 'video' | 'audio' };
    response: AssetEntry;
  };
  'assetEntry:query': {
    request: { type?: string; tags?: string[]; search?: string; limit?: number; offset?: number };
    response: AssetEntry[];
  };
  'assetEntry:rename': {
    request: { entryId: string; displayName: string };
    response: AssetEntry;
  };
  'assetContent:export': {
    request: { hash: string; type: AssetType; format: string; name?: string };
    response: { success: true; path: string } | null;
  };

  // --- Persistent Task Lists ---
  'taskList:list': {
    request: { status?: string } | void;
    response: TaskListSummary[];
  };
  'taskList:get': {
    request: { id: string };
    response: TaskListSummary;
  };
  'taskList:getTasks': {
    request: { taskListId: string };
    response: TaskSummary[];
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
  'commander:start': {
    request: CommanderStartRequest;
    response: { runId: string; sessionId: string; acceptedAt: number };
  };
  'commander:cancel': {
    request: { runId: string };
    response: void;
  };
  'commander:cancel-step': {
    request: { runId: string };
    response: { escalated: boolean };
  };
  'commander:compact': {
    request: { runId: string };
    response: { freedChars: number; messageCount: number; toolCount: number };
  };
  'commander:inject-message': {
    request: { runId: string; message: string };
    response: void;
  };
  'commander:tool:decision': {
    request: { runId: string; sessionId: string; toolCallId: string; approved: boolean };
    response: CommanderToolActionResponse;
  };
  'commander:tool:answer': {
    request: { runId: string; sessionId: string; toolCallId: string; answer: string };
    response: CommanderToolActionResponse;
  };
  'commander:run:get': {
    request: { runId: string };
    response: CommanderRunRecord;
  };
  'commander:events:hydrate': {
    request: { runId: string; afterSeq: number };
    response: { run: CommanderRunRecord; events: CommanderStreamPayload['event'][] };
  };
  'commander:stream': {
    // v2-only wire payload: `WireEnvelope<TimelineEvent>`.
    request: CommanderStreamPayload;
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
    response: { taskListId: string };
  };

  // --- Preset ---
  'preset:list': {
    request: {
      includeBuiltIn?: boolean;
      category?: PresetCategory;
    } | void;
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
