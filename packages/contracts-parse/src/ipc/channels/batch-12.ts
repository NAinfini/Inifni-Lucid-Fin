/**
 * folder.* + setFolder + processPrompt channels -- Batch 12.
 *
 * Covers:
 *   - 20 invoke channels for folder CRUD (`folder.<kind>:<op>`)
 *   - 4 invoke channels for per-entity setFolder (`<kind>:setFolder`)
 *   - 4 invoke channels for process-prompt management (`processPrompt:*`)
 *
 * Handlers live in:
 *   `apps/desktop-main/src/ipc/handlers/folder.handlers.ts`
 *   `apps/desktop-main/src/ipc/handlers/process-prompt.handlers.ts`
 *
 * Folder channels use a programmatic helper to avoid 80 lines of boilerplate.
 */
import { z } from 'zod';
import { defineInvokeChannel } from '../../channels.js';
import type { InvokeChannelDef } from '../../channels.js';

// =========================================================================
// Folder CRUD (20 channels = 5 ops x 4 kinds)
// =========================================================================

// -- Shared shapes --------------------------------------------------------
const FolderShape = z
  .object({
    id: z.string(),
    kind: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .passthrough();

const FolderCreateRequest = z.object({
  parentId: z.string().nullable(),
  name: z.string(),
});

const FolderRenameRequest = z.object({
  id: z.string(),
  name: z.string(),
});

const FolderMoveRequest = z.object({
  id: z.string(),
  newParentId: z.string().nullable(),
});

const FolderDeleteRequest = z.object({ id: z.string() });

// -- Helper ---------------------------------------------------------------

function defineFolderChannelsForKind(kind: string) {
  return {
    list: defineInvokeChannel({
      channel: `folder.${kind}:list` as const,
      request: z.object({}).strict(),
      response: z.array(FolderShape),
    }),
    create: defineInvokeChannel({
      channel: `folder.${kind}:create` as const,
      request: FolderCreateRequest,
      response: FolderShape,
    }),
    rename: defineInvokeChannel({
      channel: `folder.${kind}:rename` as const,
      request: FolderRenameRequest,
      response: FolderShape,
    }),
    move: defineInvokeChannel({
      channel: `folder.${kind}:move` as const,
      request: FolderMoveRequest,
      response: FolderShape,
    }),
    delete: defineInvokeChannel({
      channel: `folder.${kind}:delete` as const,
      request: FolderDeleteRequest,
      response: z.void(),
    }),
  };
}

export const characterFolderChannelDefs = defineFolderChannelsForKind('character');
export const equipmentFolderChannelDefs = defineFolderChannelsForKind('equipment');
export const locationFolderChannelDefs = defineFolderChannelsForKind('location');
export const assetFolderChannelDefs = defineFolderChannelsForKind('asset');

/** Flat tuple of all 20 folder CRUD channels for the allChannels registry. */
export const folderChannels = [
  ...Object.values(characterFolderChannelDefs),
  ...Object.values(equipmentFolderChannelDefs),
  ...Object.values(locationFolderChannelDefs),
  ...Object.values(assetFolderChannelDefs),
] as InvokeChannelDef[];

// -- Exported types for FolderShape ---------------------------------------
export type FolderShape = z.infer<typeof FolderShape>;
export type FolderCreateRequest = z.infer<typeof FolderCreateRequest>;
export type FolderRenameRequest = z.infer<typeof FolderRenameRequest>;
export type FolderMoveRequest = z.infer<typeof FolderMoveRequest>;
export type FolderDeleteRequest = z.infer<typeof FolderDeleteRequest>;

// =========================================================================
// Per-entity setFolder (4 channels)
// =========================================================================

const SetFolderRequest = z.object({
  id: z.string(),
  folderId: z.string().nullable(),
});

// asset:setFolder uses `hash` not `id`
const AssetSetFolderRequest = z.object({
  hash: z.string(),
  folderId: z.string().nullable(),
});

// -- character:setFolder --------------------------------------------------
export const characterSetFolderChannel = defineInvokeChannel({
  channel: 'character:setFolder',
  request: SetFolderRequest,
  response: z.void(),
});
export type CharacterSetFolderRequest = z.infer<typeof SetFolderRequest>;

// -- equipment:setFolder --------------------------------------------------
export const equipmentSetFolderChannel = defineInvokeChannel({
  channel: 'equipment:setFolder',
  request: SetFolderRequest,
  response: z.void(),
});
export type EquipmentSetFolderRequest = z.infer<typeof SetFolderRequest>;

// -- location:setFolder ---------------------------------------------------
export const locationSetFolderChannel = defineInvokeChannel({
  channel: 'location:setFolder',
  request: SetFolderRequest,
  response: z.void(),
});
export type LocationSetFolderRequest = z.infer<typeof SetFolderRequest>;

// -- asset:setFolder ------------------------------------------------------
export const assetSetFolderChannel = defineInvokeChannel({
  channel: 'asset:setFolder',
  request: AssetSetFolderRequest,
  response: z.void(),
});
export type AssetSetFolderRequest = z.infer<typeof AssetSetFolderRequest>;

export const setFolderChannels = [
  characterSetFolderChannel,
  equipmentSetFolderChannel,
  locationSetFolderChannel,
  assetSetFolderChannel,
] as const;

// =========================================================================
// ProcessPrompt (4 channels)
// =========================================================================

// -- processPrompt:list ---------------------------------------------------
const ProcessPromptListRequest = z.object({}).strict();
const ProcessPromptListResponse = z.array(z.unknown());
export const processPromptListChannel = defineInvokeChannel({
  channel: 'processPrompt:list',
  request: ProcessPromptListRequest,
  response: ProcessPromptListResponse,
});
export type ProcessPromptListRequest = z.infer<typeof ProcessPromptListRequest>;
export type ProcessPromptListResponse = z.infer<typeof ProcessPromptListResponse>;

// -- processPrompt:get ----------------------------------------------------
const ProcessPromptGetRequest = z.object({ processKey: z.string() });
const ProcessPromptGetResponse = z.unknown();
export const processPromptGetChannel = defineInvokeChannel({
  channel: 'processPrompt:get',
  request: ProcessPromptGetRequest,
  response: ProcessPromptGetResponse,
});
export type ProcessPromptGetRequest = z.infer<typeof ProcessPromptGetRequest>;
export type ProcessPromptGetResponse = z.infer<typeof ProcessPromptGetResponse>;

// -- processPrompt:setCustom ----------------------------------------------
const ProcessPromptSetCustomRequest = z.object({
  processKey: z.string(),
  value: z.string(),
});
const ProcessPromptSetCustomResponse = z.void();
export const processPromptSetCustomChannel = defineInvokeChannel({
  channel: 'processPrompt:setCustom',
  request: ProcessPromptSetCustomRequest,
  response: ProcessPromptSetCustomResponse,
});
export type ProcessPromptSetCustomRequest = z.infer<typeof ProcessPromptSetCustomRequest>;
export type ProcessPromptSetCustomResponse = z.infer<typeof ProcessPromptSetCustomResponse>;

// -- processPrompt:reset --------------------------------------------------
const ProcessPromptResetRequest = z.object({ processKey: z.string() });
const ProcessPromptResetResponse = z.void();
export const processPromptResetChannel = defineInvokeChannel({
  channel: 'processPrompt:reset',
  request: ProcessPromptResetRequest,
  response: ProcessPromptResetResponse,
});
export type ProcessPromptResetRequest = z.infer<typeof ProcessPromptResetRequest>;
export type ProcessPromptResetResponse = z.infer<typeof ProcessPromptResetResponse>;

export const processPromptChannels = [
  processPromptListChannel,
  processPromptGetChannel,
  processPromptSetCustomChannel,
  processPromptResetChannel,
] as const;
