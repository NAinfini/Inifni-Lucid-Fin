import { randomBytes } from 'node:crypto';
import { ReadableStream } from 'node:stream/web';
import {
  MediaPreviewCapabilityGrantV1Schema,
  MediaPreviewIssueInputV1Schema,
  OpaqueCapabilityTokenV1Schema,
  parseCanonical,
  type MediaPreviewCapabilityGrantV1,
  type MediaPreviewIssueInputV1,
} from '@lucid-fin/contracts';
import {
  StorageError,
  type MediaCasByteRange,
  type MediaPreviewSource,
  type MediaPreviewSourceResolver,
} from '@lucid-fin/storage';

export const LUCID_FIN_MEDIA_PREVIEW_PROTOCOL_SCHEME = 'lucid-fin-media' as const;
const PREVIEW_URL_HOST = 'preview';
const DEFAULT_CAPABILITY_LIFETIME_MS = 5 * 60 * 1_000;
const MAX_CAPABILITIES = 1_000;

export interface MediaPreviewProtocolRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Pick<Headers, 'get'>;
}

export interface MediaPreviewProtocol {
  handle(
    scheme: string,
    handler: (request: MediaPreviewProtocolRequest) => Response | Promise<Response>,
  ): void;
  unhandle(scheme: string): void;
}

export interface MediaPreviewSchemeRegistrar {
  registerSchemesAsPrivileged(
    schemes: readonly {
      readonly scheme: string;
      readonly privileges: {
        readonly standard: true;
        readonly secure: true;
        readonly supportFetchAPI: true;
        readonly stream: true;
      };
    }[],
  ): void;
}

export const LUCID_FIN_MEDIA_PREVIEW_SCHEME_REGISTRATION = Object.freeze([
  Object.freeze({
    scheme: LUCID_FIN_MEDIA_PREVIEW_PROTOCOL_SCHEME,
    privileges: Object.freeze({
      standard: true as const,
      secure: true as const,
      supportFetchAPI: true as const,
      stream: true as const,
    }),
  }),
]);

export function registerMediaPreviewScheme(registrar: MediaPreviewSchemeRegistrar): void {
  registrar.registerSchemesAsPrivileged(LUCID_FIN_MEDIA_PREVIEW_SCHEME_REGISTRATION);
}

interface MediaPreviewCapability {
  readonly input: MediaPreviewIssueInputV1;
  readonly expiresAt: number;
}

export interface MediaPreviewCapabilityGateway {
  issue(input: MediaPreviewIssueInputV1): MediaPreviewCapabilityGrantV1;
  respond(request: MediaPreviewProtocolRequest): Promise<Response>;
  close(): void;
}

export interface MediaPreviewCapabilityGatewayOptions {
  readonly sourceResolver: MediaPreviewSourceResolver;
  readonly now?: () => Date;
  readonly createToken?: () => string;
  readonly onInternalError?: (cause: unknown) => void;
}

function defaultToken(): string {
  return `cap_${randomBytes(32).toString('base64url')}`;
}

function missingResponse(): Response {
  return new Response(null, { status: 404, headers: { 'Content-Length': '0' } });
}

function internalFailureResponse(): Response {
  return new Response(null, { status: 500, headers: { 'Content-Length': '0' } });
}

function methodNotAllowedResponse(): Response {
  return new Response(null, {
    status: 405,
    headers: { Allow: 'GET, HEAD', 'Content-Length': '0' },
  });
}

function rangeNotSatisfiableResponse(byteLength: number): Response {
  return new Response(null, {
    status: 416,
    headers: { 'Content-Length': '0', 'Content-Range': `bytes */${byteLength}` },
  });
}

function tokenFromPreviewUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== `${LUCID_FIN_MEDIA_PREVIEW_PROTOCOL_SCHEME}:` ||
      url.hostname !== PREVIEW_URL_HOST ||
      url.port !== '' ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return null;
    }
    const match = /^\/(cap_[A-Za-z0-9_-]+)$/u.exec(url.pathname);
    return match === null ? null : match[1]!;
  } catch {
    return null;
  }
}

