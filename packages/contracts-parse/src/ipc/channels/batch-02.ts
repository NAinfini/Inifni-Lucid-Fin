/**
 * character + equipment channels — Batch 2.
 *
 * Covers the 14 character:* and equipment:* invoke channels lifted from the
 * legacy IpcChannelMap. Complex DTO payloads (Character, Equipment,
 * ReferenceImage, EquipmentLoadout) stay as `z.unknown()` at this stage —
 * Phase C will zodify the DTOs once they move out of `packages/contracts/src/dto/`.
 *
 * Void-valued channels use `z.object({}).strict()` for the request (matching the
 * batch-01 convention for `settings:load` / `script:load`) so callers can always
 * pass `{}` regardless of the historic `void` shape in IpcChannelMap.
 */
import { z } from 'zod';
import { defineInvokeChannel } from '../../channels.js';

// ── Shared primitives ────────────────────────────────────────
const EmptyRequest = z.object({}).strict();
const CharacterShape = z.unknown();
const EquipmentShape = z.unknown();
const ReferenceImageShape = z.unknown();
const EquipmentLoadoutShape = z.unknown();

// ── character:list ───────────────────────────────────────────
const CharacterListRequest = EmptyRequest;
const CharacterListResponse = z.array(CharacterShape);
export const characterListChannel = defineInvokeChannel({
  channel: 'character:list',
  request: CharacterListRequest,
  response: CharacterListResponse,
});
export type CharacterListRequest = z.infer<typeof CharacterListRequest>;
export type CharacterListResponse = z.infer<typeof CharacterListResponse>;

// ── character:get ────────────────────────────────────────────
const CharacterGetRequest = z.object({ id: z.string() });
const CharacterGetResponse = CharacterShape;
export const characterGetChannel = defineInvokeChannel({
  channel: 'character:get',
  request: CharacterGetRequest,
  response: CharacterGetResponse,
});
export type CharacterGetRequest = z.infer<typeof CharacterGetRequest>;
export type CharacterGetResponse = z.infer<typeof CharacterGetResponse>;

// ── character:save ───────────────────────────────────────────
const CharacterSaveRequest = CharacterShape;
const CharacterSaveResponse = CharacterShape;
export const characterSaveChannel = defineInvokeChannel({
  channel: 'character:save',
  request: CharacterSaveRequest,
  response: CharacterSaveResponse,
});
export type CharacterSaveRequest = z.infer<typeof CharacterSaveRequest>;
export type CharacterSaveResponse = z.infer<typeof CharacterSaveResponse>;

// ── character:delete ─────────────────────────────────────────
const CharacterDeleteRequest = z.object({ id: z.string() });
const CharacterDeleteResponse = z.void();
export const characterDeleteChannel = defineInvokeChannel({
  channel: 'character:delete',
  request: CharacterDeleteRequest,
  response: CharacterDeleteResponse,
});
export type CharacterDeleteRequest = z.infer<typeof CharacterDeleteRequest>;
export type CharacterDeleteResponse = z.infer<typeof CharacterDeleteResponse>;

// ── character:setRefImage ────────────────────────────────────
const CharacterSetRefImageRequest = z.object({
  characterId: z.string(),
  slot: z.string(),
  assetHash: z.string(),
  isStandard: z.boolean(),
});
const CharacterSetRefImageResponse = ReferenceImageShape;
export const characterSetRefImageChannel = defineInvokeChannel({
  channel: 'character:setRefImage',
  request: CharacterSetRefImageRequest,
  response: CharacterSetRefImageResponse,
});
export type CharacterSetRefImageRequest = z.infer<typeof CharacterSetRefImageRequest>;
export type CharacterSetRefImageResponse = z.infer<typeof CharacterSetRefImageResponse>;

// ── character:removeRefImage ─────────────────────────────────
const CharacterRemoveRefImageRequest = z.object({
  characterId: z.string(),
  slot: z.string(),
});
const CharacterRemoveRefImageResponse = z.void();
export const characterRemoveRefImageChannel = defineInvokeChannel({
  channel: 'character:removeRefImage',
  request: CharacterRemoveRefImageRequest,
  response: CharacterRemoveRefImageResponse,
});
export type CharacterRemoveRefImageRequest = z.infer<typeof CharacterRemoveRefImageRequest>;
export type CharacterRemoveRefImageResponse = z.infer<typeof CharacterRemoveRefImageResponse>;

// ── character:saveLoadout ────────────────────────────────────
const CharacterSaveLoadoutRequest = z.object({
  characterId: z.string(),
  loadout: EquipmentLoadoutShape,
});
const CharacterSaveLoadoutResponse = EquipmentLoadoutShape;
export const characterSaveLoadoutChannel = defineInvokeChannel({
  channel: 'character:saveLoadout',
  request: CharacterSaveLoadoutRequest,
  response: CharacterSaveLoadoutResponse,
});
export type CharacterSaveLoadoutRequest = z.infer<typeof CharacterSaveLoadoutRequest>;
export type CharacterSaveLoadoutResponse = z.infer<typeof CharacterSaveLoadoutResponse>;

