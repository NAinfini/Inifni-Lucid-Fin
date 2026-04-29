import { z, type ZodType } from 'zod';
import type { InvokeChannelType, PushChannelType, ReplyChannelType } from '@lucid-fin/contracts';

/**
 * Runtime schema bundle stored on each channel definition. Codegen and the
 * handler registrar use `.schemas` for parse/emit; the pure-type shape
 * (`InvokeChannelType` etc.) is what downstream TS consumers see.
 */
export interface InvokeChannelDef<
  Channel extends string = string,
  Req = unknown,
  Res = unknown,
  Evt = never,
> extends InvokeChannelType<Channel, Req, Res, Evt> {
  readonly schemas: {
    readonly request: ZodType<Req>;
    readonly response: ZodType<Res>;
    readonly event: ZodType<Evt>;
  };
}

export interface PushChannelDef<
  Channel extends string = string,
  Payload = unknown,
> extends PushChannelType<Channel, Payload> {
  readonly schemas: {
    readonly payload: ZodType<Payload>;
  };
}

export interface ReplyChannelDef<
  Channel extends string = string,
  Req = unknown,
  Res = unknown,
> extends ReplyChannelType<Channel, Req, Res> {
  readonly schemas: {
    readonly request: ZodType<Req>;
    readonly response: ZodType<Res>;
  };
}

// ── Factory functions ──────────────────────────────────────────

export function defineInvokeChannel<Channel extends string, Req, Res, Evt = never>(config: {
  channel: Channel;
  cancellable?: boolean;
  request: ZodType<Req>;
  response: ZodType<Res>;
  events?: ZodType<Evt>;
}): InvokeChannelDef<Channel, Req, Res, Evt> {
  return {
    kind: 'invoke',
    channel: config.channel,
    cancellable: config.cancellable ?? false,
    schemas: {
      request: config.request,
      response: config.response,
      event: (config.events ?? z.never()) as ZodType<Evt>,
    },
    _types: undefined as never,
  };
}

export function definePushChannel<Channel extends string, Payload>(config: {
  channel: Channel;
  payload: ZodType<Payload>;
}): PushChannelDef<Channel, Payload> {
  return {
    kind: 'push',
    channel: config.channel,
    schemas: { payload: config.payload },
    _types: undefined as never,
  };
}

export function defineReplyChannel<Channel extends string, Req, Res>(config: {
  channel: Channel;
  request: ZodType<Req>;
  response: ZodType<Res>;
}): ReplyChannelDef<Channel, Req, Res> {
  return {
    kind: 'reply',
    channel: config.channel,
    schemas: { request: config.request, response: config.response },
    _types: undefined as never,
  };
}