function readHeader(request: MediaPreviewProtocolRequest, name: string): string | null {
  return request.headers.get(name) ?? request.headers.get(name[0]!.toUpperCase() + name.slice(1));
}

function parseSafeDecimal(value: string): number | null {
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

type RangeParse =
  | { readonly kind: 'full' }
  | { readonly kind: 'range'; readonly range: MediaCasByteRange }
  | { readonly kind: 'invalid' };

function parseRange(value: string | null, byteLength: number): RangeParse {
  if (value === null) return { kind: 'full' };
  if (byteLength === 0 || value.includes(',')) return { kind: 'invalid' };
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value.trim());
  if (match === null) return { kind: 'invalid' };
  const [, startValue, endValue] = match;
  if (startValue === '' && endValue === '') return { kind: 'invalid' };

  if (startValue === '') {
    const suffixLength = parseSafeDecimal(endValue!);
    if (suffixLength === null || suffixLength === 0) return { kind: 'invalid' };
    return {
      kind: 'range',
      range: { start: Math.max(byteLength - suffixLength, 0), end: byteLength - 1 },
    };
  }

  const start = parseSafeDecimal(startValue);
  if (start === null || start >= byteLength) return { kind: 'invalid' };
  if (endValue === '') return { kind: 'range', range: { start, end: byteLength - 1 } };
  const requestedEnd = parseSafeDecimal(endValue);
  if (requestedEnd === null || requestedEnd < start) return { kind: 'invalid' };
  return { kind: 'range', range: { start, end: Math.min(requestedEnd, byteLength - 1) } };
}

