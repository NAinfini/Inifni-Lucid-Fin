import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('keytar', () => ({
  default: {
    setPassword: vi.fn(),
    getPassword: vi.fn(),
    deletePassword: vi.fn(),
  },
}));

import { Keychain } from './keychain.js';
import keytar from 'keytar';

afterEach(() => vi.restoreAllMocks());

describe('Keychain', () => {
  const kc = new Keychain();

  it('setKey stores credential', async () => {
    await kc.setKey('openai', 'sk-123');
    expect(keytar.setPassword).toHaveBeenCalledWith('lucid-fin', 'openai', 'sk-123');
  });

  it('getKey returns stored key', async () => {
    vi.mocked(keytar.getPassword).mockResolvedValueOnce('sk-123');
    expect(await kc.getKey('openai')).toBe('sk-123');
  });

  it('getKey returns null on keytar error', async () => {
    vi.mocked(keytar.getPassword).mockRejectedValueOnce(new Error('Keychain locked'));
    expect(await kc.getKey('openai')).toBeNull();
  });

  it('setKey does not throw on keytar error', async () => {
    vi.mocked(keytar.setPassword).mockRejectedValueOnce(new Error('Permission denied'));
    await expect(kc.setKey('openai', 'sk-123')).resolves.not.toThrow();
  });

  it('deleteKey returns false on keytar error', async () => {
    vi.mocked(keytar.deletePassword).mockRejectedValueOnce(new Error('Not found'));
    expect(await kc.deleteKey('openai')).toBe(false);
  });

  it('isConfigured returns false on keytar error', async () => {
    vi.mocked(keytar.getPassword).mockRejectedValueOnce(new Error('Keychain locked'));
    expect(await kc.isConfigured('openai')).toBe(false);
  });

  it('calls onError callback when provided', async () => {
    const onError = vi.fn();
    const kcWithCallback = new Keychain({ onError });
    vi.mocked(keytar.getPassword).mockRejectedValueOnce(new Error('OS error'));
    await kcWithCallback.getKey('openai');
    expect(onError).toHaveBeenCalledWith('getKey', expect.any(Error));
  });
});
