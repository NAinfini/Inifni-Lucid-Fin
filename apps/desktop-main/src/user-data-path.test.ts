import { describe, expect, it, vi } from 'vitest';
import {
  configureUserDataPath,
  migrateLegacyUserData,
  resolveUserDataPaths,
} from './user-data-path.js';

describe('user data path configuration', () => {
  it('resolves Lucid Fin and legacy Electron paths under appData', () => {
    expect(resolveUserDataPaths('C:\\Users\\nainf\\AppData\\Roaming')).toEqual({
      targetUserDataPath: 'C:\\Users\\nainf\\AppData\\Roaming\\Lucid Fin',
      legacyUserDataPath: 'C:\\Users\\nainf\\AppData\\Roaming\\Electron',
    });
  });

  it('moves legacy settings and logs into the Lucid Fin userData directory', () => {
    const existsSync = vi.fn((candidate: string) =>
      candidate === 'C:\\AppData\\Electron\\settings.json' ||
      candidate === 'C:\\AppData\\Electron\\logs',
    );
    const mkdirSync = vi.fn();
    const renameSync = vi.fn();

    migrateLegacyUserData(
      { existsSync, mkdirSync, renameSync },
      {
        targetUserDataPath: 'C:\\AppData\\Lucid Fin',
        legacyUserDataPath: 'C:\\AppData\\Electron',
      },
    );

    expect(mkdirSync).toHaveBeenCalledWith('C:\\AppData\\Lucid Fin', { recursive: true });
    expect(renameSync).toHaveBeenCalledWith(
      'C:\\AppData\\Electron\\settings.json',
      'C:\\AppData\\Lucid Fin\\settings.json',
    );
    expect(renameSync).toHaveBeenCalledWith(
      'C:\\AppData\\Electron\\logs',
      'C:\\AppData\\Lucid Fin\\logs',
    );
  });

  it('sets userData to the Lucid Fin directory after migrating legacy files', () => {
    const appPathAPI = {
      getPath: vi.fn((name: 'appData' | 'userData') =>
        name === 'appData' ? 'C:\\AppData' : 'C:\\AppData\\Electron',
      ),
      setPath: vi.fn(),
    };
    const fileOps = {
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      renameSync: vi.fn(),
    };

    const paths = configureUserDataPath(appPathAPI, fileOps);

    expect(paths.targetUserDataPath).toBe('C:\\AppData\\Lucid Fin');
    expect(appPathAPI.setPath).toHaveBeenCalledWith('userData', 'C:\\AppData\\Lucid Fin');
  });
});
