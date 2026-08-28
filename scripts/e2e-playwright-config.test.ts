import { describe, expect, it } from 'vitest';
import desktopConfig from '../tests/e2e/playwright.config.js';

describe('Playwright suite boundaries', () => {
  it('has one canonical Electron journey suite', () => {
    expect(desktopConfig.testDir).toBe('.');
    expect(desktopConfig.testIgnore).toBeUndefined();
    expect(desktopConfig.workers).toBe(1);
  });
});