// ── character:deleteLoadout ──────────────────────────────────
const CharacterDeleteLoadoutRequest = z.object({
  characterId: z.string(),
  loadoutId: z.string(),
});
const CharacterDeleteLoadoutResponse = z.void();
export const characterDeleteLoadoutChannel = defineInvokeChannel({
  channel: 'character:deleteLoadout',
  request: CharacterDeleteLoadoutRequest,
  response: CharacterDeleteLoadoutResponse,
});
export type CharacterDeleteLoadoutRequest = z.infer<typeof CharacterDeleteLoadoutRequest>;
export type CharacterDeleteLoadoutResponse = z.infer<typeof CharacterDeleteLoadoutResponse>;

// ── equipment:list ───────────────────────────────────────────
// Request allows optional `type` filter; historical `void` callers pass {}.
const EquipmentListRequest = z.object({ type: z.string().optional() }).strict();
const EquipmentListResponse = z.array(EquipmentShape);
export const equipmentListChannel = defineInvokeChannel({
  channel: 'equipment:list',
  request: EquipmentListRequest,
  response: EquipmentListResponse,
});
export type EquipmentListRequest = z.infer<typeof EquipmentListRequest>;
export type EquipmentListResponse = z.infer<typeof EquipmentListResponse>;

// ── equipment:get ────────────────────────────────────────────
const EquipmentGetRequest = z.object({ id: z.string() });
const EquipmentGetResponse = EquipmentShape;
export const equipmentGetChannel = defineInvokeChannel({
  channel: 'equipment:get',
  request: EquipmentGetRequest,
  response: EquipmentGetResponse,
});
export type EquipmentGetRequest = z.infer<typeof EquipmentGetRequest>;
export type EquipmentGetResponse = z.infer<typeof EquipmentGetResponse>;

// ── equipment:save ───────────────────────────────────────────
const EquipmentSaveRequest = EquipmentShape;
const EquipmentSaveResponse = EquipmentShape;
export const equipmentSaveChannel = defineInvokeChannel({
  channel: 'equipment:save',
  request: EquipmentSaveRequest,
  response: EquipmentSaveResponse,
});
export type EquipmentSaveRequest = z.infer<typeof EquipmentSaveRequest>;
export type EquipmentSaveResponse = z.infer<typeof EquipmentSaveResponse>;

// ── equipment:delete ─────────────────────────────────────────
const EquipmentDeleteRequest = z.object({ id: z.string() });
const EquipmentDeleteResponse = z.void();
export const equipmentDeleteChannel = defineInvokeChannel({
  channel: 'equipment:delete',
  request: EquipmentDeleteRequest,
  response: EquipmentDeleteResponse,
});
export type EquipmentDeleteRequest = z.infer<typeof EquipmentDeleteRequest>;
export type EquipmentDeleteResponse = z.infer<typeof EquipmentDeleteResponse>;

// ── equipment:setRefImage ────────────────────────────────────
const EquipmentSetRefImageRequest = z.object({
  equipmentId: z.string(),
  slot: z.string(),
  assetHash: z.string(),
  isStandard: z.boolean(),
});
const EquipmentSetRefImageResponse = ReferenceImageShape;
export const equipmentSetRefImageChannel = defineInvokeChannel({
  channel: 'equipment:setRefImage',
  request: EquipmentSetRefImageRequest,
  response: EquipmentSetRefImageResponse,
});
export type EquipmentSetRefImageRequest = z.infer<typeof EquipmentSetRefImageRequest>;
export type EquipmentSetRefImageResponse = z.infer<typeof EquipmentSetRefImageResponse>;

// ── equipment:removeRefImage ─────────────────────────────────
const EquipmentRemoveRefImageRequest = z.object({
  equipmentId: z.string(),
  slot: z.string(),
});
const EquipmentRemoveRefImageResponse = z.void();
export const equipmentRemoveRefImageChannel = defineInvokeChannel({
  channel: 'equipment:removeRefImage',
  request: EquipmentRemoveRefImageRequest,
  response: EquipmentRemoveRefImageResponse,
});
export type EquipmentRemoveRefImageRequest = z.infer<typeof EquipmentRemoveRefImageRequest>;
export type EquipmentRemoveRefImageResponse = z.infer<typeof EquipmentRemoveRefImageResponse>;

export const characterChannels = [
  characterListChannel,
  characterGetChannel,
  characterSaveChannel,
  characterDeleteChannel,
  characterSetRefImageChannel,
  characterRemoveRefImageChannel,
  characterSaveLoadoutChannel,
  characterDeleteLoadoutChannel,
] as const;

export const equipmentChannels = [
  equipmentListChannel,
  equipmentGetChannel,
  equipmentSaveChannel,
  equipmentDeleteChannel,
  equipmentSetRefImageChannel,
  equipmentRemoveRefImageChannel,
] as const;
