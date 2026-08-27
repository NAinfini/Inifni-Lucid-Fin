// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  delete (window as Window & { lucidTarget?: unknown }).lucidTarget;
  document.body.innerHTML = '<div id="root"></div>';
});

describe('target RC renderer entry', () => {
  it('fails explicitly instead of falling back when the target preload bridge is absent', async () => {
    await expect(import('./target-entry')).rejects.toMatchObject({
      name: 'TargetRcBridgeUnavailableError',
      message: 'Target RC cannot start because the target preload bridge is unavailable.',
    });
  });
});
