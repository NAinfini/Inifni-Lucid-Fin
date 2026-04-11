import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

import { initDb } from './init-db.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('initDb', () => {
  it('runs the health check and logs successful initialization', () => {
    const db = {
      healthCheck: vi.fn(),
      repair: vi.fn(),
    };

    initDb(db as never);

    expect(db.healthCheck).toHaveBeenCalledOnce();
    expect(db.repair).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('SQLite database initialized');
  });

  it('repairs the database when the health check fails', () => {
    const healthError = new Error('corrupt');
    const db = {
      healthCheck: vi.fn(() => {
        throw healthError;
      }),
      repair: vi.fn(),
    };

    initDb(db as never);

    expect(logger.error).toHaveBeenCalledWith(
      'Database health check failed, attempting repair:',
      healthError,
    );
    expect(db.repair).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith('Database repaired successfully');
  });

  it('logs repair failures without throwing', () => {
    const healthError = new Error('corrupt');
    const repairError = new Error('repair failed');
    const db = {
      healthCheck: vi.fn(() => {
        throw healthError;
      }),
      repair: vi.fn(() => {
        throw repairError;
      }),
    };

    expect(() => initDb(db as never)).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith('Database repair failed:', repairError);
  });
});
