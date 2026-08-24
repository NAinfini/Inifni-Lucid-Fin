/**
 * location + style + entity + colorStyle channels — Batch 3.
 *
 * Covers the remaining location, style, and color-style invoke channels. Complex DTO
 * payloads (Location, StyleGuide, ColorStyle, ReferenceImage) stay as
 * `z.unknown()` — Phase C will zodify the DTOs once they move out of
 * `packages/contracts/src/dto/`.
 *
 * `style:load` historically accepted a `void` request; per batch-02 precedent
 * we collapse to `z.object({}).strict()` so callers can always pass `{}`.
 * `location:list` allows an optional `type` filter (batch-02 `equipment:list`
 * precedent).
 */
import { z } from 'zod';
import { defineInvokeChannel } from '../../channels.js';

// ── Shared primitives ────────────────────────────────────────
const EmptyRequest = z.object({}).strict();
const LocationShape = z.unknown();
const StyleGuideShape = z.unknown();
const ColorStyleShape = z.unknown();
const ReferenceImageShape = z.unknown();
const NonEmptyIds = z.array(z.string().trim().min(1)).min(1);

// ── location:list ────────────────────────────────────────────
const LocationListRequest = z.object({ type: z.string().optional() }).strict();
const LocationListResponse = z.array(LocationShape);
export const locationListChannel = defineInvokeChannel({
  channel: 'location:list',
  request: LocationListRequest,
  response: LocationListResponse,
});
export type LocationListRequest = z.infer<typeof LocationListRequest>;
export type LocationListResponse = z.infer<typeof LocationListResponse>;

// ── location:get ─────────────────────────────────────────────
const LocationGetRequest = z.object({ id: z.string() });
const LocationGetResponse = LocationShape;
export const locationGetChannel = defineInvokeChannel({
  channel: 'location:get',
  request: LocationGetRequest,
  response: LocationGetResponse,
});
export type LocationGetRequest = z.infer<typeof LocationGetRequest>;
export type LocationGetResponse = z.infer<typeof LocationGetResponse>;

// ── location:save ────────────────────────────────────────────
const LocationSaveRequest = LocationShape;
const LocationSaveResponse = LocationShape;
export const locationSaveChannel = defineInvokeChannel({
  channel: 'location:save',
  request: LocationSaveRequest,
  response: LocationSaveResponse,
});
export type LocationSaveRequest = z.infer<typeof LocationSaveRequest>;
export type LocationSaveResponse = z.infer<typeof LocationSaveResponse>;

const LocationCopyRequest = z
  .object({
    ids: NonEmptyIds,
    targetFolderId: z.string().trim().min(1).nullable(),
  })
  .strict();
const LocationCopyResponse = z.object({ created: z.array(LocationShape) }).strict();
export const locationCopyChannel = defineInvokeChannel({
  channel: 'location:copy',
  request: LocationCopyRequest,
  response: LocationCopyResponse,
});
export type LocationCopyRequest = z.infer<typeof LocationCopyRequest>;
export type LocationCopyResponse = z.infer<typeof LocationCopyResponse>;

// ── location:delete ──────────────────────────────────────────
const LocationDeleteRequest = z.object({ ids: NonEmptyIds }).strict();
const LocationDeleteResponse = z.object({ deletedIds: z.array(z.string()) }).strict();
export const locationDeleteChannel = defineInvokeChannel({
  channel: 'location:delete',
  request: LocationDeleteRequest,
  response: LocationDeleteResponse,
});
export type LocationDeleteRequest = z.infer<typeof LocationDeleteRequest>;
export type LocationDeleteResponse = z.infer<typeof LocationDeleteResponse>;

// ── location:setRefImage ─────────────────────────────────────
const LocationSetRefImageRequest = z.object({
  locationId: z.string(),
  slot: z.string(),
  assetHash: z.string(),
  isStandard: z.boolean(),
});
const LocationSetRefImageResponse = ReferenceImageShape;
export const locationSetRefImageChannel = defineInvokeChannel({
  channel: 'location:setRefImage',
  request: LocationSetRefImageRequest,
  response: LocationSetRefImageResponse,
});
export type LocationSetRefImageRequest = z.infer<typeof LocationSetRefImageRequest>;
export type LocationSetRefImageResponse = z.infer<typeof LocationSetRefImageResponse>;

