import { describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_WIRE_METHODS_V1,
  LUCID_FIN_WIRE_INVOKE_CHANNEL_V1,
  type PublicWireMethodV1,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/contracts';
import { StorageError, type CommandContext } from '@lucid-fin/storage';
import {
  WireProtocolError,
  WirePublicError,
  createWireRouter,
  registerWireRouter,
  type WireHandlers,
} from './router.js';

const context: CommandContext = {
  actor: 'user',
  causation: { kind: 'direct_ui', actionId: 'action.router.1' },
  correlationId: 'correlation.router.1',
};

function projectListRequest(input: unknown = { cursor: null, limit: 20 }) {
  return {
    wireVersion: 1,
    kind: 'request',
    requestId: 'request.router.project-list.1',
    method: 'project.list',
    input,
  } as const;
}

function projectListSuccess(
  requestId: string,
): Extract<WireSuccessV1, { readonly method: 'project.list' }> {
  return {
    wireVersion: 1,
    kind: 'success',
    requestId,
    method: 'project.list',
    result: { items: [], nextCursor: null },
  };
}

function handlers(
  override: Partial<Record<PublicWireMethodV1, (request: WireRequestV1) => WireSuccessV1>> = {},
): WireHandlers {
  return Object.fromEntries(
    Object.keys(PUBLIC_WIRE_METHODS_V1).map((method) => [
      method,
      override[method as PublicWireMethodV1] ??
        (() => {
          throw new Error(`Unexpected handler call: ${method}`);
        }),
    ]),
  ) as WireHandlers;
}

function routerWith(
  projectList: (request: Extract<WireRequestV1, { method: 'project.list' }>) => WireSuccessV1,
  onInternalError = vi.fn(),
) {
  return {
    onInternalError,
    router: createWireRouter(
      handlers({ 'project.list': projectList as (request: WireRequestV1) => WireSuccessV1 }),
      {
        authorizeInvocation: () => true,
        contextForRequest: () => context,
        localizeError: ({ code }) => `Localized ${code}`,
        onInternalError,
      },
    ),
  };
}

describe('Wire IPC router', () => {
  it('dispatches a strict request through the exact canonical method handler', async () => {
    const handler = vi.fn((request: Extract<WireRequestV1, { method: 'project.list' }>) =>
      projectListSuccess(request.requestId),
    );
    const { router } = routerWith(handler);

    await expect(router.invoke(projectListRequest(), { sender: 'renderer' })).resolves.toEqual(
      projectListSuccess('request.router.project-list.1'),
    );
    expect(handler).toHaveBeenCalledWith(projectListRequest(), context);
  });

  it('rejects incomplete, extra, or accessor-backed handler registries at construction', () => {
    const complete = handlers();
    const { 'project.list': _missing, ...incomplete } = complete;
    expect(() =>
      createWireRouter(incomplete as WireHandlers, {
        authorizeInvocation: () => true,
        contextForRequest: () => context,
      }),
    ).toThrow(/exactly match/);
    expect(() =>
      createWireRouter({ ...complete, legacy: vi.fn() } as WireHandlers, {
        authorizeInvocation: () => true,
        contextForRequest: () => context,
      }),
    ).toThrow(/exactly match/);

    const accessorBacked = { ...complete } as WireHandlers;
    Object.defineProperty(accessorBacked, 'project.list', { get: () => vi.fn(), enumerable: true });
    expect(() =>
      createWireRouter(accessorBacked, {
        authorizeInvocation: () => true,
        contextForRequest: () => context,
      }),
    ).toThrow(/own data function/);
  });

  it('returns a structured invalid_request without calling a handler', async () => {
    const handler = vi.fn(() => projectListSuccess('request.router.project-list.1'));
    const { router } = routerWith(handler);

    await expect(
      router.invoke(projectListRequest({ cursor: null, limit: 20, legacyFallback: true }), {}),
    ).resolves.toEqual({
      wireVersion: 1,
      kind: 'failure',
      requestId: 'request.router.project-list.1',
      method: 'project.list',
      error: {
        code: 'invalid_request',
        publicSummary: 'Localized invalid_request',
        retryable: false,
        correlationId: 'request.router.project-list.1',
      },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('never evaluates request accessors or echoes malformed envelope data', async () => {
    let getterCalls = 0;
    const input = projectListRequest() as Record<string, unknown>;
    Object.defineProperty(input, 'wireVersion', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 1;
      },
    });
    const { router } = routerWith(() => projectListSuccess('request.router.project-list.1'));

    await expect(router.invoke(input, {})).resolves.toMatchObject({
      kind: 'failure',
      error: { code: 'invalid_request' },
    });
    expect(getterCalls).toBe(0);
    await expect(router.invoke({ secret: 'C:\\private\\token.txt' }, {})).rejects.toBeInstanceOf(
      WireProtocolError,
    );
  });

  it('maps storage and declared public failures without exposing their private messages', async () => {
    const missing = routerWith(() => {
      throw new StorageError('NOT_FOUND', 'PRIVATE database row and path');
    });
    const missingResponse = await missing.router.invoke(projectListRequest(), {});
    expect(missingResponse).toMatchObject({
      kind: 'failure',
      error: {
        code: 'not_found',
        publicSummary: 'Localized not_found',
        correlationId: context.correlationId,
      },
    });
    expect(JSON.stringify(missingResponse)).not.toContain('PRIVATE');

    const cancelled = routerWith(() => {
      throw new WirePublicError({ code: 'cancelled', retryable: false });
    });
    await expect(cancelled.router.invoke(projectListRequest(), {})).resolves.toMatchObject({
      kind: 'failure',
      error: { code: 'cancelled', publicSummary: 'Localized cancelled' },
    });
  });

  it('rejects an untrusted renderer before creating a command context or calling a handler', async () => {
    const handler = vi.fn((request: Extract<WireRequestV1, { method: 'project.list' }>) =>
      projectListSuccess(request.requestId),
    );
    const contextForRequest = vi.fn(() => context);
    const router = createWireRouter(
      handlers({ 'project.list': handler as (request: WireRequestV1) => WireSuccessV1 }),
      {
        authorizeInvocation: () => false,
        contextForRequest,
        localizeError: ({ code }) => `Localized ${code}`,
      },
    );

    await expect(router.invoke(projectListRequest(), { sender: 'untrusted' })).resolves.toEqual({
      wireVersion: 1,
      kind: 'failure',
      requestId: 'request.router.project-list.1',
      method: 'project.list',
      error: {
        code: 'permission_denied',
        publicSummary: 'Localized permission_denied',
        retryable: false,
        correlationId: 'request.router.project-list.1',
      },
    });
    expect(contextForRequest).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it('reports invalid handler output as a sanitized internal failure', async () => {
    const { router, onInternalError } = routerWith(
      () =>
        ({
          ...projectListSuccess('request.other'),
          privatePayload: 'PRIVATE provider body',
        }) as unknown as WireSuccessV1,
    );
    const response = await router.invoke(projectListRequest(), {});

    expect(response).toMatchObject({
      kind: 'failure',
      error: { code: 'internal_failure', publicSummary: 'Localized internal_failure' },
    });
    expect(JSON.stringify(response)).not.toContain('PRIVATE');
    expect(onInternalError).toHaveBeenCalledOnce();
  });

  it('registers one invoke listener and removes only that listener on disposal', async () => {
    const registered = new Map<
      string,
      (event: { sender: string }, input: unknown) => Promise<unknown>
    >();
    const ipcMain = {
      handle: vi.fn(
        (channel: string, listener: typeof registered extends Map<string, infer V> ? V : never) => {
          registered.set(channel, listener);
        },
      ),
      removeHandler: vi.fn((channel: string) => registered.delete(channel)),
    };
    const { router } = routerWith((request) => projectListSuccess(request.requestId));

    const dispose = registerWireRouter(ipcMain, LUCID_FIN_WIRE_INVOKE_CHANNEL_V1, router);
    expect(ipcMain.handle).toHaveBeenCalledOnce();
    await expect(
      registered.get(LUCID_FIN_WIRE_INVOKE_CHANNEL_V1)?.(
        { sender: 'renderer' },
        projectListRequest(),
      ),
    ).resolves.toEqual(projectListSuccess('request.router.project-list.1'));

    dispose();
    expect(ipcMain.removeHandler).toHaveBeenCalledWith(LUCID_FIN_WIRE_INVOKE_CHANNEL_V1);
    expect(registered.size).toBe(0);
  });
});
