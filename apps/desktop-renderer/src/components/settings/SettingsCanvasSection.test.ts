import { describe, expect, it } from 'vitest';
import {
  draftToSettings,
  isImageProviderSelectable,
  settingsToDraft,
} from './SettingsCanvasSection.js';

const codexProvider = { id: 'codex-imagegen', hasKey: false };

describe('SettingsCanvasSection provider readiness', () => {
  it('uses the shared credential-ready flag for OAuth and API-key providers', () => {
    expect(isImageProviderSelectable(codexProvider)).toBe(false);
    expect(isImageProviderSelectable({ ...codexProvider, hasKey: true })).toBe(true);
  });
});

describe('SettingsCanvasSection resolution policy mapping', () => {
  it('prefers the canonical policy while keeping legacy exact values readable', () => {
    const draft = settingsToDraft({
      publishImageResolution: { width: 1280, height: 720 },
      resolutionPolicy: {
        image: { mode: 'tier', tier: '2K', aspectRatio: '16:9' },
        video: { mode: 'provider-default' },
        referenceImage: { mode: 'exact', width: 1024, height: 1024 },
      },
    });

    expect(draft.publishImagePreset).toBe('tier:2K');
    expect(draft.publishImageWidth).toBe('');
    expect(draft.publishVideoPreset).toBe('provider-default');
    expect(draft.refPreset).toBe('ref-1024-square');
  });

  it('writes canonical intents and mirrors only exact values for old readers', () => {
    const settings = draftToSettings({
      ...settingsToDraft(undefined),
      publishImagePreset: 'custom',
      publishImageWidth: '1536',
      publishImageHeight: '864',
      publishVideoPreset: 'tier:1080p',
      refPreset: 'provider-default',
      aspectRatio: '16:9',
    });

    expect(settings.resolutionPolicy).toEqual({
      referenceImage: { mode: 'provider-default' },
      image: { mode: 'exact', width: 1536, height: 864 },
      video: { mode: 'tier', tier: '1080p', aspectRatio: '16:9' },
    });
    expect(settings.publishImageResolution).toEqual({ width: 1536, height: 864 });
    expect(settings.publishVideoResolution).toBeUndefined();
    expect(settings.refResolution).toBeUndefined();
  });
});

describe('SettingsCanvasSection visual-style policy mapping', () => {
  it('prefers the canonical draft and preserves structured locks while editing its summary', () => {
    const draft = settingsToDraft({
      stylePlate: 'legacy summary',
      negativePrompt: 'legacy negative',
      visualStylePolicy: {
        version: 1,
        summary: 'canonical summary',
        locked: { palette: 'indigo and vermilion' },
        allowedVariations: ['shot scale'],
        negativeConstraints: ['watermark'],
      },
    });

    expect(draft.stylePlate).toBe('canonical summary');
    expect(draft.negativePrompt).toBe('watermark');

    const settings = draftToSettings({ ...draft, stylePlate: 'edited canonical summary' });
    expect(settings.visualStylePolicy).toEqual({
      version: 1,
      summary: 'edited canonical summary',
      locked: { palette: 'indigo and vermilion' },
      allowedVariations: ['shot scale'],
      negativeConstraints: ['watermark'],
    });
    expect(settings.stylePlate).toBe('edited canonical summary');
    expect(settings.negativePrompt).toBe('watermark');
  });
});
