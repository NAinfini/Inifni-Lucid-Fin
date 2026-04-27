import { describe, expect, it, vi } from 'vitest';
import { configureUserDataPath, resolveUserDataPath } from './user-data-path.js';

describe('user data path configuration', () => {
  it('resolves the Lucid Fin path under appData', () => {
    expect(resolveUserDataPath('C:\\Users\\nainf\\AppData\\Roaming')).toBe(
      'C:\\Users\\nainf\\AppData\\Roaming\\Lucid Fin',
    );
  });

  it('sets userData to the Lucid Fin directory', () => {
    const appPathAPI = {
      getPath: vi.fn((name: 'appData' | 'userData') =>
        name === 'appData' ? 'C:\\AppData' : 'C:\\AppData\\Lucid Fin',
      ),
      setPath: vi.fn(),
    };

    const userDataPath = configureUserDataPath(appPathAPI);

    expect(userDataPath).toBe('C:\\AppData\\Lucid Fin');
    expect(appPathAPI.setPath).toHaveBeenCalledWith('userData', 'C:\\AppData\\Lucid Fin');
  });
});