function responseHeaders(source: MediaPreviewSource, range: RangeParse): Record<string, string> {
  const mime = /^(image|video|audio)\/[a-z0-9!#$&^_.+-]+$/u.exec(source.mimeType);
  if (mime === null || mime[1] !== source.kind) {
    throw new StorageError('CORRUPT_DATA', 'Media preview MIME type is invalid');
  }
  const headers: Record<string, string> = {
    'Accept-Ranges': 'bytes',
    'Content-Type': source.mimeType,
  };
  if (range.kind === 'full') {
    headers['Content-Length'] = String(source.byteLength);
  } else if (range.kind === 'range') {
    headers['Content-Length'] = String(range.range.end - range.range.start + 1);
    headers['Content-Range'] = `bytes ${range.range.start}-${range.range.end}/${source.byteLength}`;
  }
  return headers;
}

async function responseBody(
  bytes: AsyncIterable<Uint8Array>,
  expectedByteLength: number,
): Promise<ReadableStream<Uint8Array>> {
  const iterator = bytes[Symbol.asyncIterator]();
  let first: IteratorResult<Uint8Array>;
  try {
    first = await iterator.next();
  } catch (cause) {
    await iterator.return?.();
    throw cause;
  }
  if (first.done || first.value.byteLength === 0) {
    await iterator.return?.();
    throw new StorageError(
      'CORRUPT_DATA',
      `Media preview source ended before its ${expectedByteLength} expected bytes`,
    );
  }

  let nextValue: Uint8Array | null = first.value;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (nextValue !== null) {
          controller.enqueue(nextValue);
          nextValue = null;
          return;
        }
        const next = await iterator.next();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (cause) {
        controller.error(cause);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

function responseForSourceError(
  cause: unknown,
  onInternalError: ((cause: unknown) => void) | undefined,
): Response {
  if (
    cause instanceof StorageError &&
    (cause.code === 'NOT_FOUND' || cause.code === 'INVALID_REQUEST')
  ) {
    return missingResponse();
  }
  onInternalError?.(cause);
  return internalFailureResponse();
}

export function createMediaPreviewCapabilityGateway(
  options: MediaPreviewCapabilityGatewayOptions,
): MediaPreviewCapabilityGateway {
  const capabilities = new Map<string, MediaPreviewCapability>();
  const now = options.now ?? (() => new Date());
  const createToken = options.createToken ?? defaultToken;
  let closed = false;

  const pruneExpired = (current: number) => {
    for (const [token, capability] of capabilities) {
      if (capability.expiresAt <= current) capabilities.delete(token);
    }
  };
  const makeToken = () => {
    for (let attempts = 0; attempts < 10; attempts += 1) {
      const token = parseCanonical(OpaqueCapabilityTokenV1Schema, createToken());
      if (!capabilities.has(token)) return token;
    }
    throw new Error('Media preview capability token generation collided repeatedly');
  };

  return Object.freeze({
    issue(inputValue: MediaPreviewIssueInputV1) {
      if (closed) throw new Error('Media preview capability gateway is closed');
      const input = parseCanonical(MediaPreviewIssueInputV1Schema, inputValue);
      const source = options.sourceResolver.resolve(input);
      const issuedAt = now().getTime();
      if (!Number.isFinite(issuedAt)) throw new Error('Media preview capability clock is invalid');
      pruneExpired(issuedAt);
      if (capabilities.size >= MAX_CAPABILITIES)
        capabilities.delete(capabilities.keys().next().value!);
      const token = makeToken();
      const expiresAt = issuedAt + DEFAULT_CAPABILITY_LIFETIME_MS;
      capabilities.set(token, Object.freeze({ input, expiresAt }));
      return parseCanonical(MediaPreviewCapabilityGrantV1Schema, {
        url: `${LUCID_FIN_MEDIA_PREVIEW_PROTOCOL_SCHEME}://${PREVIEW_URL_HOST}/${token}`,
        expiresAt: new Date(expiresAt).toISOString(),
        kind: source.kind,
        mimeType: source.mimeType,
      });
    },

    async respond(request: MediaPreviewProtocolRequest) {
      if (closed) return missingResponse();
      const method = request.method.toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return methodNotAllowedResponse();
      const token = tokenFromPreviewUrl(request.url);
      if (token === null) return missingResponse();
      const current = now().getTime();
      if (!Number.isFinite(current)) return internalFailureResponse();
      pruneExpired(current);
      const capability = capabilities.get(token);
      if (capability === undefined) return missingResponse();

      let source: MediaPreviewSource;
      try {
        source = options.sourceResolver.resolve(capability.input);
        if (method === 'HEAD') await source.verify();
      } catch (cause) {
        return responseForSourceError(cause, options.onInternalError);
      }
      const range = parseRange(readHeader(request, 'range'), source.byteLength);
      if (range.kind === 'invalid') return rangeNotSatisfiableResponse(source.byteLength);

      try {
        const headers = responseHeaders(source, range);
        if (method === 'HEAD') {
          return new Response(null, { status: range.kind === 'range' ? 206 : 200, headers });
        }
        if (source.byteLength === 0) {
          await source.verify();
          return new Response(null, { status: range.kind === 'range' ? 206 : 200, headers });
        }
        const bodyRange =
          range.kind === 'range'
            ? range.range
            : ({ start: 0, end: source.byteLength - 1 } satisfies MediaCasByteRange);
        return new Response(
          await responseBody(source.open(bodyRange), bodyRange.end - bodyRange.start + 1),
          {
            status: range.kind === 'range' ? 206 : 200,
            headers,
          },
        );
      } catch (cause) {
        return responseForSourceError(cause, options.onInternalError);
      }
    },

    close() {
      if (closed) return;
      closed = true;
      capabilities.clear();
    },
  });
}

export function installMediaPreviewProtocol(
  protocol: MediaPreviewProtocol,
  gateway: MediaPreviewCapabilityGateway,
): () => void {
  protocol.handle(LUCID_FIN_MEDIA_PREVIEW_PROTOCOL_SCHEME, (request) => gateway.respond(request));
  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    protocol.unhandle(LUCID_FIN_MEDIA_PREVIEW_PROTOCOL_SCHEME);
  };
}
