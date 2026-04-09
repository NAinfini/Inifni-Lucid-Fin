import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getPathMock } = vi.hoisted(() => ({
  getPathMock: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock,
  },
}));

let userDataDir = '';

async function loadLoggerModule() {
  vi.resetModules();
  return import('./logger.js');
}

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-logger-'));
  getPathMock.mockReturnValue(userDataDir);
});

afterEach(() => {
  vi.clearAllMocks();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('main logger foundation', () => {
  it('filters entries below the configured minimum level', async () => {
    const logger = await loadLoggerModule();
    logger.initLogger('warn');

    logger.info('hidden info', { category: 'test' });
    logger.error('visible error', { category: 'test' });

    const entries = logger.getBufferedLogs();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'error',
      category: 'test',
      message: 'visible error',
    });
  });

  it('creates scoped loggers with fixed category and merged base context', async () => {
    const logger = await loadLoggerModule();
    logger.initLogger('debug');
    const forwarded: Array<Awaited<ReturnType<typeof logger.getBufferedLogs>>[number]> = [];
    logger.setLogForwarder((entry) => forwarded.push(entry));

    const scoped = logger.createScopedLogger('provider', {
      providerId: 'openai',
      requestId: 'req-1',
    });
    scoped.warn('Connection degraded', { category: 'override-me', canvasId: 'canvas-1' });

    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toMatchObject({
      level: 'warn',
      category: 'provider',
      message: 'Connection degraded',
    });
    expect(forwarded[0]?.detail).toContain('"providerId": "openai"');
    expect(forwarded[0]?.detail).toContain('"requestId": "req-1"');
    expect(forwarded[0]?.detail).toContain('"canvasId": "canvas-1"');
    expect(forwarded[0]?.detail).not.toContain('override-me');
  });

  it('redacts sensitive values in buffered entries and file output', async () => {
    const logger = await loadLoggerModule();
    logger.initLogger('debug');

    logger.error(new Error('boom'), {
      category: 'auth',
      apiKey: 'sk-secret',
      Authorization: 'Bearer top-secret',
      nested: {
        token: 'abc123',
      },
    });

    const entry = logger.getBufferedLogs()[0];
    expect(entry?.detail).toContain('[REDACTED]');
    expect(entry?.detail).not.toContain('sk-secret');
    expect(entry?.detail).not.toContain('top-secret');
    expect(entry?.detail).not.toContain('abc123');

    const fileContents = fs.readFileSync(logger.getLogPath(), 'utf8');
    expect(fileContents).toContain('[REDACTED]');
    expect(fileContents).not.toContain('sk-secret');
    expect(fileContents).not.toContain('top-secret');
    expect(fileContents).not.toContain('abc123');
  });

  it('keeps only the latest buffered entries', async () => {
    const logger = await loadLoggerModule();
    logger.initLogger('debug');

    for (let index = 0; index < 1001; index += 1) {
      logger.debug(`entry-${index}`, { category: 'trim' });
    }

    const entries = logger.getBufferedLogs();
    expect(entries).toHaveLength(1000);
    expect(entries[0]?.message).toBe('entry-1');
    expect(entries.at(-1)?.message).toBe('entry-1000');
  });
});
