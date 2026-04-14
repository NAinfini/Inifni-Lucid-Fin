import http from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SqliteIndex } from '@lucid-fin/storage';
import log from './logger.js';

export interface ApiServerDeps {
  db: SqliteIndex;
}

let server: http.Server | null = null;
let apiToken: string | null = null;

// ── helpers ──────────────────────────────────────────────────────────────────

function send(
  res: http.ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  send(res, status, { error: message });
}

function authenticate(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const auth = req.headers['authorization'] ?? '';
  if (auth === `Bearer ${apiToken}`) return true;
  sendError(res, 401, 'Unauthorized');
  return false;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch { /* JSON.parse failed — reject with descriptive error */
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ── route handlers ────────────────────────────────────────────────────────────

function handleHealth(res: http.ServerResponse): void {
  send(res, 200, { status: 'ok', version: '0.0.1' });
}

function handleListCanvases(res: http.ServerResponse, db: SqliteIndex): void {
  const canvases = db.listCanvases();
  send(res, 200, canvases);
}

function handleGetCanvas(res: http.ServerResponse, db: SqliteIndex, id: string): void {
  const canvas = db.getCanvas(id);
  if (!canvas) {
    sendError(res, 404, `Canvas not found: ${id}`);
    return;
  }
  send(res, 200, canvas);
}

async function handleExportMetadata(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  let body: unknown;
  try {
    body = await readBody(req);
  } catch { /* readBody rejected (invalid JSON) — return 400 */
    sendError(res, 400, 'Invalid JSON body');
    return;
  }

  if (!body || typeof body !== 'object') {
    sendError(res, 400, 'Request body must be a JSON object');
    return;
  }

  const { format, nodes, projectTitle } = body as Record<string, unknown>;
  if (!format || !nodes) {
    sendError(res, 400, 'format and nodes are required');
    return;
  }

  const tmpDir = os.tmpdir();
  const fileName = `lucid-export-${Date.now()}.json`;
  const filePath = path.join(tmpDir, fileName);

  fs.writeFileSync(filePath, JSON.stringify({ format, nodes, projectTitle }, null, 2), 'utf-8');
  send(res, 200, { path: filePath });
}

// ── request dispatcher ────────────────────────────────────────────────────────

function createRequestHandler(deps: ApiServerDeps) {
  return async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      const base = `http://localhost`;
      const url = new URL(req.url ?? '/', base);
      const pathname = url.pathname;
      const method = req.method ?? 'GET';

      if (!authenticate(req, res)) return;

      // GET /api/health
      if (method === 'GET' && pathname === '/api/health') {
        handleHealth(res);
        return;
      }

      // GET /api/canvases
      if (method === 'GET' && pathname === '/api/canvases') {
        handleListCanvases(res, deps.db);
        return;
      }

      // GET /api/canvas/:id
      const canvasMatch = /^\/api\/canvas\/([^/]+)$/.exec(pathname);
      if (method === 'GET' && canvasMatch) {
        handleGetCanvas(res, deps.db, decodeURIComponent(canvasMatch[1]));
        return;
      }

      // POST /api/export/metadata
      if (method === 'POST' && pathname === '/api/export/metadata') {
        await handleExportMetadata(req, res);
        return;
      }

      sendError(res, 404, `Not found: ${method} ${pathname}`);
    } catch (err) {
      sendError(res, 500, `Internal server error: ${String(err)}`);
    }
  };
}

// ── public API ────────────────────────────────────────────────────────────────

export function startApiServer(deps: ApiServerDeps): void {
  if (server) return;

  apiToken = randomUUID();
  const port = parseInt(process.env['LUCID_API_PORT'] ?? '42069', 10);

  server = http.createServer(createRequestHandler(deps));

  server.listen(port, '127.0.0.1', () => {
    log.info('[api-server] Listening', { port, token: apiToken });
  });

  server.on('error', (err) => {
    log.error('[api-server] Server error', { error: String(err) });
  });
}

export function stopApiServer(): void {
  if (!server) return;
  server.close(() => {
    log.info('[api-server] Stopped');
  });
  server = null;
  apiToken = null;
}
