/**
 * series:* channels -- Batch 11.
 *
 * Covers the 7 invoke handlers in
 * `apps/desktop-main/src/ipc/handlers/series.handlers.ts`.
 *
 * Complex DTOs (Series, Episode) stay `z.unknown()` -- Phase C will zodify
 * them once the DTOs move into contract ownership.
 */
import { z } from 'zod';
import { defineInvokeChannel } from '../../channels.js';

// -- series:get (invoke) --------------------------------------------------
const SeriesGetRequest = z.object({ id: z.string().optional() }).strict();
const SeriesGetResponse = z.unknown().nullable();
export const seriesGetChannel = defineInvokeChannel({
  channel: 'series:get',
  request: SeriesGetRequest,
  response: SeriesGetResponse,
});
export type SeriesGetRequest = z.infer<typeof SeriesGetRequest>;
export type SeriesGetResponse = z.infer<typeof SeriesGetResponse>;

// -- series:save (invoke) -------------------------------------------------
const SeriesSaveRequest = z.unknown();
const SeriesSaveResponse = z.unknown();
export const seriesSaveChannel = defineInvokeChannel({
  channel: 'series:save',
  request: SeriesSaveRequest,
  response: SeriesSaveResponse,
});
export type SeriesSaveRequest = z.infer<typeof SeriesSaveRequest>;
export type SeriesSaveResponse = z.infer<typeof SeriesSaveResponse>;

// -- series:delete (invoke) -----------------------------------------------
const SeriesDeleteRequest = z.object({ id: z.string().optional() }).strict();
const SeriesDeleteResponse = z.void();
export const seriesDeleteChannel = defineInvokeChannel({
  channel: 'series:delete',
  request: SeriesDeleteRequest,
  response: SeriesDeleteResponse,
});
export type SeriesDeleteRequest = z.infer<typeof SeriesDeleteRequest>;
export type SeriesDeleteResponse = z.infer<typeof SeriesDeleteResponse>;

// -- series:episodes:list (invoke) ----------------------------------------
const SeriesEpisodesListRequest = z.object({ seriesId: z.string().optional() }).strict();
const SeriesEpisodesListResponse = z.array(z.unknown());
export const seriesEpisodesListChannel = defineInvokeChannel({
  channel: 'series:episodes:list',
  request: SeriesEpisodesListRequest,
  response: SeriesEpisodesListResponse,
});
export type SeriesEpisodesListRequest = z.infer<typeof SeriesEpisodesListRequest>;
export type SeriesEpisodesListResponse = z.infer<typeof SeriesEpisodesListResponse>;

// -- series:episodes:add (invoke) -----------------------------------------
const SeriesEpisodesAddRequest = z.unknown();
const SeriesEpisodesAddResponse = z.unknown();
export const seriesEpisodesAddChannel = defineInvokeChannel({
  channel: 'series:episodes:add',
  request: SeriesEpisodesAddRequest,
  response: SeriesEpisodesAddResponse,
});
export type SeriesEpisodesAddRequest = z.infer<typeof SeriesEpisodesAddRequest>;
export type SeriesEpisodesAddResponse = z.infer<typeof SeriesEpisodesAddResponse>;

// -- series:episodes:remove (invoke) --------------------------------------
const SeriesEpisodesRemoveRequest = z.object({ id: z.string() });
const SeriesEpisodesRemoveResponse = z.void();
export const seriesEpisodesRemoveChannel = defineInvokeChannel({
  channel: 'series:episodes:remove',
  request: SeriesEpisodesRemoveRequest,
  response: SeriesEpisodesRemoveResponse,
});
export type SeriesEpisodesRemoveRequest = z.infer<typeof SeriesEpisodesRemoveRequest>;
export type SeriesEpisodesRemoveResponse = z.infer<typeof SeriesEpisodesRemoveResponse>;

// -- series:episodes:reorder (invoke) -------------------------------------
const SeriesEpisodesReorderRequest = z.object({
  seriesId: z.string(),
  ids: z.array(z.string()),
});
const SeriesEpisodesReorderResponse = z.void();
export const seriesEpisodesReorderChannel = defineInvokeChannel({
  channel: 'series:episodes:reorder',
  request: SeriesEpisodesReorderRequest,
  response: SeriesEpisodesReorderResponse,
});
export type SeriesEpisodesReorderRequest = z.infer<typeof SeriesEpisodesReorderRequest>;
export type SeriesEpisodesReorderResponse = z.infer<typeof SeriesEpisodesReorderResponse>;

export const seriesChannels = [
  seriesGetChannel,
  seriesSaveChannel,
  seriesDeleteChannel,
  seriesEpisodesListChannel,
  seriesEpisodesAddChannel,
  seriesEpisodesRemoveChannel,
  seriesEpisodesReorderChannel,
] as const;
