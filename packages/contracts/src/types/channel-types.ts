/**
 * Pure type shapes for the three IPC channel variants.
 *
 * These types are consumed by:
 * - `contracts-parse` to implement `defineInvokeChannel` / `definePushChannel` / `defineReplyChannel`
 * - codegen (`scripts/gen-preload.ts`) to emit `preload.generated.cts` + `lucid-api.generated.ts`
 * - `RendererPushGateway` (Phase F) to accept typed push channels
 *
 * Zero runtime — no zod imports. The corresponding runtime factories and
 * zod schemas live in `@lucid-fin/contracts-parse`.
 */

/** A typed invoke channel: renderer → main, request/response + optional events. */
export interface InvokeChannelType<
  Channel extends string = string,
  Req = unknown,
  Res = unknown,
  Evt = never,
> {
  readonly kind: 'invoke';
  readonly channel: Channel;
  readonly cancellable: boolean;
  readonly _types: {
    readonly request: Req;
    readonly response: Res;
    readonly event: Evt;
  };
}

/** A typed push channel: main → renderer, one-way. */
export interface PushChannelType<Channel extends string = string, Payload = unknown> {
  readonly kind: 'push';
  readonly channel: Channel;
  readonly _types: {
    readonly payload: Payload;
  };
}

/** A typed reply channel: renderer → main, correlated to a pending prompt. */
export interface ReplyChannelType<Channel extends string = string, Req = unknown, Res = unknown> {
  readonly kind: 'reply';
  readonly channel: Channel;
  readonly _types: {
    readonly request: Req;
    readonly response: Res;
  };
}

export type AnyChannelType = InvokeChannelType | PushChannelType | ReplyChannelType;
