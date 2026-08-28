import { describe, expect, it, vi } from 'vitest';
import { StorageError, type MediaCasByteRange, type MediaPreviewSource } from '@lucid-fin/storage';
import {
  LUCID_FIN_MEDIA_PREVIEW_PROTOCOL_SCHEME,
  createMediaPreviewCapabilityGateway,
  installMediaPreviewProtocol,
  registerMediaPreviewScheme,
  type MediaPreviewProtocolRequest,
} from './media-preview.js';

const input = {
  projectId: 'project.preview.1',
  source: {
    kind: 'project_media_ref' as const,
    ref: {
      authority: 'project_media_ref' as const,
      id: 'media.preview.1',
      revision: 0,
      contentHash: 'a'.repeat(64),
    },
  },
};

function source(
  bytes = Buffer.from('0123456789'),
  behavior: {
    readonly verify?: () => Promise<void>;
    readonly verifyBeforeOpen?: () => Promise<void>;
  } = {},
) {
  const verify = vi.fn(behavior.verify ?? (async () => undefined));
  const verifyBeforeOpen = vi.fn(behavior.verifyBeforeOpen ?? (async () => undefined));
  const open = vi.fn(({ start, end }: MediaCasByteRange) => ({
    async *[Symbol.asyncIterator]() {
      await verifyBeforeOpen();
      yield Uint8Array.from(bytes.subarray(start, end + 1));
    },
  }));
  return {
    kind: 'video',
    mimeType: 'video/mp4',
    byteLength: bytes.byteLength,
    verify,
    open,
  } satisfies MediaPreviewSource;
}

function request(
  url: string,
  method = 'GET',
  range: string | null = null,
): MediaPreviewProtocolRequest {
  return {
    url,
    method,
    headers: new Headers(range === null ? undefined : { Range: range }),
  };
}

describe('media preview capabilities', () => {
  it('issues opaque URLs and serves verified GET, HEAD, and a single byte range', async () => {
    const verifyBeforeOpen = vi.fn(async () => undefined);
    const preview = source(undefined, { verifyBeforeOpen });
    const resolver = { resolve: vi.fn(() => preview) };
    const gateway = createMediaPreviewCapabilityGateway({
      sourceResolver: resolver,
      now: () => new Date('2026-08-25T12:00:00.000Z'),
      createToken: () => 'cap_preview_capability_1234567890',
    });
    const grant = gateway.issue(input);

    expect(grant).toEqual({
      url: 'lucid-fin-media://preview/cap_preview_capability_1234567890',
      expiresAt: '2026-08-25T12:05:00.000Z',
      kind: 'video',
      mimeType: 'video/mp4',
    });
    expect(JSON.stringify(grant)).not.toMatch(/C:\\|\/Users\/|[a-f0-9]{64}/iu);

    const full = await gateway.respond(request(grant.url));
    expect(full.status).toBe(200);
    expect(full.headers.get('Content-Type')).toBe('video/mp4');
    expect(full.headers.get('Content-Length')).toBe('10');
    expect(full.headers.get('Accept-Ranges')).toBe('bytes');
    await expect(full.text()).resolves.toBe('0123456789');

    const head = await gateway.respond(request(grant.url, 'HEAD'));
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Length')).toBe('10');
    await expect(head.arrayBuffer()).resolves.toHaveProperty('byteLength', 0);

    const rangedHead = await gateway.respond(request(grant.url, 'HEAD', 'bytes=-3'));
    expect(rangedHead.status).toBe(206);
    expect(rangedHead.headers.get('Content-Range')).toBe('bytes 7-9/10');
    expect(rangedHead.headers.get('Content-Length')).toBe('3');
    await expect(rangedHead.arrayBuffer()).resolves.toHaveProperty('byteLength', 0);

    const partial = await gateway.respond(request(grant.url, 'GET', 'bytes=2-5'));
    expect(partial.status).toBe(206);
    expect(partial.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(partial.headers.get('Content-Length')).toBe('4');
    await expect(partial.text()).resolves.toBe('2345');
    expect(preview.verify).toHaveBeenCalledTimes(2);
    expect(verifyBeforeOpen).toHaveBeenCalledTimes(2);
  });

  it('rejects forged, expired, multi-range, and malformed capability requests without leaking state', async () => {
    let current = new Date('2026-08-25T12:00:00.000Z');
    const gateway = createMediaPreviewCapabilityGateway({
      sourceResolver: { resolve: () => source() },
      now: () => current,
      createToken: () => 'cap_preview_expiry_token_1234567890',
    });
    const grant = gateway.issue(input);

    expect(
      (await gateway.respond(request('lucid-fin-media://preview/cap_forged_token_1234567890')))
        .status,
    ).toBe(404);
    expect((await gateway.respond(request(grant.url, 'GET', 'bytes=0-1,3-4'))).status).toBe(416);
    expect((await gateway.respond(request(grant.url, 'GET', 'bytes=99-100'))).status).toBe(416);
    expect((await gateway.respond(request(grant.url, 'POST'))).status).toBe(405);

    current = new Date('2026-08-25T12:05:00.000Z');
    expect((await gateway.respond(request(grant.url))).status).toBe(404);
  });

  it('returns a sanitized failure when access-time CAS integrity verification fails and clears on close', async () => {
    const internal = vi.fn();
    const verifyBeforeOpen = vi.fn(async () => {
      throw new StorageError('CORRUPT_DATA', 'C:\\private\\cas\\secret.mp4');
    });
    const corrupted = source(undefined, { verifyBeforeOpen });
    const gateway = createMediaPreviewCapabilityGateway({
      sourceResolver: { resolve: () => corrupted },
      createToken: () => 'cap_preview_integrity_token_1234567890',
      onInternalError: internal,
    });
    const grant = gateway.issue(input);
    const failure = await gateway.respond(request(grant.url));
    expect(failure.status).toBe(500);
    await expect(failure.text()).resolves.toBe('');
    expect(internal).toHaveBeenCalledOnce();
    expect(corrupted.verify).not.toHaveBeenCalled();
    expect(verifyBeforeOpen).toHaveBeenCalledOnce();

    gateway.close();
    expect((await gateway.respond(request(grant.url))).status).toBe(404);
  });

  it('registers the one privileged scheme and precisely removes only its installed handler', () => {
    const registerSchemesAsPrivileged = vi.fn();
    registerMediaPreviewScheme({ registerSchemesAsPrivileged });
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: LUCID_FIN_MEDIA_PREVIEW_PROTOCOL_SCHEME,
        privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
      },
    ]);

    const protocol = { handle: vi.fn(), unhandle: vi.fn() };
    const gateway = createMediaPreviewCapabilityGateway({
      sourceResolver: { resolve: () => source() },
    });
    const dispose = installMediaPreviewProtocol(protocol, gateway);
    expect(protocol.handle).toHaveBeenCalledWith(
      LUCID_FIN_MEDIA_PREVIEW_PROTOCOL_SCHEME,
      expect.any(Function),
    );
    dispose();
    dispose();
    expect(protocol.unhandle).toHaveBeenCalledTimes(1);
    expect(protocol.unhandle).toHaveBeenCalledWith(LUCID_FIN_MEDIA_PREVIEW_PROTOCOL_SCHEME);
  });
});