// ── location:removeRefImage ──────────────────────────────────
const LocationRemoveRefImageRequest = z.object({
  locationId: z.string(),
  slot: z.string(),
});
const LocationRemoveRefImageResponse = z.void();
export const locationRemoveRefImageChannel = defineInvokeChannel({
  channel: 'location:removeRefImage',
  request: LocationRemoveRefImageRequest,
  response: LocationRemoveRefImageResponse,
});
export type LocationRemoveRefImageRequest = z.infer<typeof LocationRemoveRefImageRequest>;
export type LocationRemoveRefImageResponse = z.infer<typeof LocationRemoveRefImageResponse>;

// ── style:save ───────────────────────────────────────────────
const StyleSaveRequest = StyleGuideShape;
const StyleSaveResponse = z.void();
export const styleSaveChannel = defineInvokeChannel({
  channel: 'style:save',
  request: StyleSaveRequest,
  response: StyleSaveResponse,
});
export type StyleSaveRequest = z.infer<typeof StyleSaveRequest>;
export type StyleSaveResponse = z.infer<typeof StyleSaveResponse>;

// ── style:load ───────────────────────────────────────────────
const StyleLoadRequest = EmptyRequest;
const StyleLoadResponse = StyleGuideShape;
export const styleLoadChannel = defineInvokeChannel({
  channel: 'style:load',
  request: StyleLoadRequest,
  response: StyleLoadResponse,
});
export type StyleLoadRequest = z.infer<typeof StyleLoadRequest>;
export type StyleLoadResponse = z.infer<typeof StyleLoadResponse>;

// ── colorStyle:list ──────────────────────────────────────────
const ColorStyleListRequest = EmptyRequest;
const ColorStyleListResponse = z.array(ColorStyleShape);
export const colorStyleListChannel = defineInvokeChannel({
  channel: 'colorStyle:list',
  request: ColorStyleListRequest,
  response: ColorStyleListResponse,
});
export type ColorStyleListRequest = z.infer<typeof ColorStyleListRequest>;
export type ColorStyleListResponse = z.infer<typeof ColorStyleListResponse>;

// ── colorStyle:save ──────────────────────────────────────────
const ColorStyleSaveRequest = ColorStyleShape;
const ColorStyleSaveResponse = ColorStyleShape;
export const colorStyleSaveChannel = defineInvokeChannel({
  channel: 'colorStyle:save',
  request: ColorStyleSaveRequest,
  response: ColorStyleSaveResponse,
});
export type ColorStyleSaveRequest = z.infer<typeof ColorStyleSaveRequest>;
export type ColorStyleSaveResponse = z.infer<typeof ColorStyleSaveResponse>;

// ── colorStyle:delete ────────────────────────────────────────
const ColorStyleDeleteRequest = z.object({ id: z.string() });
const ColorStyleDeleteResponse = z.void();
export const colorStyleDeleteChannel = defineInvokeChannel({
  channel: 'colorStyle:delete',
  request: ColorStyleDeleteRequest,
  response: ColorStyleDeleteResponse,
});
export type ColorStyleDeleteRequest = z.infer<typeof ColorStyleDeleteRequest>;
export type ColorStyleDeleteResponse = z.infer<typeof ColorStyleDeleteResponse>;

// ── colorStyle:extract ───────────────────────────────────────
const ColorStyleExtractRequest = z.object({
  assetHash: z.string(),
  assetType: z.enum(['image', 'video']),
});
const ColorStyleExtractResponse = z.object({
  taskListId: z.string(),
});
export const colorStyleExtractChannel = defineInvokeChannel({
  channel: 'colorStyle:extract',
  request: ColorStyleExtractRequest,
  response: ColorStyleExtractResponse,
});
export type ColorStyleExtractRequest = z.infer<typeof ColorStyleExtractRequest>;
export type ColorStyleExtractResponse = z.infer<typeof ColorStyleExtractResponse>;

export const locationChannels = [
  locationListChannel,
  locationGetChannel,
  locationSaveChannel,
  locationCopyChannel,
  locationDeleteChannel,
  locationSetRefImageChannel,
  locationRemoveRefImageChannel,
] as const;

export const styleChannels = [styleSaveChannel, styleLoadChannel] as const;

export const colorStyleChannels = [
  colorStyleListChannel,
  colorStyleSaveChannel,
  colorStyleDeleteChannel,
  colorStyleExtractChannel,
] as const;
