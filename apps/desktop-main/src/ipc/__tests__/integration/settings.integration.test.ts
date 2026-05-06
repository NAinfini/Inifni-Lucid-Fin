/**
 * Settings (StyleGuide) integration tests.
 *
 * Exercises the full handler -> ProjectSettingsRepository -> SQLite chain.
 * Tests: load (first time, returns default) -> save -> load (returns saved).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StyleGuide } from '@lucid-fin/contracts';
import {
  createFakeIpcMain,
  createTestDb,
  cleanupTestDb,
  invoke,
  type FakeIpcMain,
  type TestDb,
} from './ipc-test-harness.js';

// Mock the logger.
const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

import { registerStyleHandlers } from '../../handlers/style.handlers.js';

describe('Settings (StyleGuide) integration', () => {
  let testDb: TestDb;
  let ipcMain: FakeIpcMain;

  beforeEach(() => {
    testDb = createTestDb();
    ipcMain = createFakeIpcMain();
    registerStyleHandlers(ipcMain, testDb.db);
  });

  afterEach(() => {
    cleanupTestDb(testDb);
    vi.clearAllMocks();
  });

  it('load returns default on first access, save persists, reload returns saved', async () => {
    // 1. First load — should return the default StyleGuide
    const initial = await invoke<StyleGuide>(ipcMain, 'style:load');
    expect(initial).toBeDefined();
    expect(initial.global).toBeDefined();
    expect(initial.global.artStyle).toBe('');
    expect(initial.global.colorPalette).toEqual({
      primary: '',
      secondary: '',
      forbidden: [],
    });
    expect(initial.global.lighting).toBe('natural');
    expect(initial.sceneOverrides).toEqual({});

    // 2. Save a custom StyleGuide
    const customGuide: StyleGuide = {
      global: {
        artStyle: 'neo-noir watercolor',
        colorPalette: {
          primary: '#1a1a2e',
          secondary: '#e94560',
          forbidden: ['#ff0000', '#00ff00'],
        },
        lighting: 'dramatic',
        texture: 'film grain',
        referenceImages: [],
        freeformDescription: 'Dark moody aesthetic with muted tones',
      },
      sceneOverrides: {
        'scene-1': {
          artStyle: 'cyberpunk',
        },
      },
    };
    await invoke(ipcMain, 'style:save', customGuide);

    // 3. Reload — should return the saved guide
    const reloaded = await invoke<StyleGuide>(ipcMain, 'style:load');
    expect(reloaded.global.artStyle).toBe('neo-noir watercolor');
    expect(reloaded.global.colorPalette.primary).toBe('#1a1a2e');
    expect(reloaded.global.colorPalette.forbidden).toEqual(['#ff0000', '#00ff00']);
    expect(reloaded.global.lighting).toBe('dramatic');
    expect(reloaded.global.texture).toBe('film grain');
    expect(reloaded.global.freeformDescription).toBe('Dark moody aesthetic with muted tones');
    expect(reloaded.sceneOverrides['scene-1']).toEqual({ artStyle: 'cyberpunk' });
  });

  it('save rejects invalid payload', async () => {
    await expect(invoke(ipcMain, 'style:save', { invalid: true })).rejects.toThrow(
      /invalid.*style.*guide/i,
    );
  });

  it('overwriting a saved guide replaces the previous one', async () => {
    const guide1: StyleGuide = {
      global: {
        artStyle: 'v1',
        colorPalette: { primary: '', secondary: '', forbidden: [] },
        lighting: 'natural',
        texture: '',
        referenceImages: [],
        freeformDescription: '',
      },
      sceneOverrides: {},
    };
    await invoke(ipcMain, 'style:save', guide1);

    const guide2: StyleGuide = {
      global: {
        artStyle: 'v2',
        colorPalette: { primary: '#fff', secondary: '#000', forbidden: [] },
        lighting: 'cinematic',
        texture: 'smooth',
        referenceImages: [],
        freeformDescription: 'Updated',
      },
      sceneOverrides: { 's1': { artStyle: 'anime' } },
    };
    await invoke(ipcMain, 'style:save', guide2);

    const loaded = await invoke<StyleGuide>(ipcMain, 'style:load');
    expect(loaded.global.artStyle).toBe('v2');
    expect(loaded.global.lighting).toBe('cinematic');
    expect(loaded.sceneOverrides['s1']).toEqual({ artStyle: 'anime' });
  });
});
