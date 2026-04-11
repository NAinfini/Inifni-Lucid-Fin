import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createServerMock,
  randomUUIDMock,
  writeFileSyncMock,
  tmpdirMock,
  getCurrentProjectIdMock,
  logger,
} = vi.hoisted(() => ({
  createServerMock: vi.fn(),
  randomUUIDMock: vi.fn(() => 'test-token'),
  writeFileSyncMock: vi.fn(),
  tmpdirMock: vi.fn(() => 'C:/temp'),
  getCurrentProjectIdMock: vi.fn(() => 'project-1'),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock('node:http', () => ({
  default: {
    createServer: createServerMock,
  },
  createServer: createServerMock,
}));

vi.mock('node:crypto', () => ({
  randomUUID: randomUUIDMock,
}));

vi.mock('node:fs', () => ({
  default: {
    writeFileSync: writeFileSyncMock,
  },
  writeFileSync: writeFileSyncMock,
}));

vi.mock('node:os', () => ({
  default: {
    tmpdir: tmpdirMock,
  },
  tmpdir: tmpdirMock,
}));

vi.mock('./ipc/project-context.js', () => ({
  getCurrentProjectId: getCurrentProjectIdMock,
}));

vi.mock('./logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

type RequestHandler = (req: unknown, res: unknown) => Promise<void>;

interface MockServer {
  close: ReturnType<typeof vi.fn>;
  listen: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

interface MockResponse {
  end: ReturnType<typeof vi.fn>;
  headers?: Record<string, string | number>;
  payload?: string;
  statusCode?: number;
  writeHead: ReturnType<typeof vi.fn>;
}

function createResponse(): MockResponse {
  const res: MockResponse = {
    writeHead: vi.fn((statusCode: number, headers: Record<string, string | number>) => {
      res.statusCode = statusCode;
      res.headers = headers;
    }),
    end: vi.fn((payload?: string) => {
      res.payload = payload;
    }),
  };
  return res;
}

function parseJson(res: MockResponse): unknown {
  expect(res.payload).toBeTypeOf('string');
  return JSON.parse(res.payload ?? 'null');
}

function createRequest(options: {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
  url?: string;
}) {
  const req = Object.assign(new EventEmitter(), {
    headers: options.headers ?? {},
    method: options.method ?? 'GET',
    url: options.url ?? '/',
  });

  return req;
}

async function dispatch(
  handler: RequestHandler,
  options: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
    url?: string;
  } = {},
): Promise<MockResponse> {
  const req = createRequest(options);
  const res = createResponse();

  const pending = handler(req, res);
  queueMicrotask(() => {
    if (options.body !== undefined) {
      req.emit('data', Buffer.from(options.body));
    }
    req.emit('end');
  });
  await pending;

  return res;
}

async function loadModule() {
  vi.resetModules();
  const server: MockServer = {
    listen: vi.fn((port: number, host: string, callback?: () => void) => callback?.()),
    on: vi.fn(),
    close: vi.fn((callback?: () => void) => callback?.()),
  };
  createServerMock.mockImplementation((handler: RequestHandler) => {
    createServerMock.mock.lastHandler = handler;
    return server;
  });

  const module = await import('./api-server.js');
  const handler = () => createServerMock.mock.lastHandler as RequestHandler;

  return { ...module, handler, server };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  delete process.env['LUCID_API_PORT'];
  randomUUIDMock.mockReturnValue('test-token');
  tmpdirMock.mockReturnValue('C:/temp');
  getCurrentProjectIdMock.mockReturnValue('project-1');
});

describe('api server', () => {
  it('starts once, binds the configured port, and stops cleanly', async () => {
    process.env['LUCID_API_PORT'] = '43111';
    const { startApiServer, stopApiServer, server } = await loadModule();

    startApiServer({ db: {} as never });
    startApiServer({ db: {} as never });

    expect(createServerMock).toHaveBeenCalledTimes(1);
    expect(server.listen).toHaveBeenCalledWith(43111, '127.0.0.1', expect.any(Function));

    stopApiServer();

    expect(server.close).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith('[api-server] Stopped');
  });

  it('rejects requests without the bearer token before route matching', async () => {
    const { handler, startApiServer } = await loadModule();
    const db = {
      listCanvases: vi.fn(),
    };

    startApiServer({ db } as never);
    const res = await dispatch(handler(), {
      method: 'GET',
      url: '/api/health',
    });

    expect(res.statusCode).toBe(401);
    expect(parseJson(res)).toEqual({ error: 'Unauthorized' });
    expect(db.listCanvases).not.toHaveBeenCalled();
  });

  it('serves the health route for authenticated requests', async () => {
    const { handler, startApiServer } = await loadModule();

    startApiServer({ db: {} as never });
    const res = await dispatch(handler(), {
      method: 'GET',
      url: '/api/health',
      headers: {
        authorization: 'Bearer test-token',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(parseJson(res)).toEqual({ status: 'ok', version: '0.0.1' });
  });

  it('lists canvases for the active project and returns a clear error when none is open', async () => {
    const { handler, startApiServer } = await loadModule();
    const db = {
      listCanvases: vi.fn(() => [{ id: 'canvas-1' }]),
    };

    startApiServer({ db } as never);
    const authHeaders = {
      authorization: 'Bearer test-token',
    };

    getCurrentProjectIdMock.mockReturnValueOnce(null);
    const missingProject = await dispatch(handler(), {
      method: 'GET',
      url: '/api/canvases',
      headers: authHeaders,
    });
    expect(missingProject.statusCode).toBe(400);
    expect(parseJson(missingProject)).toEqual({ error: 'No project open' });

    const success = await dispatch(handler(), {
      method: 'GET',
      url: '/api/canvases',
      headers: authHeaders,
    });
    expect(db.listCanvases).toHaveBeenCalledWith('project-1');
    expect(success.statusCode).toBe(200);
    expect(parseJson(success)).toEqual([{ id: 'canvas-1' }]);
  });

  it('matches the canvas detail route, decodes ids, and returns 404 for missing canvases', async () => {
    const { handler, startApiServer } = await loadModule();
    const db = {
      getCanvas: vi
        .fn()
        .mockReturnValueOnce({ id: 'canvas/1', title: 'Storyboard' })
        .mockReturnValueOnce(undefined),
    };

    startApiServer({ db } as never);
    const headers = {
      authorization: 'Bearer test-token',
    };

    const found = await dispatch(handler(), {
      method: 'GET',
      url: '/api/canvas/canvas%2F1',
      headers,
    });
    expect(db.getCanvas).toHaveBeenNthCalledWith(1, 'canvas/1');
    expect(found.statusCode).toBe(200);
    expect(parseJson(found)).toEqual({ id: 'canvas/1', title: 'Storyboard' });

    const missing = await dispatch(handler(), {
      method: 'GET',
      url: '/api/canvas/canvas-404',
      headers,
    });
    expect(missing.statusCode).toBe(404);
    expect(parseJson(missing)).toEqual({ error: 'Canvas not found: canvas-404' });
  });

  it('parses JSON export requests and writes metadata to a temp file', async () => {
    const { handler, startApiServer } = await loadModule();

    vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    startApiServer({ db: {} as never });

    const res = await dispatch(handler(), {
      method: 'POST',
      url: '/api/export/metadata',
      headers: {
        authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        format: 'json',
        nodes: [{ id: 'node-1' }],
        projectTitle: 'Pilot',
      }),
    });

    expect(writeFileSyncMock).toHaveBeenCalledWith(
      'C:\\temp\\lucid-export-1700000000000.json',
      JSON.stringify(
        {
          format: 'json',
          nodes: [{ id: 'node-1' }],
          projectTitle: 'Pilot',
        },
        null,
        2,
      ),
      'utf-8',
    );
    expect(res.statusCode).toBe(200);
    expect(parseJson(res)).toEqual({
      path: 'C:\\temp\\lucid-export-1700000000000.json',
    });
  });

  it('returns 400 responses for invalid export request bodies', async () => {
    const { handler, startApiServer } = await loadModule();

    startApiServer({ db: {} as never });
    const headers = {
      authorization: 'Bearer test-token',
    };

    const invalidJson = await dispatch(handler(), {
      method: 'POST',
      url: '/api/export/metadata',
      headers,
      body: '{bad json',
    });
    expect(invalidJson.statusCode).toBe(400);
    expect(parseJson(invalidJson)).toEqual({ error: 'Invalid JSON body' });

    const nonObject = await dispatch(handler(), {
      method: 'POST',
      url: '/api/export/metadata',
      headers,
      body: JSON.stringify(['not-an-object']),
    });
    expect(nonObject.statusCode).toBe(400);
    expect(parseJson(nonObject)).toEqual({
      error: 'format and nodes are required',
    });

    const missingFields = await dispatch(handler(), {
      method: 'POST',
      url: '/api/export/metadata',
      headers,
      body: JSON.stringify({ format: 'json' }),
    });
    expect(missingFields.statusCode).toBe(400);
    expect(parseJson(missingFields)).toEqual({
      error: 'format and nodes are required',
    });
  });

  it('returns 404 for unmatched routes and 500 when a handler throws', async () => {
    const { handler, startApiServer } = await loadModule();
    const db = {
      listCanvases: vi.fn(() => {
        throw new Error('db down');
      }),
    };

    startApiServer({ db } as never);
    const headers = {
      authorization: 'Bearer test-token',
    };

    const missingRoute = await dispatch(handler(), {
      method: 'DELETE',
      url: '/api/unknown',
      headers,
    });
    expect(missingRoute.statusCode).toBe(404);
    expect(parseJson(missingRoute)).toEqual({
      error: 'Not found: DELETE /api/unknown',
    });

    const failure = await dispatch(handler(), {
      method: 'GET',
      url: '/api/canvases',
      headers,
    });
    expect(failure.statusCode).toBe(500);
    expect(parseJson(failure)).toEqual({
      error: 'Internal server error: Error: db down',
    });
  });
});
