import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerVisionHandlers } from './vision.handlers.js';

describe('registerVisionHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    handlers = new Map();
  });

  it('rejects malformed describe-image requests at the typed IPC boundary', async () => {
    const keychain = {
      getKey: vi.fn(),
    };

    registerVisionHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      {
        cas: {},
        keychain,
      } as never,
    );

    await expect(
      handlers.get('vision:describeImage')?.(
        {},
        { assetHash: '', assetType: 'image', style: 'prompt' },
      ),
    ).rejects.toThrow('assetHash is required');
    expect(keychain.getKey).not.toHaveBeenCalled();
  });
});
