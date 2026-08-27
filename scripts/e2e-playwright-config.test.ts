import { describe, expect, it } from 'vitest';
import legacyConfig from '../tests/e2e/playwright.config.js';
import targetConfig from '../tests/e2e/target.playwright.config.js';

describe('Playwright suite boundaries', () => {
  it('keeps Target browser journeys out of the Legacy Electron suite', () => {
    expect(legacyConfig.testDir).toBe('.');
    expect(legacyConfig.testIgnore).toBe('target/**');
    expect(targetConfig.testDir).toBe('./target');
  });
});
